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
import { getEvent, amParticipant, eventOpen, eventClosedReason } from '../../events-data.js';
import { esc } from '../../format.js';

import renderPlay     from './event-play.js';
import renderBoard    from './event-board.js';
import renderTrichter from './event-trichter.js';
import renderGallery  from './event-gallery.js';
import renderHistory  from './event-history.js';
import renderInfo     from './event-info.js';

const TABS = [
  { key: '',         label: 'Play',     render: renderPlay },
  { key: 'trichter', label: 'Trichter', render: renderTrichter },
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
      <button class="btn btn-ghost" onclick="location.hash='#/'">‹ All events</button>
    </div>`;
    return;
  }

  const isParticipant = await amParticipant(eventId);
  const isAdmin = !!currentUser?.is_admin;

  $el.innerHTML = `
    <div>
      <div class="live-header" style="margin-bottom:0.25rem;">
        <button class="back-link" id="ev-back">‹ Events</button>
        <button class="back-link" id="ev-info-btn" style="color:var(--purple);">ℹ️ Info</button>
      </div>
      <h1 style="font-size:2rem; color:var(--purple); margin-bottom:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${esc(event.name)}${event.archived_at ? ' <span style="font-size:0.85rem; color:var(--text-faint); vertical-align:middle;">📦 archived</span>' : ''}
      </h1>
      <div id="event-view"></div>
    </div>`;

  document.getElementById('ev-back').addEventListener('click', () =>
    navigate(event.archived_at ? '#/past' : '#/'));
  document.getElementById('ev-info-btn').addEventListener('click', () =>
    navigate(`#/event/${eventId}/info`));

  const $view = document.getElementById('event-view');
  const ctx = {
    eventId, event, isParticipant, isAdmin,
    open: eventOpen(event),
    closedReason: eventClosedReason(event),
  };
  return await tab.render($view, ctx) ?? null;
}
