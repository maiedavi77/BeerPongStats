/**
 * src/ui/components/tab-bar.js
 *
 * Bottom navigation tab bar (v3): Events | Profile.
 * Event-scoped navigation happens inside the event screen itself.
 */

import { currentUser } from '../../supabase.js';

const TABS = [
  { hash: '#/',        label: 'Events',  icon: '🎉', match: p => p === '/' || p.startsWith('/event') || p.startsWith('/game') },
  { hash: '#/profile', label: 'Profile', icon: '👤', match: p => p.startsWith('/profile') || p === '/people' || p === '/change-password' },
];

const style = `
  <style id="tab-bar-style">
    #tab-bar {
      display: flex;
      background: var(--surface);
      border-top: 1px solid var(--surface-3);
      height: 64px;
      padding-bottom: env(safe-area-inset-bottom, 0);
      position: sticky;
      bottom: 0;
      z-index: 100;
    }
    .tab {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      color: var(--text-faint);
      font-size: 0.65rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: color 0.15s;
      -webkit-tap-highlight-color: transparent;
    }
    .tab.active { color: var(--purple); }
    .tab:hover:not(.active) { color: var(--text-dim); }
    .tab-icon { font-size: 1.25rem; line-height: 1; }
  </style>`;

/**
 * Render the tab bar.
 * @param {HTMLElement} $el - the #tab-bar <nav> element
 */
export function render($el) {
  if (!document.getElementById('tab-bar-style')) {
    document.head.insertAdjacentHTML('beforeend', style);
  }

  const currentPath = (window.location.hash.slice(1) || '/').split('?')[0];

  $el.innerHTML = TABS.map(tab => {
    const active = tab.match(currentPath) ? ' active' : '';
    return `
      <a class="tab${active}" href="${tab.hash}" aria-label="${tab.label}">
        <span class="tab-icon" aria-hidden="true">${tab.icon}</span>
        <span>${tab.label}</span>
      </a>`;
  }).join('');
}
