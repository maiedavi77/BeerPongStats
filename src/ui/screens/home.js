/**
 * src/ui/screens/home.js
 *
 * Play tab — lists active games the current user participates in.
 * Subscribes to Realtime on `games` so new invites appear live.
 * Returns a teardown function to unsubscribe on route change.
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
// Tab bar is managed centrally by app.js → updateTabBar(); no import needed here.

// Realtime channel reference (cleaned up on teardown)
let channel = null;

export default async function render($el, _params) {
  $el.innerHTML = `
    <div style="padding-bottom: 1rem;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1.5rem;">
        <h1 style="font-size:2.5rem; color:var(--purple);">PLAY</h1>
        <button id="new-game-btn" class="btn-primary" style="width:auto; padding:0.5rem 1rem;">
          + New Game
        </button>
      </div>
      <div id="games-list">
        <div class="empty-state">
          <p style="color:var(--text-faint);">Loading games…</p>
        </div>
      </div>
    </div>`;

  document.getElementById('new-game-btn')
    .addEventListener('click', () => navigate('#/game/new'));

  await loadGames();
  subscribeRealtime();

  // Return teardown — called by app.js when navigating away
  return () => {
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}

// ─── Data loading ─────────────────────────────────────────────────────────

async function loadGames() {
  const $list = document.getElementById('games-list');
  if (!$list) return;

  const userId = currentUser?.id;
  if (!userId) return;

  // Fetch active games where this user is a participant
  // Join game_participants → games, then compute cups remaining per team
  const { data: participations, error } = await supabase
    .from('game_participants')
    .select(`
      game_id,
      team,
      games!inner (
        id, cup_count, status, started_at,
        game_participants ( id, team, user_id,
          profiles ( display_name )
        )
      )
    `)
    .eq('user_id', userId)
    .eq('games.status', 'active')
    .order('games(started_at)', { ascending: false });

  if (error) {
    toast('Failed to load games', 'error');
    $list.innerHTML = `<div class="empty-state"><p style="color:var(--red);">Could not load games.</p></div>`;
    return;
  }

  // Deduplicate (user may appear as multiple participants in same game)
  const seen = new Set();
  const games = (participations ?? [])
    .map(p => p.games)
    .filter(g => g && !seen.has(g.id) && seen.add(g.id));

  if (games.length === 0) {
    $list.innerHTML = `
      <div class="empty-state">
        <h2 style="font-size:1.5rem;">No active games</h2>
        <p style="margin-top:0.5rem; color:var(--text-dim);">Tap + New Game to start one.</p>
      </div>`;
    return;
  }

  // Fetch cup counts for each game
  const gameIds = games.map(g => g.id);
  const { data: cups } = await supabase
    .from('cups')
    .select('game_id, team, status')
    .in('game_id', gameIds)
    .eq('status', 'standing');

  // Standing cups per team, then convert to cups TAKEN (the displayed score):
  //   A's score = cup_count − B standing.
  const standing = {};
  for (const c of cups ?? []) {
    if (!standing[c.game_id]) standing[c.game_id] = { A: 0, B: 0 };
    standing[c.game_id][c.team] = (standing[c.game_id][c.team] || 0) + 1;
  }
  const takenFor = game => {
    const s = standing[game.id] ?? { A: 0, B: 0 };
    return { A: game.cup_count - s.B, B: game.cup_count - s.A };
  };

  $list.innerHTML = games.map(game => renderGameCard(game, takenFor(game))).join('');

  // Attach click handlers
  $list.querySelectorAll('[data-game-id]').forEach(card => {
    card.addEventListener('click', () => navigate(`#/game/${card.dataset.gameId}`));
  });
}

function renderGameCard(game, cups) {
  const elapsed = formatElapsed(game.started_at);
  const participants = game.game_participants ?? [];
  const teamA = participants.filter(p => p.team === 'A').map(p => p.profiles?.display_name ?? '?').join(', ');
  const teamB = participants.filter(p => p.team === 'B').map(p => p.profiles?.display_name ?? '?').join(', ');

  return `
    <div class="card" data-game-id="${game.id}" style="
      cursor:pointer; margin-bottom:0.75rem;
      transition: background 0.15s;
    " onmouseenter="this.style.background='var(--surface-2)'"
       onmouseleave="this.style.background='var(--surface)'" >
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
        <span style="color:var(--text-faint); font-size:0.75rem;">${game.cup_count}-cup · ${elapsed}</span>
        <span style="color:var(--green); font-size:0.75rem; font-weight:500;">● LIVE</span>
      </div>
      <div style="display:flex; align-items:center; gap:1rem;">
        <div style="flex:1; text-align:center;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:2.5rem; color:var(--red); line-height:1;">${cups.A}</div>
          <div style="font-size:0.8rem; color:var(--text-dim); margin-top:0.25rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${teamA || 'Team A'}</div>
        </div>
        <div style="color:var(--text-faint); font-size:0.875rem;">vs</div>
        <div style="flex:1; text-align:center;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:2.5rem; color:var(--blue); line-height:1;">${cups.B}</div>
          <div style="font-size:0.8rem; color:var(--text-dim); margin-top:0.25rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${teamB || 'Team B'}</div>
        </div>
      </div>
    </div>`;
}

function formatElapsed(startedAt) {
  const ms = Date.now() - new Date(startedAt).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

// ─── Realtime ─────────────────────────────────────────────────────────────

function subscribeRealtime() {
  channel = supabase
    .channel('home-games')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games' },
      () => loadGames()
    )
    .subscribe();
}
