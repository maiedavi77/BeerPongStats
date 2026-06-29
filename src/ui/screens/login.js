/**
 * src/ui/screens/login.js
 *
 * Login screen — the only unauthenticated entry point.
 * No sign-up link. Invite-only: admins create accounts via the People screen.
 *
 * Turnstile strategy: execution='execute' mode.
 *
 * WHY: The default managed mode auto-solves the challenge the moment the widget
 * renders on page load. The token is then stored and waits for form submission.
 * If the user takes more than 5 minutes to type their credentials, or if a
 * previous login attempt already consumed the token, Supabase rejects it with
 * "timeout-or-duplicate". The fix is execution='execute': the widget renders
 * invisibly on load but does NOT run the challenge yet. The challenge only fires
 * when we explicitly call turnstile.execute() — which we do right inside the
 * submit handler, after email/password validation. This means:
 *   1. The token is always brand-new at the moment of login.
 *   2. It is used exactly once, immediately after being issued.
 *   3. No timing issue is possible regardless of how long the user spends on the form.
 *
 * Flow:
 *   1. Page loads → widget mounts invisibly (no challenge yet)
 *   2. User fills email + password → clicks Sign in
 *   3. Submit handler validates fields → calls turnstile.execute()
 *   4. Turnstile runs challenge (usually <300ms, invisible) → fires callback with fresh token
 *   5. Callback immediately calls signInWithPassword({ captchaToken })
 *   6. On success: router navigates away
 *   7. On error: widget is reset, button re-enabled, error shown inline
 */

import { login } from '../../auth.js';
import { navigate, currentRoute } from '../../router.js';

const TURNSTILE_SITE_KEY = '0x4AAAAAADsPq9_Bj1iuMmGX';

export default function render($el) {
  $el.innerHTML = `
    <div style="
      display:flex; flex-direction:column;
      justify-content:center; min-height:100%;
      padding: 2rem 0;
    ">
      <div style="text-align:center; margin-bottom:2.5rem;">
        <h1 style="font-size:4rem; color:var(--purple); letter-spacing:0.05em;">RACKED</h1>
        <p style="color:var(--text-dim); font-size:0.875rem;">Beer pong, tracked.</p>
      </div>

      <div class="card">
        <form id="login-form" novalidate>
          <div class="field">
            <label class="label" for="email">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              autocomplete="email"
              placeholder="you@example.com"
              required
            />
          </div>

          <div class="field" style="margin-bottom:1.25rem;">
            <label class="label" for="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              autocomplete="current-password"
              placeholder="••••••••"
              required
            />
          </div>

          <!--
            Turnstile container — renders invisibly in execute mode.
            No challenge runs here; turnstile.execute() is called on submit.
          -->
          <div id="turnstile-container"></div>

          <!-- Inline error message -->
          <div id="login-error" class="error-msg" style="display:none; margin-bottom:0.75rem;"></div>

          <!-- Button is enabled immediately — Turnstile runs on submit, not on load -->
          <button type="submit" class="btn-primary" id="login-btn">
            Sign in
          </button>
        </form>
      </div>

      <p style="text-align:center; margin-top:1.5rem; color:var(--text-faint); font-size:0.8rem;">
        Don't have an account? Ask your admin to invite you.
      </p>
    </div>`;

  const form = document.getElementById('login-form');
  const loginBtn = document.getElementById('login-btn');
  const errorEl = document.getElementById('login-error');

  // Widget ID returned by turnstile.render() — needed for .execute() and .reset()
  let widgetId = null;

  // Pending login credentials: set by submit handler, consumed by Turnstile callback
  let pendingEmail = null;
  let pendingPassword = null;

  // ─── Mount Turnstile in execute mode ──────────────────────────────────────
  // The widget is invisible. It does not run the challenge on load.
  // We call turnstile.execute(widgetId) explicitly when the user submits.

  function mountWidget() {
    if (!window.turnstile) {
      setTimeout(mountWidget, 200);
      return;
    }

    const container = document.getElementById('turnstile-container');
    if (!container) return;

    widgetId = window.turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      execution: 'execute',   // ← key: do NOT auto-run on page load
      appearance: 'always',   // keeps the container visible for UX feedback during challenge
      theme: 'dark',

      // Challenge passed → token is fresh and has never been used → sign in immediately
      callback: (token) => {
        doLogin(token);
      },

      // Token expired before we consumed it (shouldn't happen with execute mode,
      // but guard against it anyway)
      'expired-callback': () => {
        showError('Security check expired. Please try again.');
        resetWidget();
      },

      // Turnstile challenge itself failed (network error, etc.)
      'error-callback': () => {
        showError('Security check failed. Please reload and try again.');
        setButtonReady();
      },
    });
  }

  mountWidget();

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }

  function clearError() {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  function setButtonBusy() {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';
  }

  function setButtonReady() {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign in';
  }

  function resetWidget() {
    // Reset issues a new challenge token on the next execute() call
    if (window.turnstile && widgetId !== null) {
      window.turnstile.reset(widgetId);
    }
    pendingEmail = null;
    pendingPassword = null;
    setButtonReady();
  }

  // ─── Core login logic (called from Turnstile callback with fresh token) ───

  async function doLogin(captchaToken) {
    // Safety check — credentials should always be set at this point
    if (!pendingEmail || !pendingPassword) {
      showError('Something went wrong. Please try again.');
      resetWidget();
      return;
    }

    const email = pendingEmail;
    const password = pendingPassword;

    // Clear pending credentials immediately — they've been consumed
    pendingEmail = null;
    pendingPassword = null;

    const { error } = await login(email, password, captchaToken);

    if (error) {
      showError(error);
      resetWidget(); // issues a fresh Turnstile token for the next attempt
      return;
    }

    // Success: stay in "Signing in…" state — onAuthStateChange fires and
    // app.js navigates away. Belt-and-suspenders ?next= redirect:
    const { params } = currentRoute();
    if (params.next) {
      navigate(decodeURIComponent(params.next));
    }
  }

  // ─── Submit handler ────────────────────────────────────────────────────────
  // Validates fields, stores credentials, then fires the Turnstile challenge.
  // The actual signInWithPassword call happens in doLogin() above, which is
  // only invoked by the Turnstile callback with a guaranteed fresh token.

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearError();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email) {
      showError('Please enter your email address.');
      return;
    }
    if (!password) {
      showError('Please enter your password.');
      return;
    }

    if (widgetId === null) {
      showError('Security check not ready yet. Please wait a moment and try again.');
      return;
    }

    // Store credentials so the Turnstile callback can use them
    pendingEmail = email;
    pendingPassword = password;

    setButtonBusy();

    // Fire the Turnstile challenge now — callback fires with a fresh token
    // typically within a few hundred milliseconds (invisible challenge)
    window.turnstile.execute(widgetId);
  });
}
