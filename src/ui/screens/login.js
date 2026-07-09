/**
 * src/ui/screens/login.js
 *
 * Login screen — the only unauthenticated entry point.
 * No sign-up link. Invite-only: admins create accounts via the People screen.
 *
 * Flow:
 *   1. User fills email + password
 *   2. On submit: show Turnstile, wait for user to complete challenge
 *   3. Pass token directly to Supabase Auth (which verifies it server-side)
 *   4. On success: router redirects via onAuthStateChange
 */

import { login } from '../../auth.js';
import { navigate, currentRoute } from '../../router.js';
import { SIGNUP_ENABLED } from '../../config.js';

const TURNSTILE_SITE_KEY = '0x4AAAAAADsPq9_Bj1iuMmGX';

export default function render($el) {
  $el.innerHTML = `
    <div class="screen-narrow" style="
      display:flex; flex-direction:column;
      justify-content:center; min-height:100%;
      padding: 2rem 0;
    ">
      <div style="text-align:center; margin-bottom:2.5rem;">
        <h1 style="font-size:2.6rem; color:var(--amber); letter-spacing:0.22em;">RACKLY</h1>
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

          <!-- Cloudflare Turnstile widget (hidden until user clicks Sign in) -->
          <div id="turnstile-container" style="display: none; margin-bottom:1.25rem; min-height:65px;"></div>

          <!-- Inline error message -->
          <div id="login-error" class="error-msg" style="display:none; margin-bottom:0.75rem;"></div>

          <button type="submit" class="btn-primary" id="login-btn">
            Sign in
          </button>
        </form>
      </div>

      <p style="text-align:center; margin-top:1.5rem;">
        ${SIGNUP_ENABLED
          ? '<a id="signup-btn" class="btn btn-ghost" href="#/signup">Create account</a>'
          : `<button id="signup-btn" class="btn btn-ghost" disabled
              title="Public registration is coming soon"
              style="opacity:0.45; cursor:not-allowed;">Create account (coming soon)</button>`}
      </p>
    </div>`;

  const form = document.getElementById('login-form');
  const loginBtn = document.getElementById('login-btn');
  const errorEl = document.getElementById('login-error');
  let turnstileToken = null;
  let turnstileWidgetId = null;
  let turnstileResolve = null;

  // ─── Turnstile widget ───────────────────────────────────────────────────
  function renderTurnstile() {
    const container = document.getElementById('turnstile-container');
    if (!container) return;

    if (window.turnstile) {
      turnstileWidgetId = window.turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        callback: (token) => {
          turnstileToken = token;
          loginBtn.disabled = false;
          if (turnstileResolve) {
            turnstileResolve(token);
            turnstileResolve = null;
          }
        },
        'expired-callback': () => {
          turnstileToken = null;
          loginBtn.disabled = true;
        },
        'error-callback': () => {
          turnstileToken = null;
          container.innerHTML = `
            <p style="color:var(--text-dim);font-size:0.8rem;">
              Security check unavailable. Disable your ad blocker and reload.
            </p>`;
          if (turnstileResolve) {
            turnstileResolve(null);
            turnstileResolve = null;
          }
        },
      });
    } else {
      // Turnstile script not yet loaded — retry after 500ms
      setTimeout(renderTurnstile, 500);
    }
  }

  // Helper: wait for a Turnstile token (returns existing token or waits for callback)
  function waitForTurnstileToken() {
    return new Promise((resolve) => {
      if (turnstileToken) {
        resolve(turnstileToken);
      } else {
        turnstileResolve = resolve;
      }
    });
  }

  // ─── Error handling ─────────────────────────────────────────────────────
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    // Reset Turnstile so user gets a fresh token
    if (window.turnstile && turnstileWidgetId !== null) {
      window.turnstile.reset(turnstileWidgetId);
      turnstileToken = null;
    }
  }

  function clearError() {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  // ─── Form submission ────────────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      showError('Please enter your email and password.');
      return;
    }

    // Show Turnstile container and render if not already done
    const container = document.getElementById('turnstile-container');
    container.style.display = 'block';
    if (!turnstileWidgetId) {
      renderTurnstile();
    }

    // Wait for the user to complete the Turnstile challenge
    loginBtn.disabled = true;
    loginBtn.textContent = 'Complete security check...';

    const token = await waitForTurnstileToken();
    if (!token) {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign in';
      showError('Security check failed. Please try again.');
      return;
    }

    // Proceed with login (token is passed directly to Supabase Auth)
    // Stash the redirect target BEFORE the async call — onAuthStateChange
    // may re-render the router (and lose the query string) before we return.
    const { params: loginParams } = currentRoute();
    const nextDest = loginParams.next ? decodeURIComponent(loginParams.next) : null;

    loginBtn.textContent = 'Signing in…';
    const { error } = await login(email, password, token);

    if (error) {
      loginBtn.textContent = 'Sign in';
      showError(error);
      loginBtn.disabled = false;
      return;
    }

    // On success: onAuthStateChange fires → app.js re-renders → router
    // picks up ?next= from the hash and redirects. This navigate is a
    // belt-and-suspenders fallback.
    loginBtn.textContent = 'Sign in';
    loginBtn.disabled = false;
    if (nextDest) navigate(nextDest);
  });
}
