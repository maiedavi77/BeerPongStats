/**
 * src/ui/screens/leaderboard.js
 *
 * Global leaderboard — ranks players by stats from completed games.
 * Sort chips: win% (default), wins, accuracy, cups, dodges.
 */

import { supabase } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../toast.js';

const SORT_OPTIONS = [
  { key: 'winPct',   label: 'Win %'    },
  { key: 'wins',     label: 'Wins'     },
  { key: 'accuracy', label: 'Accuracy' },
  { key: 'cups',     label: 'Cups'     },
  { key: 'dodges',   label: 'Dodges'   },
];

let _sortKey = 'winPct';
let _players = [];
let _realtimeChannel = null;

export default async function render($el) {
  $el.innerHTML = `
    <div>
      <h1 style="font-size:2.5rem; color:var(--purple); margin-bottom:1rem;">BOARD</h1>

      <!-- Sort chips -->
      <div id="sort-chips" style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem;">
        ${SORT_OPTIONS.map(o => `
          <button class="sort-chip" data-sort="${o.key}" style="
            padding:0.3rem 0.7rem; border-radius:999px; font-size:0.75rem; font-weight:500;
            background:${o.key === _sortKey ? 'var(--purple)' : 'var(--surface-3)'};
            color:${o.key === _sortKey ? '#fff' : 'var(--text-dim)'};
            border:none; cursor:pointer;
          ">${o.label}</button>`).join('')}
      </div>

      <div id="leaderboard-list">
        <div class="empty-state"><p style="color:var(--text-faint);">Loading…</p></div>
      </div>
    </div>`;

  document.querySelectorAll('.sort-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      _sortKey = chip.dataset.sort;
      // Update chip styles
      document.querySelectorAll('.sort-chip').forEach(c => {
        const active = c.dataset.sort === _sortKey;
        c.style.background = active ? 'var(--purple)' : 'var(--surface-3)';
        c.style.color = active ? '#fff' : 'var(--text-dim)';
      });
      renderList();
    });
  });

  await loadLeaderboard();
  subscribeRealtime();

  return () => {
    if (_realtimeChannel) { supabase.removeChannel(_realtimeChannel); _realtimeChannel = null; }
  };
}

async function loadLeaderboard() {
  // Load all completed games with participants and throws
  const { data: games, error } = await supabase
    .from('games')
    .select(`
      id, winner_team, cup_count,
      game_participants (
        team, user_id,
        profiles ( id, display_name, is_active )
      )
    `)
    .eq('status', 'complete');

  if (error) { toast('Failed to load leaderboard', 'error'); return; }

  // Load throws for all those games
  const gameIds = (games ?? []).map(g => g.id);
  let throws = [];
  if (gameIds.length > 0) {
    const { data: throwData } = await supabase
      .from('throws')
      .select('game_id, thrower_user_id, outcome')
      .in('game_id', gameIds);
    throws = throwData ?? [];
  }

  _players = computeLeaderboard(games ?? [], throws);
  renderList();
}

function computeLeaderboard(games, throws) {
  const stats = {}; // userId → stats

  for (const game of games) {
    const winner = game.winner_team;
    for (const p of game.game_participants ?? []) {
      if (!p.user_id || !p.profiles?.is_active) continue;
      const uid = p.user_id;
      if (!stats[uid]) {
        stats[uid] = {
          userId: uid,
          name: p.profiles.display_name,
          wins: 0, losses: 0, cups: 0, dodges: 0,
          throwsTotal: 0, hits: 0,
        };
      }
      if (winner === p.team) stats[uid].wins++;
      else stats[uid].losses++;
    }
  }

  for (const t of throws) {
    const uid = t.thrower_user_id;
    if (!uid || !stats[uid]) continue;
    stats[uid].throwsTotal++;
    if (t.outcome === 'hit') stats[uid].cups++;
    if (t.outcome === 'dodge') stats[uid].dodges++;
    if (t.outcome === 'hit') stats[uid].hits++;
  }

  return Object.values(stats).map(s => ({
    ...s,
    winPct: s.wins + s.losses > 0 ? Math.round((s.wins / (s.wins + s.losses)) * 100) : 0,
    accuracy: s.throwsTotal > 0 ? Math.round((s.hits / s.throwsTotal) * 100) : 0,
  })).filter(s => s.wins + s.losses > 0);
}

function renderList() {
  const $list = document.getElementById('leaderboard-list');
  if (!$list) return;

  const sorted = [..._players].sort((a, b) => b[_sortKey] - a[_sortKey]);

  if (sorted.length === 0) {
    $list.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">No completed games yet.</p></div>`;
    return;
  }

  $list.innerHTML = sorted.map((p, i) => `
    <div class="card" data-uid="${p.userId}" style="
      display:flex; align-items:center; gap:0.75rem;
      margin-bottom:0.5rem; cursor:pointer;
    " onmouseenter="this.style.background='var(--surface-2)'"
       onmouseleave="this.style.background='var(--surface)'">
      <span style="font-family:'Bebas Neue',sans-serif; font-size:1.5rem; color:var(--text-faint); min-width:1.5rem;">${i + 1}</span>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name}</div>
        <div style="font-size:0.72rem; color:var(--text-faint);">${p.wins}W · ${p.losses}L · ${p.accuracy}% acc</div>
      </div>
      <div style="text-align:right; font-family:'Bebas Neue',sans-serif; font-size:1.5rem; color:var(--purple);">
        ${_sortKey === 'winPct' ? `${p.winPct}%` :
          _sortKey === 'accuracy' ? `${p.accuracy}%` :
          p[_sortKey]}
      </div>
    </div>`).join('');

  $list.querySelectorAll('[data-uid]').forEach(el => {
    el.addEventListener('click', () => navigate(`#/profile/${el.dataset.uid}`));
  });
}

function subscribeRealtime() {
  _realtimeChannel = supabase
    .channel('leaderboard')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games' },
      (p) => { if (p.new?.status === 'complete') loadLeaderboard(); })
    .subscribe();
}
