/**
 * src/ui/screens/event-bracket.js
 *
 * Tournament sub-view: group stage + finals bracket, generated in two
 * separate steps by the event creator / co-creators:
 *
 *   Step 1 — Group stage: teams are snake-distributed into groups and play
 *   a round-robin. Group count and cup count (6/10) are chosen at
 *   generation time (defaulting to the event's settings).
 *
 *   Step 2 — Finals: once the group games are (mostly) done, the manager
 *   generates the single-elimination finals from the group standings,
 *   choosing how many teams advance per group and the finals cup count.
 *
 * Cup selection happens ONLY at generation — match cards have a single
 * Start button that uses the match's stored cup_count.
 *
 * Advancement is automatic and self-healing: every load syncs completed
 * games into winners and fills the next finals round (idempotent).
 */

import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
import { esc } from '../../format.js';
import {
  eventTeams, loadMatches, generateGroupStage, generateFinals,
  computeGroupStandings, startMatchGame, syncBracket,
} from '../../tournament-data.js';

export default async function render($el, ctx) {
  const { eventId, event, canManage } = ctx;
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

  const groupMatches = ms.filter(m => m.stage === 'group');
  // Legacy brackets (pre-group-stage) default to stage='finals'
  const finalsMatches = ms.filter(m => (m.stage ?? 'finals') === 'finals');

  // ── Empty: offer group-stage generation (step 1) ──────────────────────
  if (!ms.length) {
    $el.innerHTML = `
      <div class="empty-state">
        <h2>No bracket yet</h2>
        <p style="color:var(--text-faint); margin:0.5rem 0 1rem;">
          ${teams.length < 2
            ? 'Create at least 2 teams on the Teams tab first.'
            : `${teams.length} teams are ready. Tournaments start with a group stage, followed by a finals bracket.`}
        </p>
        ${canManage && teams.length >= 2
          ? '<button id="gen-groups-btn" class="btn btn-primary">🏆 Generate group stage</button>'
          : ''}
      </div>`;
    $el.querySelector('#gen-groups-btn')?.addEventListener('click', () => openGroupSheet(false));
    return;
  }

  // ── Data for both stages ──────────────────────────────────────────────
  const standings = computeGroupStandings(groupMatches, teamsById);
  const groupsDone = groupMatches.length > 0 && groupMatches.every(m => m.winner_team_id);

  const finalsRoundNos = [...new Set(finalsMatches.map(m => m.round))].sort((a, b) => a - b);
  const finalsRounds = finalsRoundNos.map(r =>
    finalsMatches.filter(m => m.round === r).sort((a, b) => a.position - b.position));
  const roundLabel = idx => {
    const left = finalsRounds.length - idx;
    return left === 1 ? 'Final' : left === 2 ? 'Semifinals' : left === 3 ? 'Quarterfinals' : `Round ${idx + 1}`;
  };
  const champion = (() => {
    const final = finalsRounds[finalsRounds.length - 1]?.[0];
    return final?.winner_team_id ? teamName(final.winner_team_id) : null;
  })();

  // ── Render ────────────────────────────────────────────────────────────
  $el.innerHTML = `
    <div>
      ${champion ? `
      <div class="result-banner" style="margin-bottom:1rem;">
        <div class="big">🏆 ${esc(champion)}</div>
        <small>Tournament champion</small>
      </div>` : ''}

      ${groupMatches.length ? `
      <div class="section-title" style="margin-top:0;">Group stage</div>
      <div class="card-grid">
        ${standings.map((table, g) => groupBlock(table, g)).join('')}
      </div>
      ` : ''}

      ${finalsMatches.length ? `
      <div class="section-title" style="margin-top:1.2rem;">Finals</div>
      <div style="display:flex; gap:0.9rem; overflow-x:auto; padding-bottom:0.5rem; align-items:flex-start;">
        ${finalsRounds.map((round, r) => `
          <div style="flex:0 0 210px;">
            <div class="section-title" style="margin-top:0;">${roundLabel(r)}</div>
            <div style="display:flex; flex-direction:column; gap:0.6rem; justify-content:space-around;
                        min-height:${(finalsRounds[0]?.length ?? 1) * 74}px;">
              ${round.map(m => matchCard(m)).join('')}
            </div>
          </div>`).join('')}
      </div>` : `
      ${groupMatches.length && canManage ? `
      <div class="card" style="margin-top:1.2rem; text-align:center;">
        <div style="font-family:'Syne',sans-serif;font-weight:800; font-size:1.2rem;">Finals</div>
        <p style="font-size:0.78rem; color:var(--text-faint); margin:0.35rem 0 0.8rem;">
          ${groupsDone
            ? 'The group stage is complete — generate the finals bracket from the standings.'
            : 'Group games are still running. You can already generate the finals from the current standings, but it is best to wait until every group game is done.'}
        </p>
        <button id="gen-finals-btn" class="btn btn-primary btn-block">🏆 Generate finals</button>
      </div>` : ''}`}

      ${canManage ? `
      <div style="display:flex; flex-direction:column; gap:0.4rem; margin-top:1.2rem;">
        ${finalsMatches.length && groupMatches.length ? `
        <button id="regen-finals-btn" class="btn btn-danger-ghost btn-block" style="font-size:0.8rem;">
          ♻️ Regenerate finals (keeps group stage)
        </button>` : ''}
        <button id="regen-all-btn" class="btn btn-danger-ghost btn-block" style="font-size:0.8rem;">
          ♻️ Regenerate group stage (discards everything)
        </button>
      </div>` : ''}
    </div>`;

  // ── Group block: standings table + match list ─────────────────────────
  function groupBlock(table, g) {
    const gm = groupMatches
      .filter(m => (m.group_no ?? 0) === g)
      .sort((a, b) => a.round - b.round || a.position - b.position);
    return `
      <div class="card" style="padding:0.7rem;">
        <div style="font-family:'Syne',sans-serif;font-weight:800; font-size:1.15rem; margin-bottom:0.4rem;">
          Group ${String.fromCharCode(65 + g)}
          <span style="font-size:0.7rem; font-family:'JetBrains Mono',monospace; color:var(--text-faint);">
            · ${gm[0]?.cup_count ?? 10} cups
          </span>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:0.78rem; margin-bottom:0.6rem;">
          <thead>
            <tr style="color:var(--text-faint); font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px;">
              <th style="text-align:left; padding:0.2rem 0.3rem;">#</th>
              <th style="text-align:left; padding:0.2rem 0.3rem;">Team</th>
              <th style="text-align:right; padding:0.2rem 0.3rem;">P</th>
              <th style="text-align:right; padding:0.2rem 0.3rem;">W</th>
              <th style="text-align:right; padding:0.2rem 0.3rem;">L</th>
            </tr>
          </thead>
          <tbody>
            ${table.map((row, i) => `
            <tr style="border-top:1px solid var(--line);">
              <td style="padding:0.3rem; color:var(--text-faint);">${i + 1}</td>
              <td style="padding:0.3rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px;">${esc(row.team?.name ?? '?')}</td>
              <td style="padding:0.3rem; text-align:right;">${row.played}</td>
              <td style="padding:0.3rem; text-align:right; color:var(--green);">${row.wins}</td>
              <td style="padding:0.3rem; text-align:right; color:var(--text-faint);">${row.losses}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div style="display:flex; flex-direction:column; gap:0.45rem;">
          ${gm.map(m => matchCard(m, true)).join('')}
        </div>
      </div>`;
  }

  // ── Match card (both stages): single Start button, cups from match ────
  function matchCard(m, compact = false) {
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
      <div class="card" style="padding:0.55rem; ${live ? 'border-color:var(--green);' : ''} ${compact ? 'background:var(--surface-2); border-color:var(--line);' : ''}">
        ${side(nameA, m.team_a)}
        ${m.is_bye
          ? '<div style="font-size:0.65rem; color:var(--text-faint); padding:0.25rem 0.55rem;">bye — advances</div>'
          : `<div style="height:4px;"></div>${side(nameB, m.team_b)}`}
        ${live ? `<button data-open-game="${m.game_id}" class="btn btn-ghost btn-block"
            style="margin-top:0.45rem; padding:0.4rem; font-size:0.75rem;">● Live — open game</button>` : ''}
        ${decided && m.game_id ? `<button data-open-recap="${m.game_id}" class="btn btn-ghost btn-block"
            style="margin-top:0.45rem; padding:0.4rem; font-size:0.72rem;">View result</button>` : ''}
        ${ready && canHost && ctx.open ? `
          <button data-start="${m.id}" class="btn btn-primary btn-block"
            style="margin-top:0.45rem; padding:0.4rem; font-size:0.72rem;">▶ Start (${m.cup_count ?? 10} cups)</button>` : ''}
      </div>`;
  }

  // ── Handlers ──────────────────────────────────────────────────────────
  $el.querySelectorAll('[data-open-game]').forEach(b =>
    b.addEventListener('click', () => navigate(`#/game/${b.dataset.openGame}`)));
  $el.querySelectorAll('[data-open-recap]').forEach(b =>
    b.addEventListener('click', () => navigate(`#/game/${b.dataset.openRecap}/complete`)));
  $el.querySelectorAll('[data-start]').forEach(b =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      const match = ms.find(x => x.id === b.dataset.start);
      const { gameId, error } = await startMatchGame(eventId, match, teamsById);
      if (error) { toast(`Could not start: ${error}`, 'error'); b.disabled = false; return; }
      navigate(`#/game/${gameId}`);
    }));
  $el.querySelector('#gen-finals-btn')?.addEventListener('click', openFinalsSheet);
  $el.querySelector('#regen-finals-btn')?.addEventListener('click', () => {
    if (!window.confirm('Regenerate the finals bracket? Finals progress is discarded (finished games stay in History); the group stage is kept.')) return;
    openFinalsSheet();
  });
  $el.querySelector('#regen-all-btn')?.addEventListener('click', () => openGroupSheet(true));

  // ── Step 1 sheet: group stage (groups + cups) ─────────────────────────
  function openGroupSheet(isRegen) {
    if (isRegen && !window.confirm('Regenerate the group stage? ALL bracket progress — group stage and finals — is discarded (finished games stay in History).')) return;

    const maxGroups = Math.min(4, Math.floor(teams.length / 2));
    const groupOptions = Array.from({ length: maxGroups }, (_, i) => i + 1);
    const defaultCups = event?.group_cup_count ?? 10;

    const bd = sheet(`
      <h2>Generate group stage</h2>
      <p style="font-size:0.78rem; color:var(--text-dim); margin:-0.4rem 0 1rem;">
        ${teams.length} teams play a round-robin within each group.
        The finals bracket is generated separately once the group games are done.
      </p>
      <div class="field">
        <span class="label">Number of groups</span>
        <div class="pill-row" id="gs-groups">
          ${groupOptions.map(n => `<div class="pill ${n === Math.min(2, maxGroups) ? 'sel' : ''}" data-v="${n}">${n}</div>`).join('')}
        </div>
      </div>
      <div class="field">
        <span class="label">Cups per game (group stage)</span>
        <div class="pill-row" id="gs-cups">
          <div class="pill ${defaultCups === 6 ? 'sel' : ''}" data-v="6">6 cups</div>
          <div class="pill ${defaultCups === 10 ? 'sel' : ''}" data-v="10">10 cups</div>
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="gs-go">Generate group stage</button>
      <button class="btn btn-ghost btn-block" style="margin-top:8px;" data-close>Cancel</button>
    `);
    wirePills(bd, '#gs-groups');
    wirePills(bd, '#gs-cups');
    bd.querySelector('#gs-go').addEventListener('click', async e => {
      e.target.disabled = true;
      const numGroups = pillValue(bd, '#gs-groups');
      const cups = pillValue(bd, '#gs-cups');
      const { error } = await generateGroupStage(eventId, teams, numGroups, cups);
      if (error) { toast(`Could not generate: ${error}`, 'error'); e.target.disabled = false; return; }
      toast('Group stage generated 🏆', 'success');
      bd.remove();
      window.location.reload();
    });
  }

  // ── Step 2 sheet: finals (qualifiers + cups) ──────────────────────────
  function openFinalsSheet() {
    const numGroups = standings.length || 1;
    const groupSize = Math.max(...standings.map(t => t.length), 0);
    // Advance-per-group options: total qualifiers must be ≥ 2
    const opts = Array.from({ length: groupSize }, (_, i) => i + 1)
      .filter(n => n * numGroups >= 2 && n <= groupSize);
    const defaultAdv = opts.includes(2) && numGroups > 1 ? 2 : opts[0];
    const defaultCups = event?.finals_cup_count ?? 10;

    const bd = sheet(`
      <h2>Generate finals</h2>
      <p style="font-size:0.78rem; color:var(--text-dim); margin:-0.4rem 0 1rem;">
        The top teams of every group advance to a single-elimination bracket,
        seeded by their group standing.
        ${groupsDone ? '' : '<br><span style="color:var(--amber);">⚠️ Some group games are not finished yet — the current standings will be used.</span>'}
      </p>
      <div class="field">
        <span class="label">Teams advancing per group</span>
        <div class="pill-row" id="fs-adv">
          ${opts.map(n => `<div class="pill ${n === defaultAdv ? 'sel' : ''}" data-v="${n}">${n}</div>`).join('')}
        </div>
        <p style="font-size:0.68rem; color:var(--text-faint); margin-top:0.35rem;" id="fs-total"></p>
      </div>
      <div class="field">
        <span class="label">Cups per game (finals)</span>
        <div class="pill-row" id="fs-cups">
          <div class="pill ${defaultCups === 6 ? 'sel' : ''}" data-v="6">6 cups</div>
          <div class="pill ${defaultCups === 10 ? 'sel' : ''}" data-v="10">10 cups</div>
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="fs-go">Generate finals</button>
      <button class="btn btn-ghost btn-block" style="margin-top:8px;" data-close>Cancel</button>
    `);
    const updateTotal = () => {
      bd.querySelector('#fs-total').textContent =
        `${pillValue(bd, '#fs-adv') * numGroups} teams enter the finals bracket.`;
    };
    wirePills(bd, '#fs-adv', updateTotal);
    wirePills(bd, '#fs-cups');
    updateTotal();
    bd.querySelector('#fs-go').addEventListener('click', async e => {
      e.target.disabled = true;
      const adv = pillValue(bd, '#fs-adv');
      const cups = pillValue(bd, '#fs-cups');
      const { error } = await generateFinals(eventId, groupMatches, teamsById, adv, cups);
      if (error) { toast(`Could not generate: ${error}`, 'error'); e.target.disabled = false; return; }
      toast('Finals bracket generated 🏆', 'success');
      bd.remove();
      window.location.reload();
    });
  }

  // ── Sheet helpers ─────────────────────────────────────────────────────
  function sheet(inner) {
    const bd = document.createElement('div');
    bd.className = 'sheet-backdrop';
    bd.innerHTML = `<div class="sheet"><div class="sheet-handle"></div>${inner}</div>`;
    document.body.appendChild(bd);
    bd.addEventListener('click', e => { if (e.target === bd) bd.remove(); });
    bd.querySelector('[data-close]')?.addEventListener('click', () => bd.remove());
    return bd;
  }
  function wirePills(bd, sel, onChange) {
    bd.querySelectorAll(`${sel} .pill`).forEach(p =>
      p.addEventListener('click', () => {
        bd.querySelectorAll(`${sel} .pill`).forEach(x => x.classList.remove('sel'));
        p.classList.add('sel');
        onChange?.();
      }));
  }
  function pillValue(bd, sel) {
    return parseInt(bd.querySelector(`${sel} .pill.sel`)?.dataset.v ?? '0');
  }
}
