/**
 * src/ui/screens/event-bracket.js
 *
 * Tournament sub-view: the single-elimination bracket.
 * - Managers generate (or regenerate, with a warning) the bracket from the
 *   Teams tab's rosters + seeds.
 * - Hosts start a match's game (6 or 10 cups); the game links back via
 *   games.tournament_match_id.
 * - Advancement is automatic and self-healing: every load syncs completed
 *   games into winners and fills the next round (idempotent).
 */

import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
import { esc } from '../../format.js';
import {
  eventTeams, loadMatches, generateAndPersistBracket,
  startMatchGame, syncBracket,
} from '../../tournament-data.js';

export default async function render($el, ctx) {
  const { eventId, canManage, canHostGames } = ctx;
  const canHost = ctx.isAdmin || canManage || ctx.role === 'game_host';

  $el.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">Loading bracket…</p></div>`;

  const [{ teams }, { matches, error }] = await Promise.all([
    eventTeams(eventId), loadMatches(eventId),
  ]);
  if (error) {
    $el.innerHTML = `<div class="empty-state"><p style="color:var(--red);">Could not load the bracket.</p></div>`;
    return;
  }

  // Automatic advancement (idempotent) — then reload if something changed
  let ms = matches;
  const { changed } = await syncBracket(ms);
  if (changed) ms = (await loadMatches(eventId)).matches;

  const teamsById = new Map(teams.map(t => [t.id, t]));
  const teamName = id => id ? (teamsById.get(id)?.name ?? '?') : null;

  if (!ms.length) {
    $el.innerHTML = `
      <div class="empty-state">
        <h2>No bracket yet</h2>
        <p style="color:var(--text-faint); margin:0.5rem 0 1rem;">
          ${teams.length < 2
            ? 'Create at least 2 teams on the Teams tab first.'
            : `${teams.length} teams are ready.`}
        </p>
        ${canManage && teams.length >= 2
          ? '<button id="gen-btn" class="btn btn-primary">🏆 Generate bracket</button>'
          : ''}
      </div>`;
    $el.querySelector('#gen-btn')?.addEventListener('click', () => doGenerate(false));
    return;
  }

  // ── Bracket view ──────────────────────────────────────────────────────
  const rounds = [];
  for (const m of ms) {
    (rounds[m.round] ??= []).push(m);
  }
  const roundLabel = r => {
    const left = rounds.length - r;
    return left === 1 ? 'Final' : left === 2 ? 'Semifinals' : left === 3 ? 'Quarterfinals' : `Round ${r + 1}`;
  };
  const champion = (() => {
    const final = rounds[rounds.length - 1]?.[0];
    return final?.winner_team_id ? teamName(final.winner_team_id) : null;
  })();

  $el.innerHTML = `
    <div>
      ${champion ? `
      <div class="result-banner" style="margin-bottom:1rem;">
        <div class="big">🏆 ${esc(champion)}</div>
        <small>Tournament champion</small>
      </div>` : ''}
      <div style="display:flex; gap:0.9rem; overflow-x:auto; padding-bottom:0.5rem; align-items:flex-start;">
        ${rounds.map((round, r) => `
          <div style="flex:0 0 210px;">
            <div class="section-title" style="margin-top:0;">${roundLabel(r)}</div>
            <div style="display:flex; flex-direction:column; gap:0.6rem; justify-content:space-around;
                        min-height:${rounds[0].length * 74}px;">
              ${round.map(m => matchCard(m)).join('')}
            </div>
          </div>`).join('')}
      </div>
      ${canManage ? `
      <button id="regen-btn" class="btn btn-danger-ghost btn-block" style="margin-top:1rem; font-size:0.8rem;">
        ♻️ Regenerate bracket (discards progress)
      </button>` : ''}
    </div>`;

  function matchCard(m) {
    const decided = !!m.winner_team_id;
    const nameA = teamName(m.team_a);
    const nameB = m.is_bye ? null : teamName(m.team_b);
    const ready = !!(m.team_a && m.team_b && !m.game_id && !m.is_bye && !decided);
    const live = !!(m.game_id && !decided);

    const side = (name, teamId) => `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:0.4rem;
                  padding:0.3rem 0.55rem; border-radius:7px; font-size:0.82rem;
                  background:${decided && m.winner_team_id === teamId ? 'var(--green-dim)' : 'var(--surface-2)'};
                  ${decided && m.winner_team_id !== teamId ? 'opacity:0.45;' : ''}">
        <span style="min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${name ? esc(name) : '<span style="color:var(--text-faint);">—</span>'}
        </span>
        ${decided && m.winner_team_id === teamId ? '<span style="color:var(--green); font-size:0.7rem;">✓</span>' : ''}
      </div>`;

    return `
      <div class="card" style="padding:0.55rem; ${live ? 'border-color:var(--green);' : ''}">
        ${side(nameA, m.team_a)}
        ${m.is_bye
          ? '<div style="font-size:0.65rem; color:var(--text-faint); padding:0.25rem 0.55rem;">bye — advances</div>'
          : `<div style="height:4px;"></div>${side(nameB, m.team_b)}`}
        ${live ? `<button data-open-game="${m.game_id}" class="btn btn-ghost btn-block"
            style="margin-top:0.45rem; padding:0.4rem; font-size:0.75rem;">● Live — open game</button>` : ''}
        ${decided && m.game_id ? `<button data-open-recap="${m.game_id}" class="btn btn-ghost btn-block"
            style="margin-top:0.45rem; padding:0.4rem; font-size:0.72rem;">View result</button>` : ''}
        ${ready && canHost && ctx.open ? `
          <div style="display:flex; gap:0.35rem; margin-top:0.45rem;">
            <button data-start="${m.id}" data-cups="10" class="btn btn-primary" style="flex:1; padding:0.4rem; font-size:0.72rem;">▶ 10 cups</button>
            <button data-start="${m.id}" data-cups="6" class="btn btn-ghost" style="flex:1; padding:0.4rem; font-size:0.72rem;">▶ 6 cups</button>
          </div>` : ''}
      </div>`;
  }

  // handlers
  $el.querySelectorAll('[data-open-game]').forEach(b =>
    b.addEventListener('click', () => navigate(`#/game/${b.dataset.openGame}`)));
  $el.querySelectorAll('[data-open-recap]').forEach(b =>
    b.addEventListener('click', () => navigate(`#/game/${b.dataset.openRecap}/complete`)));
  $el.querySelectorAll('[data-start]').forEach(b =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      const match = ms.find(x => x.id === b.dataset.start);
      const { gameId, error } = await startMatchGame(eventId, match, teamsById, parseInt(b.dataset.cups));
      if (error) { toast(`Could not start: ${error}`, 'error'); b.disabled = false; return; }
      navigate(`#/game/${gameId}`);
    }));
  $el.querySelector('#regen-btn')?.addEventListener('click', () => doGenerate(true));

  async function doGenerate(isRegen) {
    if (isRegen && !window.confirm('Regenerate the bracket? All match progress is discarded (finished games stay in History).')) return;
    const { error } = await generateAndPersistBracket(eventId, teams);
    if (error) { toast(`Could not generate: ${error}`, 'error'); return; }
    toast('Bracket generated 🏆', 'success');
    window.location.reload();
  }
}
