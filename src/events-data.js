/**
 * src/events-data.js
 *
 * Data layer for the v3 event model. RLS (see
 * migrations/2026-07-04-v3-events.sql) already restricts events to
 * participants/admins; these helpers add no client-side trust.
 */

import { supabase, currentUser } from './supabase.js';

/** Events the current user can see (participant, or all for admins). */
export async function myEvents() {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, description, created_by, created_at, event_participants(user_id)')
    .order('created_at', { ascending: false });
  return { events: data ?? [], error: error?.message };
}

export async function getEvent(eventId) {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, description, created_by, created_at')
    .eq('id', eventId)
    .single();
  return { event: data, error: error?.message };
}

/** Registered members of an event (with profile names). */
export async function eventMembers(eventId) {
  const { data, error } = await supabase
    .from('event_participants')
    .select('user_id, role, profiles(id, display_name, is_active, avatar_path)')
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
export async function createEvent(name, memberIds) {
  const { data: event, error } = await supabase
    .from('events')
    .insert({ name, created_by: currentUser.id })
    .select('id')
    .single();
  if (error) return { error: error.message };

  const rows = [
    { event_id: event.id, user_id: currentUser.id, role: 'creator', invited_by: currentUser.id },
    ...memberIds
      .filter(id => id !== currentUser.id)
      .map(id => ({ event_id: event.id, user_id: id, role: 'participant', invited_by: currentUser.id })),
  ];
  const { error: pErr } = await supabase.from('event_participants').insert(rows);
  if (pErr) return { error: pErr.message };
  return { eventId: event.id };
}

/** Admin: add members to an existing event. */
export async function addMembers(eventId, memberIds) {
  if (!memberIds.length) return {};
  const rows = memberIds.map(id => ({
    event_id: eventId, user_id: id, role: 'participant', invited_by: currentUser.id,
  }));
  const { error } = await supabase.from('event_participants').insert(rows);
  return error ? { error: error.message } : {};
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
