/**
 * src/photos.js
 *
 * Photo storage for games and trichters (v3).
 * Bucket: `event-photos` (private) — paths `game/<id>/…`, `trichter/<id>/…`.
 * One photo per game (after it finishes) and one per trichter, enforced by
 * unique indexes (see migrations/2026-07-04-v3-events.sql); the DB error on
 * a race is surfaced as "already has a photo".
 */

import { supabase, currentUser } from './supabase.js';

const BUCKET = 'event-photos';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const SIGNED_TTL = 60 * 60;         // 1 hour

function extOf(file) {
  const m = /\.(\w{1,5})$/.exec(file.name ?? '');
  return m ? m[1].toLowerCase() : 'jpg';
}

async function uploadToBucket(path, file) {
  if (!file.type?.startsWith('image/')) return { error: 'Only images can be uploaded' };
  if (file.size > MAX_BYTES) return { error: 'Image too large (max 10 MB)' };
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type, upsert: false,
  });
  return error ? { error: error.message } : {};
}

/** Signed URL for a stored photo path (1 h). */
export async function photoUrl(storagePath) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_TTL);
  return error ? null : data.signedUrl;
}

/** Signed URLs for many paths in one round-trip. Returns Map path → url. */
export async function photoUrls(storagePaths) {
  if (!storagePaths.length) return new Map();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(storagePaths, SIGNED_TTL);
  if (error) return new Map();
  return new Map(data.filter(d => d.signedUrl).map(d => [d.path, d.signedUrl]));
}

// ─── Avatars (public bucket — plain URLs, no signing) ───────────────────────

const AVATAR_BUCKET = 'avatars';

/**
 * Public URL for an avatar path, or null. Synchronous — safe to call while
 * rendering lists (thrower chips, boards).
 */
export function avatarUrl(avatarPath) {
  if (!avatarPath) return null;
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(avatarPath).data.publicUrl;
}

/**
 * Small HTML snippet: the avatar image, or an initial-letter circle when the
 * person has no picture. Sizing comes from the surrounding CSS context
 * (.chip, .profile-avatar-wrap, .picker-row-avatar).
 */
export function avatarHtml(name, avatarPath) {
  const url = avatarUrl(avatarPath);
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return url
    ? `<img class="avatar" src="${url}" alt="" loading="lazy" />`
    : `<span class="avatar-fallback">${initial}</span>`;
}

/**
 * Upload the current user's profile picture and store its path on the
 * profile. Timestamped filename so the URL changes (no stale caches).
 */
export async function uploadAvatar(file) {
  if (!currentUser) return { error: 'Not logged in' };
  if (!file.type?.startsWith('image/')) return { error: 'Only images can be uploaded' };
  if (file.size > MAX_BYTES) return { error: 'Image too large (max 10 MB)' };

  const path = `${currentUser.id}/${Date.now()}.${extOf(file)}`;
  const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
    contentType: file.type, upsert: false,
  });
  if (upErr) return { error: upErr.message };

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_path: path })
    .eq('id', currentUser.id);
  if (error) return { error: error.message };

  currentUser.avatar_path = path; // keep the live session object in sync
  return { path };
}

// ─── Game photos ────────────────────────────────────────────────────────────

export async function getGamePhoto(gameId) {
  const { data } = await supabase
    .from('game_photos')
    .select('id, storage_path, uploaded_by, created_at')
    .eq('game_id', gameId)
    .maybeSingle();
  return data ?? null;
}

/** Upload the game's single photo (game must be finished; caller checks). */
export async function uploadGamePhoto(gameId, file) {
  const path = `game/${gameId}/${Date.now()}.${extOf(file)}`;
  const up = await uploadToBucket(path, file);
  if (up.error) return up;

  const { error } = await supabase.from('game_photos').insert({
    game_id: gameId, storage_path: path, uploaded_by: currentUser.id,
  });
  if (error) {
    return { error: error.code === '23505' ? 'This game already has a photo' : error.message };
  }
  return { path };
}

// ─── Trichter photos ────────────────────────────────────────────────────────

export async function getTrichterPhoto(trichterId) {
  const { data } = await supabase
    .from('trichter_photos')
    .select('id, storage_path, uploaded_by, created_at')
    .eq('trichter_id', trichterId)
    .maybeSingle();
  return data ?? null;
}

export async function uploadTrichterPhoto(trichterId, file) {
  const path = `trichter/${trichterId}/${Date.now()}.${extOf(file)}`;
  const up = await uploadToBucket(path, file);
  if (up.error) return up;

  const { error } = await supabase.from('trichter_photos').insert({
    trichter_id: trichterId, storage_path: path, uploaded_by: currentUser.id,
  });
  if (error) {
    return { error: error.code === '23505' ? 'This trichter already has a photo' : error.message };
  }
  return { path };
}

// ─── Event gallery ──────────────────────────────────────────────────────────

/**
 * All photos of an event (game + trichter), newest first, with context.
 * @returns {Promise<{photos: Array<{storage_path, created_at, kind, label}>}>}
 */
export async function eventPhotos(eventId) {
  const [gamesRes, trichterRes] = await Promise.all([
    supabase.from('games').select('id').eq('event_id', eventId),
    supabase.from('trichters').select('id, person_name').eq('event_id', eventId),
  ]);

  const gameIds = (gamesRes.data ?? []).map(g => g.id);
  const trichterIds = (trichterRes.data ?? []).map(t => t.id);
  const trichterNames = new Map((trichterRes.data ?? []).map(t => [t.id, t.person_name]));

  const [gp, tp] = await Promise.all([
    gameIds.length
      ? supabase.from('game_photos')
          .select('game_id, storage_path, created_at')
          .in('game_id', gameIds)
      : Promise.resolve({ data: [] }),
    trichterIds.length
      ? supabase.from('trichter_photos')
          .select('trichter_id, storage_path, created_at')
          .in('trichter_id', trichterIds)
      : Promise.resolve({ data: [] }),
  ]);

  const photos = [
    ...(gp.data ?? []).map(p => ({
      storage_path: p.storage_path, created_at: p.created_at,
      kind: 'game', label: 'Game', gameId: p.game_id,
    })),
    ...(tp.data ?? []).map(p => ({
      storage_path: p.storage_path, created_at: p.created_at,
      kind: 'trichter', label: `Trichter — ${trichterNames.get(p.trichter_id) ?? ''}`,
    })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return { photos };
}
