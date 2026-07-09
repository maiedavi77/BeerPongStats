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
import { esc } from '../../format.js';
import { logout } from '../../auth.js';
import { avatarHtml, uploadAvatar } from '../../photos.js';
import { TIER_LABEL, hasAdvancedStats, getEvent } from '../../events-data.js';
import {
  myFriends, isFriend, removeFriend, addFriendByUsername,
  setMyUsername, usernameAvailable, USERNAME_RE,
  shareFriendLink, friendQrSvg, friendLink,
} from '../../friends-data.js';

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

  // Advanced stats (accuracy/cups/heatmaps): inside an event the event's
  // tier governs; on the root profile the viewer's own tier does.
  let advanced;
  if (eventId) {
    const { event } = await getEvent(eventId);
    advanced = hasAdvancedStats(event);
  } else {
    advanced = hasAdvancedStats(null);
  }

  // Heatmaps: only this player's own throws, and strictly split by the
  // game's cup count (a 6-cup game must not appear on the 10-cup heatmap
  // and vice versa — positions overlap between the two layouts).
  const heatFor = cupCount => {
    const ids = new Set(games.filter(g => g.cup_count === cupCount).map(g => g.id));
    return {
      throws: throws.filter(t => ids.has(t.game_id) && t.thrower_user_id === profileId),
      cups: cups.filter(c => ids.has(c.game_id)),
    };
  };
  const heat6 = heatFor(6);
  const heat10 = heatFor(10);

  $el.innerHTML = `
    <div class="screen-narrow">
      <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:1.5rem;">
        <button id="back-profile" class="btn-secondary" style="width:auto; padding:0.4rem 0.75rem; font-size:0.8rem;">←</button>
        <h1 style="font-size:2rem; color:var(--purple);">${eventId ? 'EVENT PROFILE' : 'PROFILE'}</h1>
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
              <div id="display-name" style="font-family:'Bebas Neue',sans-serif; font-size:1.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(profile.display_name)}</div>
              <div style="color:var(--text-dim); font-size:0.78rem;">
                ${profile.username ? '@' + esc(profile.username) : (isOwnProfile ? '<span style="color:var(--amber);">no username yet</span>' : '')}
                ${isOwnProfile ? '<button id="uname-edit" title="Change username" style="background:none; padding:0 0.2rem; font-size:0.75rem;">✏️</button>' : ''}
              </div>
              <div style="color:var(--text-faint); font-size:0.75rem;">${isOwnProfile ? esc(currentUser?.email ?? '') : ''}</div>
              ${isOwnProfile && !eventId ? `
              <div style="margin-top:0.3rem;">
                <span style="font-size:0.65rem; font-weight:600; letter-spacing:0.5px; text-transform:uppercase;
                  background:${(currentUser?.tier ?? 'free') === 'free' ? 'var(--surface-3)' : 'var(--purple)'};
                  color:${(currentUser?.tier ?? 'free') === 'free' ? 'var(--text-dim)' : '#fff'};
                  padding:0.15rem 0.5rem; border-radius:4px;">
                  ${TIER_LABEL[currentUser?.tier ?? 'free']} tier
                </span>
              </div>` : ''}
            </div>
          </div>
          ${isOwnProfile ? '<button id="edit-name-btn" class="btn-secondary" style="width:auto; padding:0.35rem 0.7rem; font-size:0.75rem;">Edit</button>' : ''}
        </div>
        <div id="edit-name-form" style="display:none; margin-top:0.75rem;">
          <input type="text" id="name-input" value="${esc(profile.display_name)}" maxlength="30" style="margin-bottom:0.5rem;" />
          <div style="display:flex; gap:0.5rem;">
            <button id="save-name-btn" class="btn-primary" style="flex:1;">Save</button>
            <button id="cancel-name-btn" class="btn-secondary" style="flex:1;">Cancel</button>
          </div>
        </div>
      </div>

      <div id="friend-actions" style="display:flex; gap:0.5rem; margin-bottom:1rem;"></div>

      ${isOwnProfile && !eventId ? `
      <!-- Friends -->
      <div class="card" style="margin-bottom:1rem;">
        <span class="label">Friends</span>
        <div id="friends-list" style="margin-top:0.5rem;">
          <p style="color:var(--text-faint); font-size:0.8rem;">Loading…</p>
        </div>
      </div>` : ''}

      <!-- Stats grid -->
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:0.75rem; margin-bottom:1rem;">
        ${(advanced ? [
          ['Wins', stats.wins, 'var(--green)'],
          ['Losses', stats.losses, 'var(--red)'],
          ['Win %', `${stats.winPct}%`, 'var(--purple)'],
          ['Throws', stats.throws, 'var(--text)'],
          ['Accuracy', `${stats.accuracy}%`, 'var(--blue)'],
          ['Cups', stats.cups, 'var(--amber)'],
        ] : [
          ['Games', stats.wins + stats.losses, 'var(--text)'],
          ['Wins', stats.wins, 'var(--green)'],
          ['Losses', stats.losses, 'var(--red)'],
          ['Win %', `${stats.winPct}%`, 'var(--purple)'],
        ]).map(([label, val, color]) => `
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

      <!-- Heatmap (advanced) -->
      ${advanced ? `
      <div class="card" style="margin-bottom:1rem;">
        <span class="label">Cup Heatmap</span>
        <div style="display:flex; gap:1rem; flex-wrap:wrap; justify-content:space-around; margin-top:0.5rem;">
          <div>
            <p style="font-size:0.7rem; color:var(--text-faint); margin-bottom:0.5rem; text-align:center;">6-cup</p>
            <div>${renderHeatmap(heat6.throws, heat6.cups, 6)}</div>
          </div>
          <div>
            <p style="font-size:0.7rem; color:var(--text-faint); margin-bottom:0.5rem; text-align:center;">10-cup</p>
            <div>${renderHeatmap(heat10.throws, heat10.cups, 10)}</div>
          </div>
        </div>
      </div>` : `
      <div class="card" style="margin-bottom:1rem; text-align:center; color:var(--text-faint); font-size:0.78rem;">
        🔒 Accuracy, throw details and the cup heatmap are Pro features.
      </div>`}

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

  // ─── Friends actions (v4 GDPR layer) ───────────────────────────────────
  const $actions = document.getElementById('friend-actions');
  if ($actions) {
    if (isOwnProfile) {
      if (profile.username) {
        $actions.innerHTML = `
          <button id="qr-btn" class="btn btn-ghost" style="flex:1;">🔳 QR code</button>
          <button id="share-btn" class="btn btn-primary" style="flex:1;">📤 Share friend link</button>`;
        document.getElementById('qr-btn').addEventListener('click', () => {
          const svg = friendQrSvg(profile.username);
          const bd = document.createElement('div');
          bd.className = 'sheet-backdrop';
          bd.style.alignItems = 'center';
          bd.innerHTML = `
            <div style="background:#fff; padding:1.1rem; border-radius:18px; text-align:center; max-width:320px;">
              <div style="width:240px; height:240px; margin:0 auto;">${svg ?? '<p style="color:#000;">QR unavailable</p>'}</div>
              <div style="color:#000; font-weight:600; margin-top:0.5rem;">@${esc(profile.username)}</div>
              <div style="color:#666; font-size:0.7rem; margin-top:0.2rem;">Scan to add ${esc(profile.display_name)} as a friend</div>
            </div>`;
          bd.addEventListener('click', e => { if (e.target === bd) bd.remove(); });
          document.body.appendChild(bd);
        });
        document.getElementById('share-btn').addEventListener('click', async () => {
          const res = await shareFriendLink(profile.username, profile.display_name);
          if (res.copied) toast('Friend link copied to clipboard', 'success');
          else if (res.url) window.prompt('Your friend link:', res.url);
        });
      } else {
        $actions.innerHTML = `<button id="uname-set" class="btn btn-primary btn-block">Set your username to share friend links</button>`;
        document.getElementById('uname-set').addEventListener('click', openUsernameSheet);
      }
    } else if (!eventId || true) {
      const already = await isFriend(profile.id);
      if (!already && profile.username) {
        $actions.innerHTML = `<button id="add-friend-btn" class="btn btn-primary btn-block">➕ Add ${esc(profile.display_name)} as a friend</button>`;
        document.getElementById('add-friend-btn').addEventListener('click', async () => {
          const { error } = await addFriendByUsername(profile.username);
          if (error) { toast(error, 'error'); return; }
          toast(`You're now friends with ${profile.display_name} 🎉`, 'success');
          $actions.innerHTML = `<div style="text-align:center; color:var(--green); font-size:0.85rem;">✓ Friends</div>`;
        });
      } else if (already) {
        $actions.innerHTML = `<div style="text-align:center; color:var(--text-faint); font-size:0.8rem;">✓ You are friends</div>`;
      }
    }
  }

  document.getElementById('uname-edit')?.addEventListener('click', openUsernameSheet);

  // Friends list (own root profile)
  const $friends = document.getElementById('friends-list');
  if ($friends) {
    const { friends } = await myFriends();
    if (!friends.length) {
      $friends.innerHTML = `<p style="color:var(--text-faint); font-size:0.8rem;">
        No friends yet — share your link or QR code above. Friends can add you to their events.</p>`;
    } else {
      $friends.innerHTML = friends.map(f => `
        <div class="picker-row-avatar" style="display:flex; align-items:center; gap:0.6rem;
             background:var(--surface-2); border-radius:8px; padding:0.45rem 0.75rem;
             margin-bottom:0.3rem; font-size:0.875rem;">
          ${avatarHtml(f.display_name, f.avatar_path)}
          <span data-open-friend="${f.id}" style="flex:1; min-width:0; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${esc(f.display_name)} <span style="color:var(--text-faint); font-size:0.7rem;">@${esc(f.username ?? '')}</span>
          </span>
          <button data-unfriend="${f.friendshipId}" title="Remove friend"
            style="background:none; color:var(--text-faint); font-size:0.95rem;">✕</button>
        </div>`).join('');
      $friends.querySelectorAll('[data-open-friend]').forEach(el =>
        el.addEventListener('click', () => navigate(`#/profile/${el.dataset.openFriend}`)));
      $friends.querySelectorAll('[data-unfriend]').forEach(btn =>
        btn.addEventListener('click', async () => {
          if (!window.confirm('Remove this friend?')) return;
          const { error } = await removeFriend(btn.dataset.unfriend);
          if (error) { toast(error, 'error'); return; }
          btn.closest('div').remove();
          toast('Friend removed', 'success');
        }));
    }
  }

  function openUsernameSheet() {
    const bd = document.createElement('div');
    bd.className = 'sheet-backdrop';
    bd.innerHTML = `
      <div class="sheet">
        <div class="sheet-handle"></div>
        <h2>${profile.username ? 'Change username' : 'Set username'}</h2>
        <div class="field">
          <label class="label" for="un-input">Username</label>
          <input type="text" id="un-input" maxlength="20" value="${esc(profile.username ?? '')}" autocomplete="off" />
          <div id="un-hint" style="font-size:0.7rem; margin-top:0.3rem; color:var(--text-faint);">
            3–20 characters: letters, numbers, _ and -. Unique; changing it changes your friend link.
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="un-save">Save</button>
        <button class="btn btn-ghost btn-block" style="margin-top:8px;" id="un-cancel">Cancel</button>
      </div>`;
    document.body.appendChild(bd);
    const close = () => bd.remove();
    bd.querySelector('#un-cancel').addEventListener('click', close);
    bd.addEventListener('click', e => { if (e.target === bd) close(); });

    const $in = bd.querySelector('#un-input');
    const $hint = bd.querySelector('#un-hint');
    let t = null;
    $in.addEventListener('input', () => {
      clearTimeout(t);
      const v = $in.value.trim();
      if (!USERNAME_RE.test(v)) { $hint.textContent = 'Only letters, numbers, _ and - (3–20 chars).'; $hint.style.color = 'var(--red)'; return; }
      if (v.toLowerCase() === (profile.username ?? '').toLowerCase()) { $hint.textContent = 'This is your current username.'; $hint.style.color = 'var(--text-faint)'; return; }
      $hint.textContent = 'Checking…'; $hint.style.color = 'var(--text-faint)';
      t = setTimeout(async () => {
        const free = await usernameAvailable(v);
        $hint.textContent = free ? `✓ @${v} is available` : `@${v} is already taken`;
        $hint.style.color = free ? 'var(--green)' : 'var(--red)';
      }, 350);
    });

    bd.querySelector('#un-save').addEventListener('click', async () => {
      const v = $in.value.trim();
      const { error } = await setMyUsername(v);
      if (error) { toast(error, 'error'); return; }
      toast('Username saved', 'success');
      close();
      window.location.reload();
    });
  }

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
    // Only safe (broadly-granted) columns here. Own profile shows email from
    // currentUser (hydrated via me()) since email is no longer readable via
    // a direct table SELECT.
    supabase.from('profiles').select('id, display_name, username, avatar_path').eq('id', userId).single(),
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
