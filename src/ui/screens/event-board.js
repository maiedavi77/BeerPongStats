/**
 * src/ui/screens/event-board.js
 *
 * Event sub-view: the leaderboard scoped to one event, with the same three
 * views as before (Games / Trichter / Overall). Guests appear in the Games
 * and Trichter views (marked, not clickable); the Overall RACKED Score is
 * computed for registered players within this event only.
 *
 * RACKED Score: same formula as documented in CHANGES.md — same
 * formula, event-scoped inputs.
 */

import { supabase } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
import { formatDuration, esc } from '../../format.js';
import { avatarHtml } from '../../photos.js';

const SCORE_WEIGHTS = { winRate: 0.40, accuracy: 0.25, activity: 0.15, tCount: 0.10, tSpeed: 0.10 };

const VIEWS = [
  { key: 'games',    label: 'Games'    },
  { key: 'trichter', label: 'Trichter' },
  { key: 'overall',  label: 'Overall'  },
];

const GAME_SORTS = [
  { key: 'winPct',   label: 'Win %'    },
  { key: 'wins',     label: 'Wins'     },
  { key: 'accuracy', label: 'Accuracy' },
  { key: 'cups',     label: 'Cups'     },
  { key: 'dodges',   label: 'Dodges'   },
];

const TRICHTER_SORTS = [
  { key: 'count', label: 'Count'     },
  { key: 'best',  label: 'Best time' },
];

let _view = 'games';
let _gameSort = 'winPct';
let _trichterSort = 'count';
let _players = [];
let _trichterRows = [];
let _overall = [];
let _eventId = null;

