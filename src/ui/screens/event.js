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

import { supabase, currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
import { getEvent, eventMembers, addMembers, removeMember, amParticipant } from '../../events-data.js';
import { esc } from '../../format.js';

import renderPlay     from './event-play.js';
import renderBoard    from './event-board.js';
import renderTrichter from './event-trichter.js';
import renderGallery  from './event-gallery.js';
import renderHistory  from './event-history.js';

const TABS = [
  { key: '',         label: 'Play',     render: renderPlay },
  { key: 'board',    label: 'Board',    render: renderBoard },
  { key: 'trichter', label: 'Trichter', render: renderTrichter },
  { key: 'gallery',  label: 'Gallery',  render: renderGallery },
  { key: 'history',  label: 'History',  render: renderHistory },
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
        ${isAdmin ? '<button class="back-link" id="ev-members-btn" style="color:var(--purple);">Members ⚙</button>' : ''}
      </div>
      <h1 style="font-size:2rem; color:var(--purple); margin-bottom:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${esc(event.name)}
      </h1>
      <div id="event-view"></div>
    </div>`;

  document.getElementById('ev-back').addEventListener('click', () => navigate('#/'));
  document.getElementById('ev-members-btn')?.addEventListener('click', () => openMembersSheet(eventId));

  const $view = document.getElementById('event-view');
  const ctx = { eventId, event, isParticipant, isAdmin };
  return await tab.render($view, ctx) ?? null;
}

// ─── Admin: member management sheet ─────────────────────────────────────────

async function openMembersSheet(eventId) {
  const [{ members }, usersRes] = await Promise.all([
    eventMembers(eventId),
    supabase.from('profiles').select('id, display_name').eq('is_active', true).order('display_name'),
  ]);
  const allUsers = usersRes.data ?? [];
  const memberIds = new Set(members.map(m => m.user_id));
  const toAdd = new Set();

  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <h2>Event members</h2>
      <div id="ms-current"></div>
      <div class="field" style="margin-top:1rem;">
        <label class="label">Add members</label>
        <input type="text" id="ms-filter" placeholder="Filter players…" autocomplete="off" />
        <div id="ms-candidates" style="max-height:180px; overflow-y:auto; margin-top:0.4rem;"></div>
      </div>
      <button class="btn btn-primary btn-block" id="ms-save">Add selected</button>
      <button class="btn btn-ghost btn-block" style="margin-top:8px;" id="ms-close">Close</button>
    </div>`;
  document.body.appendChild(bd);

  const renderCurrent = () => {
    bd.querySelector('#ms-current').innerHTML = members.map(m => `
      <div style="display:flex; align-items:center; justify-content:space-between;
                  background:var(--surface-2); border-radius:8px; padding:0.45rem 0.75rem;
                  margin-bottom:0.3rem; font-size:0.875rem;">
        <span>${esc(m.profiles?.display_name ?? '?')}
          ${m.role !== 'participant' ? `<span style="font-size:0.65rem; color:var(--amber);"> ${m.role}</span>` : ''}
        </span>
        ${m.role === 'creator' ? '' : `<button data-rm="${m.user_id}" style="background:none; color:var(--text-faint); font-size:1rem;">✕</button>`}
      </div>`).join('');

    bd.querySelectorAll('[data-rm]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await removeMember(eventId, btn.dataset.rm);
        if (error) { toast(`Could not remove: ${error}`, 'error'); return; }
        const idx = members.findIndex(m => m.user_id === btn.dataset.rm);
        if (idx >= 0) { memberIds.delete(members[idx].user_id); members.splice(idx, 1); }
        renderCurrent();
        renderCandidates(bd.querySelector('#ms-filter').value.trim());
      });
    });
  };

  const renderCandidates = (filter = '') => {
    const q = filter.toLowerCase();
    const $c = bd.querySelector('#ms-candidates');
    const candidates = allUsers.filter(u =>
      !memberIds.has(u.id) && (q === '' || u.display_name.toLowerCase().includes(q)));
    $c.innerHTML = candidates.length ? candidates.map(u => {
      const sel = toAdd.has(u.id);
      return `
        <div data-add="${u.id}" style="
          display:flex; align-items:center; justify-content:space-between;
          padding:0.45rem 0.75rem; background:${sel ? 'var(--purple-dim)' : 'var(--surface-2)'};
          border:1px solid ${sel ? 'var(--purple)' : 'transparent'};
          border-radius:8px; margin-bottom:0.3rem; font-size:0.875rem; cursor:pointer;">
          <span>${esc(u.display_name)}</span>
          <span style="color:${sel ? 'var(--purple)' : 'var(--text-faint)'};">${sel ? '✓' : '+'}</span>
        </div>`;
    }).join('') : `<div style="padding:0.4rem 0.75rem; color:var(--text-faint); font-size:0.8rem;">Everyone is already a member</div>`;

    $c.querySelectorAll('[data-add]').forEach(row => {
      row.addEventListener('click', () => {
        const uid = row.dataset.add;
        if (toAdd.has(uid)) toAdd.delete(uid); else toAdd.add(uid);
        renderCandidates(filter);
      });
    });
  };

  renderCurrent();
  renderCandidates();
  bd.querySelector('#ms-filter').addEventListener('input', e => renderCandidates(e.target.value.trim()));

  const close = () => { bd.remove(); window.location.reload(); };
  bd.querySelector('#ms-close').addEventListener('click', () => bd.remove());
  bd.addEventListener('click', e => { if (e.target === bd) bd.remove(); });

  bd.querySelector('#ms-save').addEventListener('click', async () => {
    if (!toAdd.size) { bd.remove(); return; }
    const { error } = await addMembers(eventId, [...toAdd]);
    if (error) { toast(`Could not add members: ${error}`, 'error'); return; }
    toast('Members added', 'success');
    close();
  });
}
