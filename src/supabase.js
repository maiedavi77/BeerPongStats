/**
 * src/supabase.js
 *
 * Supabase client initialisation using the new sb_publishable_... key format.
 * Config is injected at CI build time into src/config.js (gitignored).
 *
 * Exports:
 *   supabase      — the Supabase JS client instance
 *   currentUser   — reactive object { id, email, display_name, is_admin,
 *                   must_change_password } | null
 *   onUserChange  — register a callback fired whenever currentUser changes
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ─── Reactive currentUser ───────────────────────────────────────────────────

/** @type {null | { id: string, email: string, display_name: string, is_admin: boolean, must_change_password: boolean }} */
export let currentUser = null;

/** @type {Array<(user: typeof currentUser) => void>} */
const userListeners = [];

/**
 * Register a callback fired whenever currentUser changes.
 * @param {(user: typeof currentUser) => void} fn
 */
export function onUserChange(fn) {
  userListeners.push(fn);
}

function notifyUserListeners() {
  for (const fn of userListeners) {
    try { fn(currentUser); } catch (err) { console.error('[auth] listener error:', err); }
  }
}

/**
 * Fetch the profile row for the given auth user and populate currentUser.
 * @param {import('@supabase/supabase-js').User} authUser
 */
async function hydrateProfile(authUser) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, is_admin, must_change_password')
    .eq('id', authUser.id)
    .single();

  if (error) {
    console.error('[auth] failed to load profile:', error.message);
    currentUser = null;
  } else {
    currentUser = data;
  }
  notifyUserListeners();
}

// ─── Auth state listener ────────────────────────────────────────────────────

supabase.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    await hydrateProfile(session.user);
  } else {
    currentUser = null;
    notifyUserListeners();
  }
});

// Hydrate immediately if already logged in (e.g. page reload)
(async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) await hydrateProfile(user);
})();