export default async function render($el, ctx) {
  _eventId = ctx.eventId;

  $el.innerHTML = `
    <div>
      <div id="view-tabs" style="display:flex; gap:0.5rem; margin-bottom:0.75rem;">
        ${VIEWS.map(v => `
          <button class="view-tab" data-view="${v.key}" style="
            flex:1; padding:0.5rem; border-radius:10px; font-size:0.85rem; font-weight:600;
            border:none; cursor:pointer;">${v.label}</button>`).join('')}
      </div>
      <div id="sort-chips" style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem;"></div>
      <div id="board-list"><div class="empty-state"><p style="color:var(--text-faint);">Loading…</p></div></div>
      <div id="score-info" style="display:none; margin-top:1rem; font-size:0.72rem; color:var(--text-faint); line-height:1.6;" class="card">
        <b style="color:var(--text-dim);">RACKED Score</b> = 1000 × (0.40·win rate + 0.25·accuracy +
        0.15·activity + 0.10·trichter count + 0.10·trichter speed) — all within this event.
        Win rate and accuracy are smoothed so one lucky game can't top the board.
      </div>
    </div>`;

  $el.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => { _view = tab.dataset.view; renderView(); });
  });

  await loadData(ctx.eventId);
  renderView();
}

// ─── Data ───────────────────────────────────────────────────────────────────

async function loadData(eventId) {
  const [{ data: games, error: gErr }, { data: trichters }] = await Promise.all([
    supabase
      .from('games')
      .select(`
        id, winner_team, cup_count,
        game_participants ( team, participant_type, user_id, temp_user_id,
          profiles ( id, display_name, is_active, avatar_path ), event_temp_users ( display_name ) )
      `)
      .eq('event_id', eventId)
      .eq('status', 'complete'),
    supabase
      .from('trichters')
      .select('person_user_id, person_name, duration_ms')
      .eq('event_id', eventId),
  ]);

  if (gErr) { toast('Failed to load board', 'error'); return; }

  const gameIds = (games ?? []).map(g => g.id);
  let throws = [];
  if (gameIds.length > 0) {
    const { data: throwData } = await supabase
      .from('throws')
      .select('game_id, thrower_type, thrower_user_id, thrower_temp_id, outcome')
      .in('game_id', gameIds);
    throws = throwData ?? [];
  }

  _players = computeGameStats(games ?? [], throws);
  _trichterRows = computeTrichterStats(trichters ?? []);
  _overall = computeOverall(_players, _trichterRows);
}

function pKey(p) { return p.participant_type === 'temp' ? `t:${p.temp_user_id}` : `u:${p.user_id}`; }
function tKey(t) { return t.thrower_type === 'temp' ? `t:${t.thrower_temp_id}` : `u:${t.thrower_user_id}`; }

function computeGameStats(games, throws) {
  const stats = {};

  for (const game of games) {
    const winner = game.winner_team;
    for (const p of game.game_participants ?? []) {
      const isGuest = p.participant_type === 'temp';
      if (!isGuest && (!p.user_id || !p.profiles?.is_active)) continue;
      const key = pKey(p);
      if (!stats[key]) {
        stats[key] = {
          key,
          userId: isGuest ? null : p.user_id,
          name: isGuest ? (p.event_temp_users?.display_name ?? 'Guest') : p.profiles.display_name,
          avatar: isGuest ? null : (p.profiles.avatar_path ?? null),
          isGuest,
          wins: 0, losses: 0, cups: 0, dodges: 0, throwsTotal: 0, hits: 0,
        };
      }
      if (winner === p.team) stats[key].wins++;
      else stats[key].losses++;
    }
  }

  for (const t of throws) {
    const key = tKey(t);
    if (!stats[key]) continue;
    stats[key].throwsTotal++;
    const isHit = t.outcome === 'hit' || t.outcome === 'dodge';
    if (isHit) { stats[key].cups++; stats[key].hits++; }
    if (t.outcome === 'dodge') stats[key].dodges++;
  }

  return Object.values(stats).map(s => ({
    ...s,
    games: s.wins + s.losses,
    winPct: s.wins + s.losses > 0 ? Math.round((s.wins / (s.wins + s.losses)) * 100) : 0,
    accuracy: s.throwsTotal > 0 ? Math.round((s.hits / s.throwsTotal) * 100) : 0,
  })).filter(s => s.games > 0);
}

function computeTrichterStats(trichters) {
  const byPerson = {};
  for (const t of trichters) {
    const key = t.person_user_id ?? `name:${(t.person_name ?? '').trim().toLowerCase()}`;
    if (!key || key === 'name:') continue;
    if (!byPerson[key]) {
      byPerson[key] = { userId: t.person_user_id ?? null, name: t.person_name, count: 0, best: Infinity, totalMs: 0 };
    }
    const row = byPerson[key];
    row.count++;
    row.totalMs += t.duration_ms;
    if (t.duration_ms < row.best) row.best = t.duration_ms;
  }
  return Object.values(byPerson).map(r => ({ ...r, avg: Math.round(r.totalMs / r.count) }));
}

function computeOverall(players, trichterRows) {
  const trichterByUid = new Map(trichterRows.filter(t => t.userId).map(t => [t.userId, t]));
  const bests = [...trichterByUid.values()].map(t => t.best).filter(b => Number.isFinite(b));
  const groupFastest = bests.length ? Math.min(...bests) : null;

  return players.filter(p => !p.isGuest).map(p => {
    const t = trichterByUid.get(p.userId);
    const winRate  = (p.wins + 3) / (p.games + 6);
    const accuracy = (p.hits + 3) / (p.throwsTotal + 10);
    const activity = Math.min(p.games, 20) / 20;
    const tCount   = Math.min(t?.count ?? 0, 10) / 10;
    const tSpeed   = (t && groupFastest) ? groupFastest / t.best : 0;

    const score = Math.round(1000 * (
      SCORE_WEIGHTS.winRate  * winRate +
      SCORE_WEIGHTS.accuracy * accuracy +
      SCORE_WEIGHTS.activity * activity +
      SCORE_WEIGHTS.tCount   * tCount +
      SCORE_WEIGHTS.tSpeed   * tSpeed
    ));

    return { ...p, trichterCount: t?.count ?? 0, trichterBest: t?.best ?? null, score };
  });
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderView() {
  document.querySelectorAll('.view-tab').forEach(tab => {
    const active = tab.dataset.view === _view;
    tab.style.background = active ? 'var(--purple)' : 'var(--surface-3)';
    tab.style.color = active ? '#fff' : 'var(--text-dim)';
  });

  const $chips = document.getElementById('sort-chips');
  const $info = document.getElementById('score-info');
  if ($info) $info.style.display = _view === 'overall' ? 'block' : 'none';
  if (!$chips) return;

  const sorts = _view === 'games' ? GAME_SORTS : _view === 'trichter' ? TRICHTER_SORTS : [];
  const activeSort = _view === 'games' ? _gameSort : _trichterSort;

  $chips.innerHTML = sorts.map(o => `
    <button class="sort-chip" data-sort="${o.key}" style="
      padding:0.3rem 0.7rem; border-radius:999px; font-size:0.75rem; font-weight:500;
      background:${o.key === activeSort ? 'var(--purple)' : 'var(--surface-3)'};
      color:${o.key === activeSort ? '#fff' : 'var(--text-dim)'};
      border:none; cursor:pointer;">${o.label}</button>`).join('');

  $chips.querySelectorAll('.sort-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (_view === 'games') _gameSort = chip.dataset.sort;
      else _trichterSort = chip.dataset.sort;
      renderView();
    });
  });

  if (_view === 'games') renderGamesList();
  else if (_view === 'trichter') renderTrichterList();
  else renderOverallList();
}

