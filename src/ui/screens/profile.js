/**
 * src/ui/screens/profile.js
 *
 * Player stats screen + cup-position heatmap.
 *
 * Routes:
 *   /profile                       own profile, OVERALL stats + settings
 *   /profile/:id                   any player, OVERALL stats
 *   /event/:eventId/profile/:id    any player, stats WITHIN that event only
 *
 * The current user can edit their display_name; the own root profile also
 * links to change-password, People (admin) and log out.
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
import { renderHeatmap } from '../components/heatmap.js';
import { formatDuration } from '../../format.js';
import { logout } from '../../auth.js';
import { avatarHtml, uploadAvatar } from '../../photos.js';

export default async function render($el, params) {
  const profileId = params.id ?? currentUser?.id;
  const eventId = params.eventId ?? null;
  if (!profileId) { navigate('#/login'); return; }

  $el.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">Loading profile…</p></div>`;

  const { profile, games, throws, cups, trichters, error } = await loadProfile(profileId, eventId);

  if (error || !profile) {
    $el.innerHTML = `<div class="empty-state"><p style="color:var(--red);">Profile not found.</p></div>`;
    return;
  }

  const isOwnProfile = currentUser?.id === profileId;
  const stats = computeStats(profileId, games, throws);
  const tStats = computeTrichterStats(trichters);

  $el.innerHTML = `
    <div>
      <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:1.5rem;">
        <button id="back-profile" class="btn-secondary" style="width:auto; padding:0.4rem 0.75rem; font-size:0.8rem;">←</button>
        <h1 style="font-size:2rem; color:var(--purple);">PROFILE</h1>
        ${eventId ? '<span style="font-size:0.7rem; color:var(--amber); background:var(--amber-dim); padding:0.25rem 0.6rem; border-radius:999px;">this event only</span>' : ''}
      </div>

      <!-- Avatar + name + edit -->
      <div class="card" style="margin-bottom:1rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.9rem;">
          <div style="display:flex; align-items:center; gap:0.9rem; min-width:0;">
            <div class="profile-avatar-wrap" id="avatar-wrap">
              ${avatarHtml(profile.display_name, profile.avatar_path)}
              ${isOwnProfile ? '<span class="avatar-edit-badge" id="avatar-edit" title="Change picture">📷</span>' : ''}
            </div>
            <div style="min-width:0;">
              <div id="display-name" style="font-family:'Bebas Neue',sans-serif; font-size:1.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${profile.display_name}</div>
              <div style="color:var(--text-faint); font-size:0.75rem;">${profile.email ?? ''}</div>
            </div>
          </div>
          ${isOwnProfile ? '<button id="edit-name-btn" class="btn-secondary" style="width:auto; padding:0.35rem 0.7rem; font-size:0.75rem;">Edit</button>' : ''}
        </div>
        <div id="edit-name-form" style="display:none; margin-top:0.75rem;">
          <input type="text" id="name-input" value="${profile.display_name}" maxlength="30" style="margin-bottom:0.5rem;" />
          <div style="display:flex; gap:0.5rem;">
            <button id="save-name-btn" class="btn-primary" style="flex:1;">Save</button>
            <button id="cancel-name-btn" class="btn-secondary" style="flex:1;">Cancel</button>
          </div>
        </div>
      </div>

      <!-- Stats grid -->
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:0.75rem; margin-bottom:1rem;">
        ${[
          ['Wins', stats.wins, 'var(--green)'],
          ['Losses', stats.losses, 'var(--red)'],
          ['Win %', `${stats.winPct}%`, 'var(--purple)'],
          ['Throws', stats.throws, 'var(--text)'],
          ['Accuracy', `${stats.accuracy}%`, 'var(--blue)'],
          ['Cups', stats.cups, 'var(--amber)'],
        ].map(([label, val, color]) => `
          <div class="card" style="text-align:center; padding:0.75rem;">
            <div style="font-family:'Bebas Neue',sans-serif; font-size:1.75rem; color:${color};">${val}</div>
            <div style="font-size:0.65rem; color:var(--text-faint); text-transform:uppercase;">${label}</div>
          </div>`).join('')}
      </div>

      <!-- Trichter -->
      <div class="card" style="margin-bottom:1rem;">
        <span class="label">Trichter</span>
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:0.75rem; margin-top:0.5rem;">
          <div style="text-align:center;">
            <div style="font-family:'Bebas Neue',sans-serif; font-size:1.75rem; color:var(--amber);">${tStats.count}</div>
            <div style="font-size:0.65rem; color:var(--text-faint); text-transform:uppercase;">Total</div>
          </div>
          <div style="text-align:center;">
            <div style="font-family:'Bebas Neue',sans-serif; font-size:1.75rem; color:var(--green);">${tStats.count ? formatDuration(tStats.best) : '—'}</div>
            <div style="font-size:0.65rem; color:var(--text-faint); text-transform:uppercase;">Best</div>
          </div>
          <div style="text-align:center;">
            <div style="font-family:'Bebas Neue',sans-serif; font-size:1.75rem; color:var(--text);">${tStats.count ? formatDuration(tStats.avg) : '—'}</div>
            <div style="font-size:0.65rem; color:var(--text-faint); text-transform:uppercase;">Average</div>
          </div>
        </div>
      </div>

      <!-- Heatmap -->
      <div class="card" style="margin-bottom:1rem;">
        <span class="label">Cup Heatmap</span>
        <div style="display:flex; gap:1rem; flex-wrap:wrap; justify-content:space-around; margin-top:0.5rem;">
          <div>
            <p style="font-size:0.7rem; color:var(--text-faint); margin-bottom:0.5rem; text-align:center;">6-cup</p>
            <div>${renderHeatmap(throws, cups, 6)}</div>
          </div>
          <div>
            <p style="font-size:0.7rem; color:var(--text-faint); margin-bottom:0.5rem; text-align:center;">10-cup</p>
            <div>${renderHeatmap(throws, cups, 10)}</div>
          </div>
        </div>
      </div>

      ${isOwnProfile && !eventId ? `
      <!-- Account -->
      <div class="card" style="margin-bottom:1rem;">
        <span class="label">Account</span>
        <div style="display:flex; flex-direction:column; gap:0.5rem; margin-top:0.5rem;">
          <button id="pf-change-pwd" class="btn btn-ghost btn-block">🔑 Change password</button>
          ${currentUser?.is_admin ? '<button id="pf-people" class="btn btn-ghost btn-block">👥 Manage people</button>' : ''}
          <button id="pf-logout" class="btn btn-danger-ghost btn-block">Log out</button>
        </div>
      </div>` : ''}
    </div>`;

  document.getElementById('back-profile').addEventListener('click', () => history.back());

  // Change profile picture (own profile)
  document.getElementById('avatar-edit')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const badge = document.getElementById('avatar-edit');
      badge.textContent = '⏳';
      const { path, error } = await uploadAvatar(file);
      if (error) { toast(`Upload failed: ${error}`, 'error'); badge.textContent = '📷'; return; }
      // Swap the picture in place
      const wrap = document.getElementById('avatar-wrap');
      wrap.querySelector('.avatar, .avatar-fallback')?.remove();
      wrap.insertAdjacentHTML('afterbegin', avatarHtml(profile.display_name, path));
      badge.textContent = '📷';
      toast('Profile picture updated', 'success');
    });
    input.click();
  });

  document.getElementById('pf-change-pwd')?.addEventListener('click', () => navigate('#/change-password'));
  document.getElementById('pf-people')?.addEventListener('click', () => navigate('#/people'));
  document.getElementById('pf-logout')?.addEventListener('click', async () => {
    await logout();
    navigate('#/login');
  });

  if (isOwnProfile) {
    const editBtn = document.getElementById('edit-name-btn');
    const editForm = document.getElementById('edit-name-form');
    const saveBtn = document.getElementById('save-name-btn');
    const cancelBtn = document.getElementById('cancel-name-btn');

    editBtn.addEventListener('click', () => { editForm.style.display = 'block'; editBtn.style.display = 'none'; });
    cancelBtn.addEventListener('click', () => { editForm.style.display = 'none'; editBtn.style.display = ''; });

    saveBtn.addEventListener('click', async () => {
      const newName = document.getElementById('name-input').value.trim();
      if (!newName) { toast('Name cannot be empty', 'error'); return; }

      saveBtn.disabled = true;
      const { error } = await supabase.from('profiles').update({ display_name: newName }).eq('id', profileId);

      if (error) { toast('Failed to save', 'error'); saveBtn.disabled = false; return; }

      document.getElementById('display-name').textContent = newName;
      editForm.style.display = 'none';
      editBtn.style.display = '';
      toast('Name updated', 'success');
    });
  }
}

/** Trichter count / best / average from the player's rows. */
function computeTrichterStats(trichters) {
  if (!trichters?.length) return { count: 0, best: null, avg: null };
  const durations = trichters.map(t => t.duration_ms);
  return {
    count: durations.length,
    best: Math.min(...durations),
    avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
  };
}

