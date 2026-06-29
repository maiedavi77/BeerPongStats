/**
 * src/ui/screens/login.js
 *
 * Login screen — the only unauthenticated entry point.
 * No sign-up link. Invite-only: admins create accounts via the People screen.
 *
 * Flow:
 *   1. User fills email + password
 *   2. Turnstile widget loads and user completes challenge
 *   3. On submit: verify Turnstile → signInWithPassword
 *   4. On success: router redirects via onAuthStateChange
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

          <!-- Cloudflare Turnstile widget -->
          <div id="turnstile-container" style="margin-bottom:1.25rem; min-height:65px;"></div>

          <!-- Inline error message -->
          <div id="login-error" class="error-msg" style="display:none; margin-bottom:0.75rem;"></div>

          <button type="submit" class="btn-primary" id="login-btn" disabled>
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
  let turnstileToken = null;
  let turnstileWidgetId = null;

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
        },
        'expired-callback': () => {
          turnstileToken = null;
          loginBtn.disabled = true;
        },
        'error-callback': () => {
          turnstileToken = null;
          // Show a helpful note but don't block the UX entirely
          container.innerHTML = `
            <p style="color:var(--text-dim);font-size:0.8rem;">
              Security check unavailable. Disable your ad blocker and reload.
            </p>`;
        },
      });
    } else {
      // Turnstile script not yet loaded — retry after 500ms
      setTimeout(renderTurnstile, 500);
    }
  }

  renderTurnstile();

  // ─── Form submission ────────────────────────────────────────────────────

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    // Reset Turnstile so user gets a fresh token
    if (window.turnstile && turnstileWidgetId !== null) {
      window.turnstile.reset(turnstileWidgetId);
      turnstileToken = null;
      loginBtn.disabled = true;
    }
  }

  function clearError() {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      showError('Please enter your email and password.');
      return;
    }

    if (!turnstileToken) {
      showError('Please complete the security check.');
      return;
    }

    // Consume the token immediately — Turnstile tokens are single-use.
    // Clear before the async call so a slow response can never trigger
    // a second submission with the same already-used token.
    const tokenToUse = turnstileToken;
    turnstileToken = null;
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';

    const { error } = await login(email, password, tokenToUse);

    if (error) {
      // On failure: showError() resets the widget so user gets a fresh token.
      loginBtn.textContent = 'Sign in';
      showError(error);
      return;
    }

    // On success: leave button disabled in "Signing in…" state.
    // onAuthStateChange in supabase.js fires → app.js re-renders → router navigates away.
    // We deliberately never re-enable the button — the page is leaving.

    // Belt-and-suspenders: handle ?next= redirect if auth state is slow
    const { params } = currentRoute();
    if (params.next) {
      navigate(decodeURIComponent(params.next));
    }
  });
}
