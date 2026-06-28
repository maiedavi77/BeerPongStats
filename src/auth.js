/**
 * src/auth.js
 *
 * Auth helpers: login, logout, password change, Turnstile verification.
 * All Supabase auth calls live here so screens stay thin.
 */

import { supabase } from './supabase.js';
import { navigate } from './router.js';

// Supabase project URL for Edge Function calls
const SUPABASE_FUNCTIONS_URL = 'https://oxrxctztriezuonduteg.supabase.co/functions/v1';

// ─── Turnstile verification ──────────────────────────────────────────────────

/**
 * Verify a Cloudflare Turnstile token via our Edge Function.
 * @param {string} token - token from the Turnstile widget callback
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function verifyTurnstile(token) {
  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/verify-turnstile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? 'Verification failed' };
    return { success: true };
  } catch (err) {
    console.error('[auth] turnstile verify error:', err);
    return { success: false, error: 'Network error — please try again' };
  }
}

// ─── Login ───────────────────────────────────────────────────────────────────

/**
 * Sign in with email + password after Turnstile verification.
 * Returns { error } if login fails; on success, onAuthStateChange in supabase.js
 * will update currentUser and the router will re-render.
 * @param {string} email
 * @param {string} password
 * @param {string} turnstileToken
 * @returns {Promise<{ error?: string }>}
 */
export async function login(email, password, turnstileToken) {
  // Step 1: Verify Turnstile
  const { success, error: tsError } = await verifyTurnstile(turnstileToken);
  if (!success) return { error: tsError ?? 'Security check failed — please try again' };

  // Step 2: Sign in
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Return a user-friendly message — don't expose internal Supabase error codes
    if (error.message.includes('Invalid login credentials')) {
      return { error: 'Incorrect email or password' };
    }
    if (error.message.includes('Email not confirmed')) {
      return { error: 'Please check your email and click the confirmation link first' };
    }
    return { error: error.message };
  }

  return {};
}

// ─── Logout ──────────────────────────────────────────────────────────────────

/**
 * Sign out the current user and redirect to login.
 */
export async function logout() {
  await supabase.auth.signOut();
  navigate('#/login');
}

// ─── Password change ─────────────────────────────────────────────────────────

/**
 * Change the current user's password and clear the must_change_password flag.
 * @param {string} newPassword
 * @returns {Promise<{ error?: string }>}
 */
export async function changePassword(newPassword) {
  if (!newPassword || newPassword.length < 8) {
    return { error: 'Password must be at least 8 characters' };
  }

  // Step 1: Update auth password
  const { error: authError } = await supabase.auth.updateUser({ password: newPassword });
  if (authError) return { error: authError.message };

  // Step 2: Clear the must_change_password flag on their profile
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', user.id);
  }

  return {};
}

// ─── Auth callback (email link handler) ──────────────────────────────────────

/**
 * Handle the Supabase auth callback after an email invite or password reset.
 * Supabase puts the tokens in the URL hash when redirecting to /#/auth/callback.
 * We need to exchange the code for a session.
 * @returns {Promise<{ error?: string }>}
 */
export async function handleAuthCallback() {
  // Supabase JS v2 automatically processes the hash tokens on createClient,
  // but we need to detect the PKCE code flow (used for invite emails).
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');

  if (accessToken && refreshToken) {
    // Direct token flow (magic link)
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) return { error: error.message };
    return {};
  }

  // PKCE flow — check for ?code= in the full URL (Supabase appends it before the hash)
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return { error: error.message };
    return {};
  }

  // If neither, the session may already be set (page reload after callback)
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return {};

  return { error: 'No auth token found in URL. Please use the link from your email.' };
}
