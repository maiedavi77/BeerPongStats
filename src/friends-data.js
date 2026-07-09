/**
 * src/friends-data.js
 *
 * Friends system (v4, GDPR layer).
 * - Friendships live in one canonical row per pair (user_a < user_b) and
 *   are created ONLY through friend links/QRs (add_friend_by_username RPC —
 *   sharing your link is the consent).
 * - The profiles directory is closed: users see only themselves, friends,
 *   members of shared events and (as admin) everyone. Event invites for
 *   strangers therefore go through find_user_by_email (exact match).
 */

import { supabase, currentUser } from './supabase.js';

export const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

/** The current user's friends with profile info, sorted by name. */
export async function myFriends() {
  if (!currentUser) return { friends: [] };
  const { data, error } = await supabase
    .from('friendships')
    .select(`
      id, user_a, user_b,
      a:profiles!friendships_user_a_fkey (id, display_name, username, avatar_path, is_active),
      b:profiles!friendships_user_b_fkey (id, display_name, username, avatar_path, is_active)
    `);
  if (error) return { friends: [], error: error.message };

  const friends = (data ?? [])
    .map(row => {
      const other = row.user_a === currentUser.id ? row.b : row.a;
      return other ? { friendshipId: row.id, ...other } : null;
    })
    .filter(f => f && f.is_active)
    .sort((x, y) => x.display_name.localeCompare(y.display_name));
  return { friends };
}

/** Is <userId> a friend of the current user? */
export async function isFriend(userId) {
  if (!currentUser || userId === currentUser.id) return false;
  const [a, b] = [currentUser.id, userId].sort();
  const { data } = await supabase
    .from('friendships')
    .select('id')
    .eq('user_a', a)
    .eq('user_b', b)
    .maybeSingle();
  return !!data;
}

/** Friend links/QR: add by username (RPC; also used by the /friend route). */
export async function addFriendByUsername(username) {
  const { data, error } = await supabase.rpc('add_friend_by_username', {
    p_username: username,
  });
  if (error) return { error: error.message };
  return { friend: Array.isArray(data) ? data[0] : data };
}

export async function removeFriend(friendshipId) {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  return error ? { error: error.message } : {};
}

/** Exact-email lookup for event invites (GDPR: no directory browsing). */
export async function findUserByEmail(email) {
  const { data, error } = await supabase.rpc('find_user_by_email', { p_email: email });
  if (error) return { error: error.message };
  const user = Array.isArray(data) ? data[0] : data;
  return user ? { user } : { user: null };
}

/** Signup: is this username free? (anon-callable RPC) */
export async function usernameAvailable(username) {
  const { data, error } = await supabase.rpc('username_available', { p_username: username });
  return error ? false : !!data;
}

/** Change own username (uniqueness enforced by the DB). */
export async function setMyUsername(username) {
  if (!USERNAME_RE.test(username)) {
    return { error: 'Only letters, numbers, _ and -, 3–20 characters' };
  }
  const { error } = await supabase
    .from('profiles')
    .update({ username })
    .eq('id', currentUser.id);
  if (error) {
    return { error: /profiles_username_unique|duplicate/i.test(error.message)
      ? 'This username is already taken' : error.message };
  }
  currentUser.username = username;
  return {};
}

// ─── Friend link + QR ───────────────────────────────────────────────────────

export function friendLink(username) {
  // Use a real path (no #) so QR scanners and share sheets pass the full
  // URL through. GitHub Pages' 404.html converts it back to the hash route.
  const origin = window.location.origin;
  const repo = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
  return `${origin}${repo}/friend/${encodeURIComponent(username)}`;
}

/** Share the link via the Web Share API (WhatsApp/AirDrop/…), clipboard fallback. */
export async function shareFriendLink(username, displayName) {
  const url = friendLink(username);
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'RACKLY',
        text: `Add ${displayName} on RACKLY 🍺🏓`,
        url,
      });
      return { shared: true };
    } catch (e) {
      if (e.name === 'AbortError') return { shared: false };
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return { copied: true };
  } catch {
    return { url }; // caller shows it
  }
}

/**
 * Render the friend link as a QR code (vendored qrcode-generator, MIT —
 * see vendor/qrcode.js). Returns an <svg> string.
 */
export function friendQrSvg(username) {
  /* global qrcode */
  if (typeof qrcode !== 'function') return null;
  const qr = qrcode(0, 'M');   // type 0 = auto-size
  qr.addData(friendLink(username));
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
}
