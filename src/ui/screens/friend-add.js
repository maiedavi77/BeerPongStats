/**
 * src/ui/screens/friend-add.js
 *
 * Landing screen for friend links / QR codes: #/friend/:username
 * Opening the link while signed in adds the friendship immediately
 * (sharing the link is the consent) and shows a confirmation.
 * Signed-out users are routed to login first by the router and land
 * back here afterwards.
 */

import { currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { addFriendByUsername } from '../../friends-data.js';
import { esc } from '../../format.js';
import { avatarHtml } from '../../photos.js';

export default async function render($el, params) {
  const username = decodeURIComponent(params.username ?? '');

  if (currentUser?.username && username.toLowerCase() === currentUser.username.toLowerCase()) {
    $el.innerHTML = `<div class="empty-state"><h2>That's your own link 😄</h2>
      <p style="color:var(--text-faint);">Share it with others so they can add you.</p>
      <button class="btn btn-ghost" onclick="location.hash='#/profile'">‹ My profile</button></div>`;
    return;
  }

  $el.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">Adding @${esc(username)}…</p></div>`;

  const { friend, error } = await addFriendByUsername(username);
  if (error || !friend) {
    $el.innerHTML = `<div class="empty-state"><h2>Could not add friend</h2>
      <p style="color:var(--text-faint);">${esc(error ?? 'Unknown error')}</p>
      <button class="btn btn-ghost" onclick="location.hash='#/'">‹ Home</button></div>`;
    return;
  }

  $el.innerHTML = `
    <div class="empty-state">
      <div class="profile-avatar-wrap" style="margin:0 auto 0.75rem;">
        ${avatarHtml(friend.display_name, friend.avatar_path)}
      </div>
      <h2>You're now friends with ${esc(friend.display_name)} 🎉</h2>
      <p style="color:var(--text-faint); margin:0.3rem 0 1.25rem;">@${esc(friend.username ?? username)}</p>
      <button class="btn btn-primary" id="fa-profile">View profile</button>
      <button class="btn btn-ghost btn-block" style="margin-top:0.5rem;" id="fa-home">Done</button>
    </div>`;

  document.getElementById('fa-profile').addEventListener('click', () =>
    navigate(`#/profile/${friend.id}`));
  document.getElementById('fa-home').addEventListener('click', () => navigate('#/profile'));
}