function computeStats(userId, games, throws) {
  let wins = 0, losses = 0;
  for (const g of games) {
    const participation = g.game_participants?.find(p => p.user_id === userId);
    if (!participation) continue;
    if (g.winner_team === participation.team) wins++;
    else losses++;
  }

  const myThrows = throws.filter(t => t.thrower_user_id === userId);
  const hits = myThrows.filter(t => t.outcome === 'hit').length;
  const total = myThrows.length;

  return {
    wins, losses,
    winPct: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0,
    throws: total,
    hits,
    cups: hits,
    accuracy: total > 0 ? Math.round((hits / total) * 100) : 0,
  };
}

async function loadProfile(userId, eventId = null) {
  let gamesQuery = supabase.from('games')
    .select('id, winner_team, cup_count, game_participants(team, user_id)')
    .eq('status', 'complete');
  if (eventId) gamesQuery = gamesQuery.eq('event_id', eventId);

  let trichterQuery = supabase.from('trichters').select('duration_ms').eq('person_user_id', userId);
  if (eventId) trichterQuery = trichterQuery.eq('event_id', eventId);

  const [profileRes, gamesRes, trichterRes] = await Promise.all([
    supabase.from('profiles').select('id, email, display_name, avatar_path').eq('id', userId).single(),
    gamesQuery,
    trichterQuery,
  ]);

  // Filter games this user participated in
  const userGames = (gamesRes.data ?? []).filter(g =>
    g.game_participants?.some(p => p.user_id === userId)
  );
  const gameIds = userGames.map(g => g.id);

  let throws = [], cups = [];
  if (gameIds.length > 0) {
    const [throwsRes, cupsRes] = await Promise.all([
      // throw_cups is the join table linking throws → cups; 'cup_id' is NOT on throws directly.
      supabase.from('throws').select('game_id, thrower_user_id, outcome, throw_cups(cup_id)').in('game_id', gameIds),
      supabase.from('cups').select('id, game_id, rack_position').in('game_id', gameIds),
    ]);
    throws = throwsRes.data ?? [];
    cups = cupsRes.data ?? [];
  }

  return {
    profile: profileRes.data,
    games: userGames,
    throws,
    cups,
    trichters: trichterRes.data ?? [],
    error: profileRes.error?.message,
  };
}
