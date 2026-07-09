/**
 * src/ui/screens/signup.js
 *
 * Public self-signup (v4). Fully functional, but the entry button on the
 * login screen is disabled for now — this screen is reachable directly via
 * #/signup for testing. New accounts start on the FREE tier; profiles are
 * auto-created by the on_auth_user_created trigger.
 *
 * NOTE: requires email signups to be enabled in the Supabase dashboard
 * (Authentication → Providers → Email). With confirmations on, the user
 * must click the email link before they can sign in.
 */

import { supabase } from '../../supabase.js';
import { usernameAvailable, USERNAME_RE } from '../../friends-data.js';
import { navigate } from '../../router.js';
import { SIGNUP_ENABLED } from '../../config.js';

export default async function render($el) {
  if (!SIGNUP_ENABLED) {
    $el.innerHTML = `<div class="empty-state screen-narrow"><h2>Invite only</h2>
      <p style="color:var(--text-faint); margin:0.5rem 0 1rem;">Public registration isn't open yet. Ask an event organizer for an invite.</p>
      <a class="btn btn-ghost" href="#/login">‹ Back to login</a></div>`;
    return;
  }
  $el.innerHTML = `
    <div class="screen-narrow" style="max-width:400px; margin:2rem auto; padding:0 1rem;">
      <h1 style="font-family:'Syne',sans-serif;font-weight:800; font-size:3rem; color:var(--purple); text-align:center; margin-bottom:0.25rem;">RACKLY</h1>
      <p style="text-align:center; color:var(--text-faint); font-size:0.85rem; margin-bottom:1.5rem;">Create your account</p>

      <div class="card">
        <form id="signup-form" novalidate>
          <div class="field">
            <label class="label" for="su-username">Username</label>
            <input type="text" id="su-username" maxlength="20" autocomplete="username" placeholder="unique, e.g. rack_master-3000" required
              style="text-transform:none;" />
            <div id="su-username-hint" style="font-size:0.7rem; margin-top:0.3rem; color:var(--text-faint);">
              3–20 characters: letters, numbers, _ and -. Unique across all players; used for friend links.
            </div>
          </div>
          <div class="field">
            <label class="label" for="su-name">Display name</label>
            <input type="text" id="su-name" maxlength="30" autocomplete="nickname" placeholder="How the board should call you" required />
          </div>
          <div class="field">
            <label class="label" for="su-email">Email</label>
            <input type="email" id="su-email" autocomplete="email" placeholder="you@example.com" required />
          </div>
          <div class="field">
            <label class="label" for="su-pw">Password</label>
            <input type="password" id="su-pw" autocomplete="new-password" placeholder="At least 8 characters" required />
          </div>
          <div class="field" style="margin-bottom:1.25rem;">
            <label class="label" for="su-pw2">Repeat password</label>
            <input type="password" id="su-pw2" autocomplete="new-password" placeholder="••••••••" required />
          </div>

          <div id="su-error" class="error-msg" style="display:none; margin-bottom:0.75rem;"></div>
          <div id="su-success" style="display:none; margin-bottom:0.75rem; color:var(--green); font-size:0.85rem;"></div>

          <button type="submit" class="btn-primary" id="su-btn">Create account</button>
        </form>
      </div>

      <p style="text-align:center; margin-top:1.5rem;">
        <a href="#/login" style="color:var(--text-faint); font-size:0.8rem;">Already have an account? Sign in</a>
      </p>
    </div>`;

  const form = document.getElementById('signup-form');
  const btn = document.getElementById('su-btn');
  const errEl = document.getElementById('su-error');
  const okEl = document.getElementById('su-success');

  // Live username availability feedback (debounced)
  const $uname = document.getElementById('su-username');
  const $uhint = document.getElementById('su-username-hint');
  let unameTimer = null;
  $uname.addEventListener('input', () => {
    clearTimeout(unameTimer);
    const v = $uname.value.trim();
    if (!v) { $uhint.textContent = '3–20 characters: letters, numbers, _ and -.'; $uhint.style.color = 'var(--text-faint)'; return; }
    if (!USERNAME_RE.test(v)) {
      $uhint.textContent = 'Only letters, numbers, _ and - (3–20 characters).';
      $uhint.style.color = 'var(--red)';
      return;
    }
    $uhint.textContent = 'Checking…';
    $uhint.style.color = 'var(--text-faint)';
    unameTimer = setTimeout(async () => {
      const free = await usernameAvailable(v);
      $uhint.textContent = free ? `✓ @${v} is available` : `@${v} is already taken`;
      $uhint.style.color = free ? 'var(--green)' : 'var(--red)';
    }, 350);
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errEl.style.display = 'none';
    okEl.style.display = 'none';

    const usernameVal = document.getElementById('su-username').value.trim();
    const name = document.getElementById('su-name').value.trim();
    const email = document.getElementById('su-email').value.trim();
    const pw = document.getElementById('su-pw').value;
    const pw2 = document.getElementById('su-pw2').value;

    const fail = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
    if (!USERNAME_RE.test(usernameVal)) return fail('Username: only letters, numbers, _ and - (3–20 characters).');
    if (!name) return fail('Pick a display name.');
    if (!email) return fail('Enter your email address.');
    if (pw.length < 8) return fail('The password needs at least 8 characters.');
    if (pw !== pw2) return fail('The passwords do not match.');

    btn.disabled = true;
    btn.textContent = 'Creating…';

    if (!(await usernameAvailable(usernameVal))) {
      btn.disabled = false;
      btn.textContent = 'Create account';
      return fail(`@${usernameVal} is already taken.`);
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password: pw,
      options: { data: { display_name: name, username: usernameVal } },
    });

    btn.disabled = false;
    btn.textContent = 'Create account';

    if (error) return fail(error.message);

    if (data.session) {
      // Confirmations disabled → signed in immediately
      window.location.href = '#/';
      window.location.reload();
      return;
    }
    // Confirmations enabled → email sent
    okEl.textContent = '✓ Account created — check your inbox and confirm your email, then sign in.';
    okEl.style.display = 'block';
    form.reset();
  });
}
