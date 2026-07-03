/**
 * src/ui/screens/people.js
 *
 * Admin-only user management screen.
 * Lists all profiles, lets admin invite new users and toggle active status.
 * Self-deactivation is blocked (button disabled for own account).
 */

import { supabase, currentUser } from '../../supabase.js';
import { toast } from '../components/toast.js';

const FUNCTIONS_URL = 'https://oxrxctztriezuonduteg.supabase.co/functions/v1';

export default async function render($el) {
  $el.innerHTML = `
    <div>
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1.5rem;">
        <h1 style="font-size:2.5rem; color:var(--purple);">PEOPLE</h1>
        <button id="invite-btn" class="btn-primary" style="width:auto; padding:0.5rem 1rem;">
          + Invite
        </button>
      </div>

      <!-- Invite modal (hidden by default) -->
      <div id="invite-modal" style="display:none;">
        <div class="card" style="margin-bottom:1rem; border:1px solid var(--purple);">
          <h2 style="font-size:1.25rem; margin-bottom:1rem; color:var(--purple);">Invite User</h2>
          <div class="field">
            <label class="label" for="invite-email">Email address</label>
            <input type="email" id="invite-email" placeholder="player@example.com" autocomplete="off" />
          </div>
          <div class="field" style="margin-bottom:1rem;">
            <label class="label" for="invite-name">Display name</label>
            <input type="text" id="invite-name" placeholder="e.g. Alice" maxlength="30" />
          </div>
          <div id="invite-error" class="error-msg" style="display:none; margin-bottom:0.75rem;"></div>
          <div style="display:flex; gap:0.5rem;">
            <button id="invite-submit" class="btn-primary" style="flex:1;">Send Invite</button>
            <button id="invite-cancel" class="btn-secondary" style="flex:1;">Cancel</button>
          </div>
        </div>
      </div>

      <!-- User list -->
      <div id="user-list">
        <div class="empty-state"><p style="color:var(--text-faint);">Loading users…</p></div>
      </div>
    </div>`;

  // ── Invite modal toggle ──────────────────────────────────────────────────
  const modal = document.getElementById('invite-modal');
  document.getElementById('invite-btn').addEventListener('click', () => {
    modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
    document.getElementById('invite-error').style.display = 'none';
  });
  document.getElementById('invite-cancel').addEventListener('click', () => {
    modal.style.display = 'none';
    document.getElementById('invite-email').value = '';
    document.getElementById('invite-name').value = '';
  });

  // ── Invite submit ────────────────────────────────────────────────────────
  document.getElementById('invite-submit').addEventListener('click', async () => {
    const email = document.getElementById('invite-email').value.trim();
    const displayName = document.getElementById('invite-name').value.trim();
    const errEl = document.getElementById('invite-error');
    errEl.style.display = 'none';

    if (!email || !email.includes('@')) {
      errEl.textContent = 'Please enter a valid email address.';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('invite-submit');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    const { error } = await callFunction('admin-invite-user', { email, display_name: displayName });

    btn.disabled = false;
    btn.textContent = 'Send Invite';

    if (error) {
      errEl.textContent = error;
      errEl.style.display = 'block';
      return;
    }

    modal.style.display = 'none';
    document.getElementById('invite-email').value = '';
    document.getElementById('invite-name').value = '';
    toast(`Invite sent to ${email}`, 'success');
    await loadUsers(); // refresh list to show new user
  });

  await loadUsers();
}

// ── Data loading ──────────────────────────────────────────────────────────

async function loadUsers() {
  const $list = document.getElementById('user-list');
  if (!$list) return;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, is_admin, is_active, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    toast('Failed to load users', 'error');
    $list.innerHTML = `<div class="empty-state"><p style="color:var(--red);">Could not load users.</p></div>`;
    return;
  }

  if (!data?.length) {
    $list.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">No users found.</p></div>`;
    return;
  }

  $list.innerHTML = data.map(user => renderUserRow(user)).join('');

  // Attach toggle handlers
  $list.querySelectorAll('.toggle-active-btn').forEach(btn => {
    btn.addEventListener('click', () => handleToggle(btn));
  });
}

function renderUserRow(user) {
  const isSelf = user.id === currentUser?.id;
  const isActive = user.is_active;
  const toggleLabel = isActive ? 'Deactivate' : 'Activate';
  const toggleStyle = isActive
    ? 'background:var(--surface-3); color:var(--text-dim);'
    : 'background:var(--green); color:#000;';

  return `
    <div class="card" style="margin-bottom:0.5rem; display:flex; align-items:center; gap:0.75rem;">
      <div style="flex:1; min-width:0;">
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <span style="font-weight:500;">${user.display_name}</span>
          ${user.is_admin ? '<span style="font-size:0.65rem; background:var(--purple); color:#fff; padding:0.1rem 0.4rem; border-radius:4px;">ADMIN</span>' : ''}
          ${isSelf ? '<span style="font-size:0.65rem; background:var(--surface-3); color:var(--text-faint); padding:0.1rem 0.4rem; border-radius:4px;">YOU</span>' : ''}
        </div>
        <div style="font-size:0.72rem; color:var(--text-faint); margin-top:0.15rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${user.email}</div>
      </div>
      <div style="display:flex; align-items:center; gap:0.5rem; flex-shrink:0;">
        <span style="
          font-size:0.7rem; font-weight:500;
          color:${isActive ? 'var(--green)' : 'var(--red)'};
          min-width:50px; text-align:center;
        ">${isActive ? '● Active' : '○ Inactive'}</span>
        <button
          class="toggle-active-btn"
          data-uid="${user.id}"
          data-active="${isActive}"
          ${isSelf ? 'disabled title="Cannot deactivate your own account"' : ''}
          style="width:auto; padding:0.3rem 0.6rem; font-size:0.75rem; border-radius:8px; border:none; cursor:pointer; ${isSelf ? 'opacity:0.4; cursor:not-allowed;' : ''} ${toggleStyle}"
        >${toggleLabel}</button>
      </div>
    </div>`;
}

// ── Toggle handler ────────────────────────────────────────────────────────

async function handleToggle(btn) {
  const uid = btn.dataset.uid;
  const currentlyActive = btn.dataset.active === 'true';
  const newActive = !currentlyActive;

  // Optimistic UI update
  btn.disabled = true;
  btn.textContent = '…';

  const { error } = await callFunction('toggle-user-active', {
    user_id: uid,
    is_active: newActive,
  });

  if (error) {
    toast(error, 'error');
    btn.disabled = false;
    btn.textContent = currentlyActive ? 'Deactivate' : 'Activate';
    return;
  }

  toast(`User ${newActive ? 'activated' : 'deactivated'}`, 'success');
  await loadUsers(); // full refresh to keep UI consistent
}

// ── Edge Function caller ──────────────────────────────────────────────────

/**
 * Call a Supabase Edge Function with the current user's JWT.
 * @param {string} fnName - function name
 * @param {object} body   - JSON body
 * @returns {Promise<{ data?: object, error?: string }>}
 */
async function callFunction(fnName, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { error: 'Not authenticated' };

  try {
    const res = await fetch(`${FUNCTIONS_URL}/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) return { error: data?.error ?? `Request failed (${res.status})` };
    return { data };
  } catch (err) {
    console.error(`[people] ${fnName} error:`, err);
    return { error: 'Network error — please try again' };
  }
}
