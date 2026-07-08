/**
 * src/ui/screens/event.js
 *
 * Event container: header + inner tab navigation, delegating to sub-views.
 * Routes: /event/:eventId[/board|/trichter|/gallery|/history]
 *
 * Access: RLS already prevents non-participants from reading the event; the
 * container additionally shows a friendly gate when the event can't be read.
 * Admins can manage members from here (add via multi-select, remove).
 */

import { currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { getEvent, myEventRole, eventOpen, eventClosedReason, eventSubscribed, eventInGrace, eventExpired } from '../../events-data.js';
import { esc } from '../../format.js';

import renderPlay     from './event-play.js';
import renderBoard    from './event-board.js';
import renderTrichter from './event-trichter.js';
import renderGallery  from './event-gallery.js';
import renderHistory  from './event-history.js';
import renderInfo     from './event-info.js';
import renderTeams    from './event-teams.js';
import renderBracket  from './event-bracket.js';

const TABS = [
  { key: '',         label: 'Play',     render: renderPlay },
  { key: 'trichter', label: 'Trichter', render: renderTrichter },
  { key: 'teams',    label: 'Teams',    render: renderTeams },
  { key: 'bracket',  label: 'Bracket',  render: renderBracket },
  { key: 'board',    label: 'Board',    render: renderBoard },
  { key: 'gallery',  label: 'Gallery',  render: renderGallery },
  { key: 'history',  label: 'History',  render: renderHistory },
  { key: 'info',     label: 'Info',     render: renderInfo },
];

export default async function render($el, params) {
  const eventId = params.eventId;
  const sub = (params._path ?? '').split('/')[3] ?? '';
  const tab = TABS.find(t => t.key === sub) ?? TABS[0];

  const { event, error } = await getEvent(eventId);
  if (error || !event) {
    $el.innerHTML = `<div class="empty-state">
      <h2>Event not available</h2>
      <p style="color:var(--text-faint);">You may not be a member of this event.</p>
      <a class="btn btn-ghost" href="#/">‹ All events</a>
    </div>`;
    return;
  }

  const role = await myEventRole(eventId);
  const isParticipant = role !== null;
  const isAdmin = !!currentUser?.is_admin;
  const canManage = isAdmin || role === 'creator' || role === 'co_creator';
  const canHostGames = canManage || role === 'game_host' || isParticipant; // standard events: any participant

  // Trichter can be disabled per event → hide the tab (bottom nav reads
  // this flag; see tab-bar.js).
  try {
    sessionStorage.setItem('racked_event_trichter', event.trichter_enabled === false ? '0' : '1');
    sessionStorage.setItem('racked_event_tournament', event.is_tournament ? '1' : '0');
  } catch { /* private mode */ }

  // Redirect away from hidden tabs (deep links)
  if (event.trichter_enabled === false && sub === 'trichter') {
    navigate(`#/event/${eventId}`);
    return;
  }
  if (!event.is_tournament && (sub === 'teams' || sub === 'bracket')) {
    navigate(`#/event/${eventId}`);
    return;
  }

  $el.innerHTML = `
    <div>
      <div class="live-header" style="margin-bottom:0.25rem;">
        <button class="back-link" id="ev-back">‹ Events</button>
        <button class="back-link" id="ev-info-btn" style="color:var(--purple);">ℹ️ Info</button>
      </div>
      <h1 style="font-size:2rem; color:var(--purple); margin-bottom:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${esc(event.name)}${event.archived_at ? ' <span style="font-size:0.85rem; color:var(--text-faint); vertical-align:middle;">📦 archived</span>' : ''}
      </h1>
      ${event.is_tournament ? `<div style="font-size:0.75rem; color:var(--purple); margin:-0.4rem 0 0.75rem;">🏆 Tournament${event.tracking_mode !== 'open' ? ` · tracking: ${({ hosts: 'hosts only', game_players: 'game players only', own_team: 'own team only' })[event.tracking_mode] ?? event.tracking_mode}` : ''}</div>` : ''}
      ${event.event_type === 'one_time' ? `
      <div style="font-size:0.75rem; color:${eventExpired(event) ? 'var(--text-faint)' : 'var(--amber)'}; margin:-0.4rem 0 0.75rem;">
        ⚡ One-time event · ${eventExpired(event)
          ? 'ended — read-only'
          : eventInGrace(event)
            ? 'grace period — finish running games'
            : `ends ${new Date(event.ends_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
      </div>` : ''}
      ${!eventSubscribed(event) ? `
      <div class="card" style="border:1px solid var(--red); margin-bottom:0.9rem; padding:0.7rem 0.9rem;">
        <span style="color:#F2A093; font-size:0.82rem;">⚠️ Missing subscription — this event requires a tier its creator no longer has. It is read-only until the subscription is restored.</span>
      </div>` : ''}
      <div id="event-view"></div>
    </div>`;

  document.getElementById('ev-back').addEventListener('click', () =>
    navigate(event.archived_at ? '#/past' : '#/'));
  document.getElementById('ev-info-btn').addEventListener('click', () =>
    navigate(`#/event/${eventId}/info`));

  const $view = document.getElementById('event-view');
  const ctx = {
    eventId, event, isParticipant, isAdmin, role, canManage, canHostGames,
    open: eventOpen(event),
    closedReason: eventClosedReason(event),
  };
  return await tab.render($view, ctx) ?? null;
}
