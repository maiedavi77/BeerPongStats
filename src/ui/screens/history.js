/**
 * src/ui/screens/history.js
 *
 * Completed/cancelled game history for the current user.
 * Newest first.
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';

export default async function render($el) {
  $el.innerHTML = `
    <div>
      <h1 style="font-size:2.5rem; color:var(--purple); margin-bottom:1.25rem;">HISTORY</h1>
      <div id="history-list">
        <div class="empty-state"><p style="color:var(--text-faint);">Loading…</p></div>
      </div>
    </div>`;

  await loadHistory();
}

async function loadHistory() {
  const $list = document.getElementById('history-list');
  if (!$list) return;

  const userId = currentUser?.id;

  const { data, error } = await supabase
    .from('game_participants')
    .select(`
      team,
      games!inner (
        id, cup_count, status, winner_team, started_at, ended_at,
        game_participants (
          team, user_id,
          profiles ( display_name )
        )
      )
    `)
    .eq('user_id', userId)
    .in('games.status', ['complete', 'cancelled'])
    .order('games(started_at)', { ascending: false })
    .limit(50);

  if (error) {
    toast('Failed to load history', 'error');
    $list.innerHTML = `<div class="empty-state"><p style="color:var(--red);">Could not load history.</p></div>`;
    return;
  }

  // Deduplicate by game id
  const seen = new Set();
  const games = (data ?? [])
    .map(p => ({ game: p.games, myTeam: p.team }))
    .filter(({ game }) => game && !seen.has(game.id) && seen.add(game.id));

  if (games.length === 0) {
    $list.innerHTML = `<div class="empty-state"><h2>No games yet</h2><p style="color:var(--text-dim); margin-top:0.5rem;">Complete a game to see it here.</p></div>`;
    return;
  }

  $list.innerHTML = games.map(({ game, myTeam }) => {
    const won = game.winner_team === myTeam;
    const cancelled = game.status === 'cancelled';
    const date = new Date(game.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const participants = game.game_participants ?? [];
    const teamA = participants.filter(p => p.team === 'A').map(p => p.profiles?.display_name ?? '?').join(', ');
    const teamB = participants.filter(p => p.team === 'B').map(p => p.profiles?.display_name ?? '?').join(', ');

    const resultColor = cancelled ? 'var(--text-faint)' : won ? 'var(--green)' : 'var(--red)';
    const resultLabel = cancelled ? 'Cancelled' : won ? 'Win' : 'Loss';

    return `
      <div class="card" data-game-id="${game.id}" style="
        display:flex; align-items:center; gap:0.75rem;
        margin-bottom:0.5rem; cursor:pointer;
      " onmouseenter="this.style.background='var(--surface-2)'"
         onmouseleave="this.style.background='var(--surface)'">
        <div style="text-align:center; min-width:36px;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:1.1rem; color:${resultColor};">${resultLabel}</div>
        </div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:0.85rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${teamA} <span style="color:var(--text-faint);">vs</span> ${teamB}
          </div>
          <div style="font-size:0.7rem; color:var(--text-faint);">${date} · ${game.cup_count}-cup</div>
        </div>
        <span style="color:var(--text-faint); font-size:0.9rem;">›</span>
      </div>`;
  }).join('');

  $list.querySelectorAll('[data-game-id]').forEach(el => {
    el.addEventListener('click', () => navigate(`#/game/${el.dataset.gameId}/complete`));
  });
}
