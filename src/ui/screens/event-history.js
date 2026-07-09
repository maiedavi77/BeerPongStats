/**
 * src/ui/screens/event-history.js
 *
 * Event sub-view: completed and cancelled games of this event, newest first.
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
import { esc, shortDate } from '../../format.js';
import { participantDisplayName } from './event-play.js';

export default async function render($el, ctx) {
  $el.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">Loading…</p></div>`;

  const { data, error } = await supabase
    .from('games')
    .select(`
      id, cup_count, status, winner_team, started_at,
      game_participants ( team, participant_type, user_id, temp_user_id,
        profiles ( display_name ), event_temp_users ( display_name ) )
    `)
    .eq('event_id', ctx.eventId)
    .in('status', ['complete', 'cancelled'])
    .order('started_at', { ascending: false })
    .limit(50);

  if (error) {
    toast('Failed to load history', 'error');
    $el.innerHTML = `<div class="empty-state"><p style="color:var(--red);">Could not load history.</p></div>`;
    return;
  }

  if (!data?.length) {
    $el.innerHTML = `<div class="empty-state"><h2>No games yet</h2>
      <p style="color:var(--text-dim); margin-top:0.5rem;">Complete a game to see it here.</p></div>`;
    return;
  }

  $el.innerHTML = data.map(game => {
    const cancelled = game.status === 'cancelled';
    const participants = game.game_participants ?? [];
    const myTeam = participants.find(p => p.user_id === currentUser?.id)?.team ?? null;
    const won = myTeam && game.winner_team === myTeam;

    const names = team => participants.filter(p => p.team === team)
      .map(p => esc(participantDisplayName(p))).join(', ');

    const resultColor = cancelled ? 'var(--text-faint)'
      : myTeam ? (won ? 'var(--green)' : 'var(--red)')
      : (game.winner_team === 'A' ? 'var(--red)' : 'var(--blue)');
    const resultLabel = cancelled ? 'Cancelled'
      : myTeam ? (won ? 'Win' : 'Loss')
      : `${game.winner_team} won`;

    return `
      <div class="card" data-game-id="${game.id}" style="
        display:flex; align-items:center; gap:0.75rem; margin-bottom:0.5rem; cursor:pointer;"
        onmouseenter="this.style.background='var(--surface-2)'"
        onmouseleave="this.style.background='var(--surface)'">
        <div style="text-align:center; min-width:52px;">
          <div style="font-family:'Syne',sans-serif;font-weight:800; font-size:1.1rem; color:${resultColor};">${resultLabel}</div>
        </div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:0.85rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${names('A')} <span style="color:var(--text-faint);">vs</span> ${names('B')}
          </div>
          <div style="font-size:0.7rem; color:var(--text-faint);">${shortDate(game.started_at)} · ${game.cup_count}-cup</div>
        </div>
        <span style="color:var(--text-faint); font-size:0.9rem;">›</span>
      </div>`;
  }).join('');

  $el.querySelectorAll('[data-game-id]').forEach(el => {
    el.addEventListener('click', () => navigate(`#/game/${el.dataset.gameId}/complete`));
  });
}
