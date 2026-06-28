/**
 * src/ui/toast.js
 * Lightweight toast notification system.
 *
 * Usage:
 *   import { toast } from './toast.js';
 *   toast('Saved!', 'success');
 *   toast('Something went wrong', 'error');
 */

const container = document.getElementById('toast-container');

/**
 * Show a toast message.
 * @param {string} message
 * @param {'success'|'error'|'info'} [type='info']
 * @param {number} [duration=3000] ms before auto-dismiss
 */
export function toast(message, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast${type !== 'info' ? ` toast-${type}` : ''}`;
  el.textContent = message;
  container.appendChild(el);

  // Trigger entrance animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { el.classList.add('show'); });
  });

  setTimeout(() => {
    el.classList.remove('show');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, duration);
}
