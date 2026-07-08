/**
 * src/events-data.js
 *
 * Data layer for the v3 event model. RLS (see
 * migrations/2026-07-04-v3-events.sql) already restricts events to
 * participants/admins; these helpers add no client-side trust.
 */

import { supabase, currentUser } from './supabase.js';

/**
 * Events the current user can see (participant, or all for admins).
 * @param {{archived?: boolean}} opts - archived: true → only archived events,
 *                                      false/omitted → only active events
 */
export async function myEvents({ archived = false } = {}) {
  let q = supabase
    .from('events')
    .select('id, name, description, created_by, created_at, starts_at, ends_at, archived_at, required_tier, event_type, event_participants(user_id)')
    .order('created_at', { ascending: false });
  q = archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  const { data, error } = await q;
  return { events: data ?? [], error: error?.message };
}

export const GRACE_MS = 15 * 60 * 1000; // 15-minute grace after ends_at

export const TIER_RANK = { free: 1, pro: 2, team: 3 };
export const TIER_LABEL = { free: 'Free', pro: 'Pro', team: 'Team' };

/**
 * Does the ORIGINAL creator's current tier still cover the event?
 * (events snapshot the creator's tier at creation as required_tier;
 * a downgrade deactivates the event — v4 Phase 1)
 */
export function eventSubscribed(event) {
  if (event?.event_type === 'one_time') return true; // bought, never deactivates
  const creatorTier = event?.creator?.tier ?? 'free';
  const required = event?.required_tier ?? 'free';
  return (TIER_RANK[creatorTier] ?? 1) >= (TIER_RANK[required] ?? 1);
}

/**
 * Is the event "open" for creating items (games, trichter, photos)?
 * Open = subscription intact AND not archived AND now inside
 * [starts_at, ends_at] (a missing boundary = no restriction).
 * Mirrors public.is_event_open() in the database.
 */
export function eventOpen(event) {
  if (!event) return false;
  if (!eventSubscribed(event)) return false;
  if (event.archived_at) return false;
  const now = Date.now();
  if (event.starts_at && now < new Date(event.starts_at).getTime()) return false;
  if (event.ends_at && now > new Date(event.ends_at).getTime() + GRACE_MS) return false;
  return true;
}

/** True when the event's timeframe (incl. grace) is fully over. */
export function eventExpired(event) {
  return !!(event?.ends_at && Date.now() > new Date(event.ends_at).getTime() + GRACE_MS);
}

/** True while past ends_at but still inside the 15-minute grace window. */
export function eventInGrace(event) {
  if (!event?.ends_at) return false;
  const end = new Date(event.ends_at).getTime();
  const now = Date.now();
  return now > end && now <= end + GRACE_MS;
}

/** Human-readable reason why an event is closed (or null when open). */
export function eventClosedReason(event) {
  if (!event) return 'Event not found';
  if (!eventSubscribed(event)) {
    return `Missing subscription — this event requires the ${TIER_LABEL[event.required_tier] ?? event.required_tier} tier, which its creator no longer has`;
  }
  if (event.archived_at) return 'This event is archived';
  const now = Date.now();
  if (event.starts_at && now < new Date(event.starts_at).getTime()) return 'This event has not started yet';
  if (event.ends_at && now > new Date(event.ends_at).getTime() + GRACE_MS) return 'This event has ended';
  return null;
}

/** The current user's role in the event, or null when not a member. */
export async function myEventRole(eventId) {
  if (!currentUser) return null;
  const { data } = await supabase
    .from('event_participants')
    .select('role')
    .eq('event_id', eventId)
    .eq('user_id', currentUser.id)
    .maybeSingle();
  return data?.role ?? null;
}

/** Creator/co_creator (or app admin): change a member's role. */
export async function setMemberRole(eventId, userId, role) {
  const { error } = await supabase
    .from('event_participants')
    .update({ role })
    .eq('event_id', eventId)
    .eq('user_id', userId);
  return error ? { error: error.message } : {};
}

/** Admin: archive / unarchive an event. */
export async function setEventArchived(eventId, archived) {
  const { error } = await supabase
    .from('events')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', eventId);
  return error ? { error: error.message } : {};
}

export async function getEvent(eventId) {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, description, created_by, created_at, starts_at, ends_at, archived_at, required_tier, trichter_enabled, event_type, is_tournament, tracking_mode, group_cup_count, finals_cup_count, creator:profiles!events_created_by_fkey(tier)')
    .eq('id', eventId)
    .single();
  return { event: data, error: error?.message };
}

/** Registered members of an event (with profile names). */
export async function eventMembers(eventId) {
  const { data, error } = await supabase
    .from('event_participants')
    .select('user_id, role, profiles!event_participants_user_id_fkey(id, display_name, username, is_active, avatar_path)')
    .eq('event_id', eventId);
  return { members: data ?? [], error: error?.message };
}

/** Guests (event_temp_users) of an event. */
export async function eventGuests(eventId) {
  const { data, error } = await supabase
    .from('event_temp_users')
    .select('id, display_name')
    .eq('event_id', eventId)
    .order('display_name');
  return { guests: data ?? [], error: error?.message };
}

/** True when the current user participates in the event. */
export async function amParticipant(eventId) {
  if (!currentUser) return false;
  const { data } = await supabase
    .from('event_participants')
    .select('user_id')
    .eq('event_id', eventId)
    .eq('user_id', currentUser.id)
    .maybeSingle();
  return !!data;
}

