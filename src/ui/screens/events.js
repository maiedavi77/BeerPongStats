/**
 * src/ui/screens/events.js
 *
 * Root Events tab: lists the events the user participates in (admins see
 * all). Admins can create events with a name and a multi-select member
 * picker (full list, filterable — same combo pattern as the player picker).
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
import { myEvents, createEvent } from '../../events-data.js';
import { esc, shortDate } from '../../format.js';

export default async function render($el, params) {
  const archived = (params?._path === '/past');

  $el.innerHTML = `
    <div>
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;">
        <h1 style="font-size:2.5rem; color:var(--purple);">${archived ? 'PAST EVENTS' : 'EVENTS'}</h1>
        ${!archived && currentUser?.is_admin
          ? '<button id="new-event-btn" class="btn btn-primary" style="padding:0.5rem 1rem;">+ New event</button>'
          : ''}
      </div>
      <div id="events-list">
        <div class="empty-state"><p style="color:var(--text-faint);">Loading…</p></div>
      </div>
    </div>`;

  document.getElementById('new-event-btn')?.addEventListener('click', openCreateSheet);

  await loadList(archived);
}

async function loadList(archived) {
  const $list = document.getElementById('events-list');
  if (!$list) return;

  const { events, error } = await myEvents({ archived });
  if (error) { toast(`Could not load events: ${error}`, 'error'); return; }

  if (!events.length) {
    $list.innerHTML = `<div class="empty-state">
      <h2>${archived ? 'No past events' : 'No events yet'}</h2>
      <p style="color:var(--text-faint);">${archived
        ? 'Archived events will show up here.'
        : (currentUser?.is_admin
          ? 'Create the first event to get the party started.'
          : 'Ask an admin to invite you to an event.')}</p>
    </div>`;
    return;
  }

  $list.innerHTML = events.map(e => `
    <div class="card" data-eid="${e.id}" style="margin-bottom:0.6rem; cursor:pointer;"
      onmouseenter="this.style.background='var(--surface-2)'"
      onmouseleave="this.style.background='var(--surface)'">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="min-width:0;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:1.4rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${esc(e.name)}
          </div>
          <div style="font-size:0.72rem; color:var(--text-faint);">
            ${e.event_participants?.length ?? 0} member${(e.event_participants?.length ?? 0) === 1 ? '' : 's'}
            · ${e.starts_at ? `${shortDate(e.starts_at)}${e.ends_at ? ' – ' + shortDate(e.ends_at) : ''}` : shortDate(e.created_at)}
          </div>
        </div>
        <span style="color:var(--text-faint); font-size:1.2rem;">›</span>
      </div>
    </div>`).join('');

  $list.querySelectorAll('[data-eid]').forEach(el => {
    el.addEventListener('click', () => navigate(`#/event/${el.dataset.eid}`));
  });
}

// ─── Admin: create event sheet ──────────────────────────────────────────────

async function openCreateSheet() {
  const { data: allUsers, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('is_active', true)
    .order('display_name');
  if (error) { toast('Could not load users', 'error'); return; }

  const selected = new Set([currentUser.id]); // creator is always a member

  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <h2>New event</h2>
      <div class="field">
        <label class="label" for="ev-name">Event name</label>
        <input type="text" id="ev-name" maxlength="60" placeholder="e.g. Summer Bash 2026" />
      </div>
      <div style="display:flex; gap:0.6rem;">
        <div class="field" style="flex:1;">
          <label class="label" for="ev-start">Starts</label>
          <input type="datetime-local" id="ev-start" />
        </div>
        <div class="field" style="flex:1;">
          <label class="label" for="ev-end">Ends</label>
          <input type="datetime-local" id="ev-end" />
        </div>
      </div>
      <p style="font-size:0.68rem; color:var(--text-faint); margin:-0.4rem 0 0.8rem;">
        Games, trichters and photos can only be added within this timeframe.
        Leave empty for no restriction.
      </p>
      <div class="field">
        <label class="label">Members</label>
        <input type="text" id="ev-member-filter" placeholder="Filter players…" autocomplete="off" />
        <div id="ev-member-list" style="max-height:230px; overflow-y:auto; margin-top:0.4rem;"></div>
        <div id="ev-member-count" style="font-size:0.72rem; color:var(--text-faint); margin-top:0.3rem;"></div>
      </div>
      <button class="btn btn-primary btn-block" id="ev-create">Create event</button>
      <button class="btn btn-ghost btn-block" style="margin-top:8px;" id="ev-cancel">Cancel</button>
    </div>`;
  document.body.appendChild(bd);

  const renderMembers = (filter = '') => {
    const q = filter.toLowerCase();
    const $list = bd.querySelector('#ev-member-list');
    $list.innerHTML = allUsers
      .filter(u => q === '' || u.display_name.toLowerCase().includes(q))
      .map(u => {
        const isSelf = u.id === currentUser.id;
        const sel = selected.has(u.id);
        return `
          <div data-uid="${u.id}" style="
            display:flex; align-items:center; justify-content:space-between;
            padding:0.5rem 0.75rem; background:${sel ? 'var(--purple-dim)' : 'var(--surface-2)'};
            border:1px solid ${sel ? 'var(--purple)' : 'transparent'};
            border-radius:8px; margin-bottom:0.3rem; font-size:0.875rem;
            cursor:${isSelf ? 'default' : 'pointer'}; ${isSelf ? 'opacity:0.7;' : ''}">
            <span>${esc(u.display_name)}${isSelf ? ' <span style="font-size:0.65rem; color:var(--text-faint);">(you)</span>' : ''}</span>
            <span style="color:${sel ? 'var(--purple)' : 'var(--text-faint)'};">${sel ? '✓' : '+'}</span>
          </div>`;
      }).join('');

    $list.querySelectorAll('[data-uid]').forEach(row => {
      row.addEventListener('click', () => {
        const uid = row.dataset.uid;
        if (uid === currentUser.id) return; // creator can't be removed
        if (selected.has(uid)) selected.delete(uid);
        else selected.add(uid);
        renderMembers(bd.querySelector('#ev-member-filter').value.trim());
      });
    });

    bd.querySelector('#ev-member-count').textContent =
      `${selected.size} member${selected.size === 1 ? '' : 's'} selected`;
  };
  renderMembers();

  bd.querySelector('#ev-member-filter').addEventListener('input', e =>
    renderMembers(e.target.value.trim()));

  const close = () => bd.remove();
  bd.querySelector('#ev-cancel').addEventListener('click', close);
  bd.addEventListener('click', e => { if (e.target === bd) close(); });

  bd.querySelector('#ev-create').addEventListener('click', async () => {
    const name = bd.querySelector('#ev-name').value.trim();
    if (!name) { toast('Give the event a name', 'error'); return; }

    const startRaw = bd.querySelector('#ev-start').value;
    const endRaw = bd.querySelector('#ev-end').value;
    const startsAt = startRaw ? new Date(startRaw).toISOString() : null;
    const endsAt = endRaw ? new Date(endRaw).toISOString() : null;
    if (startsAt && endsAt && startsAt >= endsAt) {
      toast('The end must be after the start', 'error');
      return;
    }

    const btn = bd.querySelector('#ev-create');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    const { eventId, error } = await createEvent(name, [...selected], { startsAt, endsAt });
    if (error) {
      toast(`Could not create event: ${error}`, 'error');
      btn.disabled = false;
      btn.textContent = 'Create event';
      return;
    }
    close();
    toast('Event created 🎉', 'success');
    navigate(`#/event/${eventId}`);
  });
}
