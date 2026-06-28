/**
 * src/ui/components/tab-bar.js
 *
 * Bottom navigation tab bar. Renders into the #tab-bar <nav> element.
 * Admin-only "People" tab is hidden for non-admins.
 */

const TABS = [
  { hash: '#/', label: 'Play',     icon: '🎯',  pattern: '/' },
  { hash: '#/board', label: 'Board',   icon: '🏆',  pattern: '/board' },
  { hash: '#/trichter', label: 'Trichter', icon: '⏱️', pattern: '/trichter' },
  { hash: '#/history', label: 'History', icon: '🕒', pattern: '/history' },
  { hash: '#/people', label: 'People',  icon: '👥',  pattern: '/people', adminOnly: true },
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
 * @param {{ is_admin: boolean }} user
 */
export function render($el, user) {
  // Inject styles once
  if (!document.getElementById('tab-bar-style')) {
    document.head.insertAdjacentHTML('beforeend', style);
  }

  const currentPath = (window.location.hash.slice(1) || '/').split('?')[0];

  const tabs = TABS.filter(t => !t.adminOnly || user?.is_admin);
  $el.innerHTML = tabs.map(tab => {
    const active = currentPath === tab.pattern ? ' active' : '';
    return `
      <a class="tab${active}" href="${tab.hash}" aria-label="${tab.label}">
        <span class="tab-icon" aria-hidden="true">${tab.icon}</span>
        <span>${tab.label}</span>
      </a>`;
  }).join('');
}
