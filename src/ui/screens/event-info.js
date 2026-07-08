/**
 * src/ui/screens/event-info.js
 *
 * Event sub-view: event information — name, description, timeframe, status
 * and the member list (with avatars). Visible to everybody in the event.
 *
 * Admins additionally manage members here (add via filterable multi-select,
 * remove) and can archive / unarchive the event. Room is left for an event
 * picture later.
 */

import { supabase, currentUser } from '../../supabase.js';
import { toast } from '../components/toast.js';
import { eventMembers, addMembers, removeMember, setMemberRole, setEventArchived, eventClosedReason, TIER_LABEL } from '../../events-data.js';
import { esc, shortDate } from '../../format.js';
import { myFriends, findUserByEmail, addFriendByUsername } from '../../friends-data.js';
import { avatarHtml } from '../../photos.js';

function fmtDateTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default async function render($el, ctx) {
  const { eventId, event, isAdmin, canManage } = ctx;

  const { members } = await eventMembers(eventId);
  const sorted = [...members].sort((a, b) =>
    (a.profiles?.display_name ?? '').localeCompare(b.profiles?.display_name ?? ''));

  const closed = eventClosedReason(event);
  const statusLine = event.archived_at
    ? `📦 Archived ${shortDate(event.archived_at)}`
    : closed
      ? `⏸ ${closed}`
      : '🟢 Open — games, trichters and photos can be added';

  const timeframe = event.starts_at || event.ends_at
    ? `${fmtDateTime(event.starts_at) ?? 'Anytime'} – ${fmtDateTime(event.ends_at) ?? 'open end'}`
    : 'No timeframe restriction';

  $el.innerHTML = `
    <div>
      <!-- Details -->
      <div class="card" style="margin-bottom:1rem;">
        <span class="label">Event</span>
        <div style="font-family:'Bebas Neue',sans-serif; font-size:1.6rem; margin:0.25rem 0;">${esc(event.name)}</div>
        ${event.description ? `<p style="font-size:0.85rem; color:var(--text-dim); margin-bottom:0.6rem;">${esc(event.description)}</p>` : ''}
        <div style="font-size:0.8rem; color:var(--text-dim); line-height:1.8;">
          <div>📅 ${timeframe}</div>
          <div>⭐ ${TIER_LABEL[event.required_tier] ?? 'Free'} tier event · Trichter ${event.trichter_enabled === false ? 'disabled' : 'enabled'}</div>
          ${event.is_tournament ? `<div>🏆 Tournament (single elimination) · Tracking: ${
            ({ open: 'open', game_players: 'game players only', own_team: 'own team only', hosts: 'hosts only' })[event.tracking_mode] ?? event.tracking_mode}</div>` : ''}
          <div>${statusLine}</div>
          <div style="color:var(--text-faint); font-size:0.72rem;">Created ${shortDate(event.created_at)}</div>
        </div>
      </div>

      <!-- Members -->
      <div class="card" style="margin-bottom:1rem;">
        <span class="label">Members (${sorted.length})</span>
        <div id="info-members" style="margin-top:0.5rem;"></div>
        ${canManage ? `
        <div class="field" style="margin-top:1rem;">
          <label class="label">Add members (your friends)</label>
          <input type="text" id="info-filter" placeholder="Filter friends…" autocomplete="off" />
          <div id="info-candidates" style="max-height:200px; overflow-y:auto; margin-top:0.4rem;"></div>
          <div style="display:flex; gap:0.5rem; margin-top:0.5rem;">
            <input type="email" id="info-email-add" placeholder="or exact@email.address" autocomplete="off" style="flex:1;" />
            <button id="info-email-btn" class="btn btn-ghost" style="width:auto; padding:0.5rem 0.9rem;">Add</button>
          </div>
          <button class="btn btn-primary btn-block" id="info-add" style="margin-top:0.5rem;">Add selected</button>
        </div>` : ''}
      </div>

      ${canManage ? `
      <!-- Manage: archive -->
      <div class="card">
        <span class="label">Management</span>
        <p style="font-size:0.75rem; color:var(--text-faint); margin:0.4rem 0 0.6rem;">
          ${event.archived_at
            ? 'Unarchiving moves the event back to the active list.'
            : 'Archiving moves the event to Past Events; no new games, trichters or photos can be added.'}
        </p>
        <button class="btn ${event.archived_at ? 'btn-ghost' : 'btn-danger-ghost'} btn-block" id="info-archive">
          ${event.archived_at ? '📤 Unarchive event' : '📦 Archive event'}
        </button>
      </div>` : ''}
    </div>`;

  // Which members are already friends of the viewer? (for ➕ buttons)
  const { friends: myFriendsList } = await myFriends();
  const friendIds = new Set(myFriendsList.map(f => f.id));

  // ─── Member list ────────────────────────────────────────────────────────
  const renderMembers = () => {
    const $m = document.getElementById('info-members');
    if (!$m) return;
    $m.innerHTML = sorted.map(m => `
      <div class="picker-row-avatar" style="display:flex; align-items:center; gap:0.6rem;
                  background:var(--surface-2); border-radius:8px; padding:0.45rem 0.75rem;
                  margin-bottom:0.3rem; font-size:0.875rem;">
        ${avatarHtml(m.profiles?.display_name, m.profiles?.avatar_path)}
        <span style="flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${esc(m.profiles?.display_name ?? '?')}
          ${m.role === 'creator' ? '<span style="font-size:0.65rem; color:var(--amber);"> creator</span>' : ''}
          ${m.user_id === currentUser?.id ? ' <span style="font-size:0.65rem; color:var(--text-faint);">(you)</span>' : ''}
        </span>
        ${m.user_id !== currentUser?.id && !friendIds.has(m.user_id) && m.profiles?.username
          ? `<button data-befriend="${esc(m.profiles.username)}" title="Add as friend"
               style="background:none; color:var(--purple); font-size:0.95rem;">➕</button>`
          : ''}
        ${canManage && m.role !== 'creator'
          ? `<select data-role="${m.user_id}" style="background:var(--surface-3); color:var(--text-dim); border:none; border-radius:6px; font-size:0.7rem; padding:0.2rem 0.3rem;">
               ${['participant', 'game_host', 'co_creator'].map(r =>
                 `<option value="${r}" ${m.role === r ? 'selected' : ''}>${r.replace('_', '-')}</option>`).join('')}
             </select>
             <button data-rm="${m.user_id}" style="background:none; color:var(--text-faint); font-size:1rem;">✕</button>`
          : ''}
      </div>`).join('');

    $m.querySelectorAll('[data-befriend]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { friend, error } = await addFriendByUsername(btn.dataset.befriend);
        if (error) { toast(error, 'error'); return; }
        friendIds.add(friend.id);
        toast(`You're now friends with ${friend.display_name} 🎉`, 'success');
        renderMembers();
      });
    });

    $m.querySelectorAll('[data-role]').forEach(sel => {
      sel.addEventListener('change', async () => {
        const { error } = await setMemberRole(eventId, sel.dataset.role, sel.value);
        if (error) { toast(`Could not change role: ${error}`, 'error'); return; }
        const m = sorted.find(x => x.user_id === sel.dataset.role);
        if (m) m.role = sel.value;
        toast('Role updated', 'success');
      });
    });

    $m.querySelectorAll('[data-rm]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await removeMember(eventId, btn.dataset.rm);
        if (error) { toast(`Could not remove: ${error}`, 'error'); return; }
        const idx = sorted.findIndex(m => m.user_id === btn.dataset.rm);
        if (idx >= 0) sorted.splice(idx, 1);
        renderMembers();
        renderCandidates(document.getElementById('info-filter')?.value.trim() ?? '');
        toast('Member removed', 'success');
      });
    });
  };
  renderMembers();

  // ─── Admin: add members ─────────────────────────────────────────────────
  if (!canManage) return;

  // GDPR: candidates are the manager's FRIENDS; strangers via exact email.
  const { friends } = await myFriends();
  const allUsers = friends.map(f => ({ id: f.id, display_name: f.display_name, avatar_path: f.avatar_path }));
  const toAdd = new Set();

  const renderCandidates = (filter = '') => {
    const $c = document.getElementById('info-candidates');
    if (!$c) return;
    const memberIds = new Set(sorted.map(m => m.user_id));
    const q = filter.toLowerCase();
    const candidates = (allUsers ?? []).filter(u =>
      !memberIds.has(u.id) && (q === '' || u.display_name.toLowerCase().includes(q)));

    $c.innerHTML = candidates.length ? candidates.map(u => {
      const sel = toAdd.has(u.id);
      return `
        <div class="picker-row-avatar" data-add="${u.id}" style="
          display:flex; align-items:center; gap:0.6rem;
          padding:0.45rem 0.75rem; background:${sel ? 'var(--purple-dim)' : 'var(--surface-2)'};
          border:1px solid ${sel ? 'var(--purple)' : 'transparent'};
          border-radius:8px; margin-bottom:0.3rem; font-size:0.875rem; cursor:pointer;">
          ${avatarHtml(u.display_name, u.avatar_path)}
          <span style="flex:1;">${esc(u.display_name)}</span>
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
  renderCandidates();

  document.getElementById('info-filter')?.addEventListener('input', e =>
    renderCandidates(e.target.value.trim()));

  document.getElementById('info-email-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('info-email-add').value.trim();
    if (!email) return;
    const { user, error } = await findUserByEmail(email);
    if (error) { toast(error, 'error'); return; }
    if (!user) { toast('No player with this email address', 'error'); return; }
    if (sorted.some(m => m.user_id === user.id)) { toast('Already a member'); return; }
    if (!allUsers.some(u => u.id === user.id)) {
      allUsers.push({ id: user.id, display_name: user.display_name, avatar_path: user.avatar_path });
      allUsers.sort((a, b) => a.display_name.localeCompare(b.display_name));
    }
    toAdd.add(user.id);
    document.getElementById('info-email-add').value = '';
    renderCandidates(document.getElementById('info-filter')?.value.trim() ?? '');
    toast(`${user.display_name} selected — press "Add selected"`, 'success');
  });

  document.getElementById('info-add')?.addEventListener('click', async () => {
    if (!toAdd.size) return;
    const { error } = await addMembers(eventId, [...toAdd]);
    if (error) { toast(`Could not add members: ${error}`, 'error'); return; }
    // Reflect locally without a reload
    for (const uid of toAdd) {
      const u = (allUsers ?? []).find(x => x.id === uid);
      if (u) sorted.push({ user_id: uid, role: 'participant', profiles: u });
    }
    sorted.sort((a, b) => (a.profiles?.display_name ?? '').localeCompare(b.profiles?.display_name ?? ''));
    toAdd.clear();
    renderMembers();
    renderCandidates(document.getElementById('info-filter')?.value.trim() ?? '');
    toast('Members added', 'success');
  });

  // ─── Admin: archive toggle ──────────────────────────────────────────────
  document.getElementById('info-archive')?.addEventListener('click', async () => {
    const archiving = !ctx.event.archived_at;
    const { error } = await setEventArchived(eventId, archiving);
    if (error) { toast(`Could not ${archiving ? 'archive' : 'unarchive'}: ${error}`, 'error'); return; }
    toast(archiving ? 'Event archived 📦' : 'Event unarchived', 'success');
    window.location.hash = archiving ? '#/past' : `#/event/${eventId}/info`;
    if (!archiving) window.location.reload();
  });
}
