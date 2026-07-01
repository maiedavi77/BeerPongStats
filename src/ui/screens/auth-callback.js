/**
 * src/ui/screens/auth-callback.js
 *
 * Handles the OAuth / magic-link callback redirect.
 * Supabase redirects the user back to /#/auth/callback after they
 * click the email-confirm link or complete a third-party OAuth flow.
 *
 * auth.handleAuthCallback() extracts the tokens from the URL fragment,
 * persists the session, and resolves. app.js then picks up the
 * onAuthStateChange event and routes to home or change-password.
 */

import { handleAuthCallback } from '../../auth.js';
import { navigate } from '../../router.js';

export default async function render($el) {
  $el.innerHTML = `
    <div class="empty-state" style="padding-top:4rem;">
      <h2 style="font-size:2rem; color:var(--purple);">RACKED</h2>
      <p style="margin-top:0.5rem; color:var(--text-dim);">Verifying your login…</p>
    </div>`;

  try {
    await handleAuthCallback();
    // onAuthStateChange in supabase.js will fire and app.js will re-render.
    // Navigate to home as a fallback (auth listener may not have fired yet).
    navigate('#/');
  } catch (err) {
    console.error('[auth-callback] error:', err);
    $el.innerHTML = `
      <div class="empty-state" style="padding-top:4rem;">
        <h2 style="color:var(--red);">Login failed</h2>
        <p style="margin-top:0.5rem; color:var(--text-dim);">${err.message ?? 'Could not verify your session.'}</p>
        <button class="btn-secondary" style="margin-top:1.5rem; width:auto; padding:0.5rem 1.25rem;"
          onclick="window.location.hash='#/login'">Back to login</button>
      </div>`;
  }
}
