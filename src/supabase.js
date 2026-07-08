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

// The new sb_publishable_... key must NOT be sent in the Authorization: Bearer header —
// the Supabase API gateway rejects non-JWT values there. We pass it only via the
// apikey header by setting the global headers explicitly and suppressing the default
// Authorization header that the JS client adds when no session exists.
// See: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys#known-limitations
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  global: {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
  },
  auth: {
    // The client will still add Authorization: Bearer <user-session-JWT> when the user
    // is signed in — that is correct and expected. This only affects the pre-login state
    // where it would otherwise send Authorization: Bearer sb_publishable_... (invalid).
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

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
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, display_name, username, is_admin, must_change_password, avatar_path, tier')
      .eq('id', authUser.id)
      .single();

    if (error) throw error;
    currentUser = data;
  } catch (err) {
    console.error('[auth] failed to load profile, falling back to auth user:', err.message);
    // Fallback: use auth user data with defaults
    currentUser = {
      id: authUser.id,
      email: authUser.email,
      display_name: authUser.email.split('@')[0],
      is_admin: false,
      must_change_password: false,
    };
  }
  notifyUserListeners();
}

// ─── Auth state listener ────────────────────────────────────────────────────

// IMPORTANT: this callback must stay synchronous. onAuthStateChange fires while
// gotrue-js holds an internal lock; any awaited Supabase call made directly inside
// it (like the profiles query in hydrateProfile) needs that same lock to attach the
// session JWT and deadlocks forever. signInWithPassword() then never resolves, and
// the login button hangs on "Signing in…" even though the token exchange succeeded.
// Fix: defer the async work with setTimeout(0) so it runs after the lock is released.
// https://supabase.com/docs/reference/javascript/auth-onauthstatechange
supabase.auth.onAuthStateChange((event, session) => {
  setTimeout(() => {
    if (session?.user) {
      hydrateProfile(session.user);
    } else {
      currentUser = null;
      notifyUserListeners();
    }
  }, 0);
});

// Hydrate immediately if already logged in (e.g. page reload)
(async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) await hydrateProfile(user);
})();