/**
 * Admin: create an event with members. The creator is always added with
 * role 'creator'; everyone else as 'participant'.
 */
export async function createEvent(name, memberIds, { startsAt = null, endsAt = null, trichterEnabled = true, isTournament = false, trackingMode = 'open', groupCupCount = 10, finalsCupCount = 10 } = {}) {
  const { data: event, error } = await supabase
    .from('events')
    .insert({
      name,
      created_by: currentUser.id,
      starts_at: startsAt,
      ends_at: endsAt,
      trichter_enabled: isTournament ? false : trichterEnabled, // tournaments force trichter off
      is_tournament: isTournament,
      tracking_mode: trackingMode,
      group_cup_count: groupCupCount,
      finals_cup_count: finalsCupCount,
      // Snapshot: the event forever requires the creator's tier at creation
      // (enforced by RLS too — see migrations/2026-07-07-v4-phase1.sql).
      required_tier: currentUser.tier ?? 'free',
    })
    .select('id')
    .single();
  if (error) return { error: mapTierError(error.message) };

  // Step 1: own creator row FIRST — the RLS management check for the other
  // member rows can only see it once this statement has run.
  const { error: cErr } = await supabase
    .from('event_participants')
    .upsert([{ event_id: event.id, user_id: currentUser.id, role: 'creator', invited_by: currentUser.id }],
      { onConflict: 'event_id,user_id', ignoreDuplicates: true });
  if (cErr) return { error: cErr.message };

  // Step 2: the invited members.
  const rows = memberIds
    .filter(id => id !== currentUser.id)
    .map(id => ({ event_id: event.id, user_id: id, role: 'participant', invited_by: currentUser.id }));
  if (rows.length) {
    const { error: pErr } = await supabase
      .from('event_participants')
      .upsert(rows, { onConflict: 'event_id,user_id', ignoreDuplicates: true });
    if (pErr) return { error: mapTierError(pErr.message) };
  }
  return { eventId: event.id };
}

/** Translate RLS tier-limit denials into human-readable errors. */
function mapTierError(msg) {
  if (/row-level security/i.test(msg ?? '')) {
    return 'Blocked by your tier limits (Free: 1 active event, 10 participants, 10 games per 24 h)';
  }
  return msg;
}

/** Admin: add members to an existing event. */
export async function addMembers(eventId, memberIds) {
  if (!memberIds.length) return {};
  const rows = memberIds.map(id => ({
    event_id: eventId, user_id: id, role: 'participant', invited_by: currentUser.id,
  }));
  // Idempotent: adding someone who is already a member is a no-op instead
  // of a 23505 duplicate-key error.
  const { error } = await supabase
    .from('event_participants')
    .upsert(rows, { onConflict: 'event_id,user_id', ignoreDuplicates: true });
  return error ? { error: mapTierError(error.message) } : {};
}

/** Admin: remove a member. */
export async function removeMember(eventId, userId) {
  const { error } = await supabase
    .from('event_participants')
    .delete()
    .eq('event_id', eventId)
    .eq('user_id', userId);
  return error ? { error: error.message } : {};
}

/** Any participant: create a guest for the event. */
export async function createGuest(eventId, displayName) {
  const { data, error } = await supabase
    .from('event_temp_users')
    .insert({ event_id: eventId, display_name: displayName, created_by: currentUser.id })
    .select('id, display_name')
    .single();
  return error ? { error: error.message } : { guest: data };
}


// ─── One-time events (v4 Phase 2) ────────────────────────────────────────────

/** Number of unused one-time credits of the current user. */
export async function myUnusedCredits() {
  if (!currentUser) return 0;
  const { count } = await supabase
    .from('one_time_credits')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', currentUser.id)
    .is('used_at', null);
  return count ?? 0;
}

/** Admin: grant a one-time credit to a user (Stripe will do this later). */
export async function grantCredit(userId) {
  const { error } = await supabase
    .from('one_time_credits')
    .insert({ user_id: userId, granted_by: currentUser.id });
  return error ? { error: error.message } : {};
}

/** Redeem a credit → create a 24 h one-time event (atomic RPC). */
export async function redeemOneTimeEvent(name, trichterEnabled = true) {
  const { data, error } = await supabase.rpc('redeem_one_time_event', {
    p_name: name, p_trichter_enabled: trichterEnabled,
  });
  return error ? { error: error.message } : { eventId: data };
}

// ─── Stats gating (v4 Phase 2) ───────────────────────────────────────────────

/**
 * Advanced statistics (accuracy, cups, dodges, heatmaps, RACKED score)?
 * Inside an event the EVENT's tier governs everyone's experience;
 * with no event (root profile), the viewer's own tier governs.
 */
export function hasAdvancedStats(event = null) {
  if (event) {
    return event.event_type === 'one_time'
      || (TIER_RANK[event.required_tier] ?? 1) >= TIER_RANK.pro;
  }
  return (TIER_RANK[currentUser?.tier ?? 'free'] ?? 1) >= TIER_RANK.pro;
}

/** May the current viewer export CSVs? (their own tier, pro+) */
export function canExportCsv() {
  return (TIER_RANK[currentUser?.tier ?? 'free'] ?? 1) >= TIER_RANK.pro;
}
