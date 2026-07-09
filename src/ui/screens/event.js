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

  // The bottom bar's "New"/"Board" tabs read the tournament flag
  try {
    sessionStorage.setItem('rackly_event_trichter', event.trichter_enabled === false ? '0' : '1');
    sessionStorage.setItem('rackly_event_tournament', event.is_tournament ? '1' : '0');
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

  // Sub-navigation chips (replaces the old per-event bottom tabs):
  // tournament events: Play · Teams · Bracket · Board · Gallery · History · Info
  // standard events:   Play · Trichter · Board · Gallery · History · Info
  const chips = TABS.filter(t => {
    if (t.key === 'trichter') return event.trichter_enabled !== false && !event.is_tournament;
    if (t.key === 'teams' || t.key === 'bracket') return event.is_tournament;
    return true;
  });

  $el.innerHTML = `
    <div>
      <div style="display:flex; align-items:center; gap:0.6rem; margin-bottom:0.5rem;">
        <button class="back-link" id="ev-back" style="flex-shrink:0;">‹ Events</button>
        <h1 style="font-size:1.35rem; letter-spacing:0.02em; margin:0; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;">
          ${esc(event.name)}${event.archived_at ? ' <span style="font-size:0.75rem; color:var(--text-faint); vertical-align:middle;">📦</span>' : ''}
        </h1>
      </div>
      ${event.is_tournament ? `<div style="font-size:0.72rem; color:var(--amber); margin:0 0 0.5rem;">🏆 Tournament${event.tracking_mode !== 'open' ? ` · tracking: ${({ hosts: 'hosts only', game_players: 'game players only', own_team: 'own team only' })[event.tracking_mode] ?? event.tracking_mode}` : ''}</div>` : ''}
      ${event.event_type === 'one_time' ? `
      <div style="font-size:0.72rem; color:${eventExpired(event) ? 'var(--text-faint)' : 'var(--amber)'}; margin:0 0 0.5rem;">
        ⚡ One-time event · ${eventExpired(event)
          ? 'ended — read-only'
          : eventInGrace(event)
            ? 'grace period — finish running games'
            : `ends ${new Date(event.ends_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
      </div>` : ''}
      <div class="ev-chips" style="display:flex; gap:0.4rem; overflow-x:auto; padding:0.15rem 0 0.7rem; margin:0 calc(-1 * var(--pad-screen)); padding-left:var(--pad-screen); padding-right:var(--pad-screen); -webkit-overflow-scrolling:touch; scrollbar-width:none;">
        ${chips.map(t => `
          <a href="#/event/${eventId}${t.key ? '/' + t.key : ''}"
             style="flex-shrink:0; padding:0.42rem 0.85rem; border-radius:99px; font-size:0.74rem; font-weight:${t.key === tab.key ? 700 : 600}; text-decoration:none; white-space:nowrap;
                    ${t.key === tab.key
                      ? 'background:var(--amber-dim); border:1.5px solid rgba(184,120,14,0.4); color:var(--amber);'
                      : 'background:rgba(255,255,255,0.024); border:1px solid var(--line); color:var(--text-faint);'}">
            ${t.label}
          </a>`).join('')}
      </div>
      ${!eventSubscribed(event) ? `
      <div class="card" style="border:1px solid var(--red); margin-bottom:0.9rem; padding:0.7rem 0.9rem;">
        <span style="color:#e8897c; font-size:0.82rem;">⚠️ Missing subscription — this event requires a tier its creator no longer has. It is read-only until the subscription is restored.</span>
      </div>` : ''}
      <div id="event-view"></div>
    </div>`;

  document.getElementById('ev-back').addEventListener('click', () =>
    navigate(event.archived_at ? '#/past' : '#/'));

  const $view = document.getElementById('event-view');
  const ctx = {
    eventId, event, isParticipant, isAdmin, role, canManage, canHostGames,
    open: eventOpen(event),
    closedReason: eventClosedReason(event),
  };
  return await tab.render($view, ctx) ?? null;
}