function rowShell(rank, inner, right, uid = null) {
  return `
    <div class="card" ${uid ? `data-uid="${uid}"` : ''} style="
      display:flex; align-items:center; gap:0.75rem; margin-bottom:0.5rem;
      ${uid ? 'cursor:pointer;' : ''}"
      ${uid ? `onmouseenter="this.style.background='var(--surface-2)'" onmouseleave="this.style.background='var(--surface)'"` : ''}>
      <span style="font-family:'Bebas Neue',sans-serif; font-size:1.5rem; color:var(--text-faint); min-width:1.5rem;">${rank}</span>
      <div style="flex:1; min-width:0;">${inner}</div>
      <div style="text-align:right; font-family:'Bebas Neue',sans-serif; font-size:1.5rem; color:var(--purple);">${right}</div>
    </div>`;
}

function attachProfileNav($list) {
  $list.querySelectorAll('[data-uid]').forEach(el => {
    el.addEventListener('click', () => navigate(`#/event/${_eventId}/profile/${el.dataset.uid}`));
  });
}

const guestTag = ' <span style="font-size:0.65rem; color:var(--text-faint);">(guest)</span>';

function renderGamesList() {
  const $list = document.getElementById('board-list');
  if (!$list) return;
  const sorted = [..._players].sort((a, b) => b[_gameSort] - a[_gameSort]);
  if (!sorted.length) {
    $list.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">No completed games in this event yet.</p></div>`;
    return;
  }
  $list.innerHTML = sorted.map((p, i) => rowShell(i + 1, `
      <div class="picker-row-avatar" style="display:flex; align-items:center; gap:0.5rem; min-width:0;">
        ${avatarHtml(p.name, p.avatar)}
        <div style="min-width:0;">
          <div style="font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(p.name)}${p.isGuest ? guestTag : ''}</div>
          <div style="font-size:0.72rem; color:var(--text-faint);">${p.wins}W · ${p.losses}L · ${p.accuracy}% acc</div>
        </div>
      </div>`,
    _gameSort === 'winPct' ? `${p.winPct}%` : _gameSort === 'accuracy' ? `${p.accuracy}%` : p[_gameSort],
    p.userId,
  )).join('');
  attachProfileNav($list);
}

function renderTrichterList() {
  const $list = document.getElementById('board-list');
  if (!$list) return;
  const sorted = [..._trichterRows].sort((a, b) =>
    _trichterSort === 'best' ? a.best - b.best : b.count - a.count);
  if (!sorted.length) {
    $list.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">No trichters in this event yet.</p></div>`;
    return;
  }
  $list.innerHTML = sorted.map((t, i) => rowShell(i + 1, `
      <div style="font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(t.name)}${t.userId ? '' : guestTag}</div>
      <div style="font-size:0.72rem; color:var(--text-faint);">best ${formatDuration(t.best)} · avg ${formatDuration(t.avg)}</div>`,
    _trichterSort === 'best' ? formatDuration(t.best) : `${t.count}×`,
    t.userId,
  )).join('');
  attachProfileNav($list);
}

function renderOverallList() {
  const $list = document.getElementById('board-list');
  if (!$list) return;
  const sorted = [..._overall].sort((a, b) => b.score - a.score);
  if (!sorted.length) {
    $list.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">No completed games in this event yet.</p></div>`;
    return;
  }
  $list.innerHTML = sorted.map((p, i) => rowShell(i + 1, `
      <div class="picker-row-avatar" style="display:flex; align-items:center; gap:0.5rem; min-width:0;">
        ${avatarHtml(p.name, p.avatar)}
        <div style="min-width:0;">
          <div style="font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(p.name)}</div>
          <div style="font-size:0.72rem; color:var(--text-faint);">
            ${p.wins}W-${p.losses}L · ${p.accuracy}% acc · ${p.trichterCount}× 🌀${p.trichterBest ? ' · best ' + formatDuration(p.trichterBest) : ''}
          </div>
        </div>
      </div>`,
    p.score,
    p.userId,
  )).join('');
  attachProfileNav($list);
}
