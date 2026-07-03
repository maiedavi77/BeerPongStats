/**
 * src/ui/screens/change-password.js
 *
 * Forced password change screen — shown to all admin-invited users on first login.
 * Users cannot navigate away until they set a new password.
 */

import { changePassword } from '../../auth.js';
import { navigate } from '../../router.js';

export default function render($el) {
  $el.innerHTML = `
    <div style="
      display:flex; flex-direction:column;
      justify-content:center; min-height:100%;
      padding: 2rem 0;
    ">
      <div style="text-align:center; margin-bottom:2rem;">
        <h1 style="font-size:3rem; color:var(--purple);">RACKED</h1>
        <h2 style="font-size:1.5rem; color:var(--text); margin-top:0.5rem;">Set your password</h2>
        <p style="color:var(--text-dim); font-size:0.875rem; margin-top:0.5rem;">
          Choose a new password to get started.
        </p>
      </div>

      <div class="card">
        <form id="change-pwd-form" novalidate>
          <div class="field">
            <label class="label" for="new-password">New password</label>
            <input
              type="password"
              id="new-password"
              autocomplete="new-password"
              placeholder="At least 8 characters"
              required
            />
          </div>

          <div class="field" style="margin-bottom:1.25rem;">
            <label class="label" for="confirm-password">Confirm password</label>
            <input
              type="password"
              id="confirm-password"
              autocomplete="new-password"
              placeholder="Repeat your new password"
              required
            />
          </div>

          <div id="pwd-error" class="error-msg" style="display:none; margin-bottom:0.75rem;"></div>

          <button type="submit" class="btn-primary" id="save-btn">
            Set password &amp; continue
          </button>
        </form>
      </div>
    </div>`;

  const form = document.getElementById('change-pwd-form');
  const saveBtn = document.getElementById('save-btn');
  const errorEl = document.getElementById('pwd-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';

    const newPwd = document.getElementById('new-password').value;
    const confirmPwd = document.getElementById('confirm-password').value;

    if (newPwd.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      errorEl.style.display = 'block';
      return;
    }

    if (newPwd !== confirmPwd) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.style.display = 'block';
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    const { error } = await changePassword(newPwd);

    if (error) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Set password & continue';
      errorEl.textContent = error;
      errorEl.style.display = 'block';
      return;
    }

    navigate('#/');
  });
}
