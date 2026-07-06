/**
 * src/ui/screens/event-play.js
 *
 * Event sub-view: active games of this event. Any participant can open a
 * game (to score or spectate) and start a new one.
 */

import { supabase } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
import { esc } from '../../format.js';

let channel = null;

export default async function render($el, ctx) {
  const { eventId, isParticipant } = ctx;

  $el.innerHTML = `
    <div>
      ${isParticipant && ctx.open
        ? `<button id="new-game-btn" class="btn btn-primary btn-block" style="margin-bottom:1rem;">+ New game</button>`
        : ''}
      ${isParticipant && !ctx.open
        ? `<div class="card" style="margin-bottom:1rem; text-align:center; color:var(--text-faint); font-size:0.8rem;">
             ${ctx.closedReason} — no new games can be started.</div>`
        : ''}
      <div id="games-list">
        <div class="empty-state"><p style="color:var(--text-faint);">Loading games…</p></div>
      </div>
    </div>`;

  document.getElementById('new-game-btn')
    ?.addEventListener('click', () => navigate(`#/event/${eventId}/game/new`));

  await loadGames(eventId);

  channel = supabase
    .channel(`event-play-${eventId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'games', filter: `event_id=eq.${eventId}` },
      () => loadGames(eventId))
    .subscribe();

  return () => {
    if (channel) { supabase.removeChannel(channel); channel = null; }
  };
}

async function loadGames(eventId) {
  const $list = document.getElementById('games-list');
  if (!$list) return;

  const { data: games, error } = await supabase
    .from('games')
    .select(`
      id, cup_count, status, started_at,
      game_participants ( team, participant_type, user_id, temp_user_id,
        profiles ( display_name ), event_temp_users ( display_name ) )
    `)
    .eq('event_id', eventId)
    .eq('status', 'active')
    .order('started_at', { ascending: false });

  if (error) {
    toast('Failed to load games', 'error');
    $list.innerHTML = `<div class="empty-state"><p style="color:var(--red);">Could not load games.</p></div>`;
    return;
  }

  if (!games?.length) {
    $list.innerHTML = `
      <div class="empty-state">
        <h2 style="font-size:1.5rem;">No active games</h2>
        <p style="margin-top:0.5rem; color:var(--text-dim);">Start one and rack 'em up.</p>
      </div>`;
    return;
  }

  const gameIds = games.map(g => g.id);
  const { data: cups } = await supabase
    .from('cups')
    .select('game_id, team, status')
    .in('game_id', gameIds)
    .eq('status', 'standing');

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
  $list.querySelectorAll('[data-game-id]').forEach(card => {
    card.addEventListener('click', () => navigate(`#/game/${card.dataset.gameId}`));
  });
}

export function participantDisplayName(p) {
  return p.participant_type === 'temp'
    ? `${p.event_temp_users?.display_name ?? 'Guest'}`
    : (p.profiles?.display_name ?? '?');
}

function renderGameCard(game, cups) {
  const elapsed = formatElapsed(game.started_at);
  const participants = game.game_participants ?? [];
  const teamNames = team => participants
    .filter(p => p.team === team)
    .map(p => esc(participantDisplayName(p)) + (p.participant_type === 'temp' ? '\u2009*' : ''))
    .join(', ');

  return `
    <div class="card" data-game-id="${game.id}" style="cursor:pointer; margin-bottom:0.75rem; transition:background 0.15s;"
      onmouseenter="this.style.background='var(--surface-2)'"
      onmouseleave="this.style.background='var(--surface)'">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
        <span style="color:var(--text-faint); font-size:0.75rem;">${game.cup_count}-cup · ${elapsed}</span>
        <span style="color:var(--green); font-size:0.75rem; font-weight:500;">● LIVE</span>
      </div>
      <div style="display:flex; align-items:center; gap:1rem;">
        <div style="flex:1; text-align:center;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:2.5rem; color:var(--red); line-height:1;">${cups.A}</div>
          <div style="font-size:0.8rem; color:var(--text-dim); margin-top:0.25rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${teamNames('A') || 'Team A'}</div>
        </div>
        <div style="color:var(--text-faint); font-size:0.875rem;">vs</div>
        <div style="flex:1; text-align:center;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:2.5rem; color:var(--blue); line-height:1;">${cups.B}</div>
          <div style="font-size:0.8rem; color:var(--text-dim); margin-top:0.25rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${teamNames('B') || 'Team B'}</div>
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
