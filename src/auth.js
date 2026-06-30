/**
 * src/auth.js
 *
 * Auth helpers: login, logout, password change, Turnstile verification.
 * All Supabase auth calls live here so screens stay thin.
 */

import { supabase } from './supabase.js';
import { navigate } from './router.js';

// ─── Login ───────────────────────────────────────────────────────────────────

/**
 * Sign in with email + password + Turnstile token.
 * Supabase Auth verifies the token server-side.
 */
export async function login(email, password, turnstileToken) {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: {
      captchaToken: turnstileToken,  // <-- Pass token directly to Supabase
    },
  });

  if (error) {
    console.error('[auth] login error:', error);
    if (error.message.includes('Invalid login credentials')) {
      return { error: 'Incorrect email or password' };
    }
    if (error.message.includes('Email not confirmed')) {
      return { error: 'Please check your email and click the confirmation link first' };
    }
    if (error.message.includes('captcha') || error.message.includes('timeout-or-duplicate')) {
      return { error: 'Security verification failed. Please try again.' };
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
