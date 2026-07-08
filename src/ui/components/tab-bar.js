/**
 * src/ui/components/tab-bar.js
 *
 * Context-aware bottom navigation (v3):
 *  - Root context:   Events | Profile
 *  - Event context:  Play | Board | Trichter | Gallery | History
 *
 * The bar switches to the event tabs whenever the route is inside an event
 * (/event/:id…, including new-game and event profiles) and back to the root
 * tabs when the user returns to the events list or their own profile.
 */

import { currentUser } from '../../supabase.js';

const ROOT_TABS = [
  { hash: '#/',        label: 'Events',  icon: '🎉', match: p => p === '/' || p.startsWith('/game') },
  { hash: '#/past',    label: 'Past',    icon: '📦', match: p => p === '/past' },
  { hash: '#/profile', label: 'Profile', icon: '👤', match: p => p.startsWith('/profile') || p === '/people' || p === '/change-password' },
];

// key = the sub-segment after /event/<id>/ ('' is the Play tab)
const EVENT_TABS = [
  { key: '',         label: 'Play',     icon: '🎯' },
  { key: 'trichter', label: 'Trichter', icon: '⏱️' },
  { key: 'teams',    label: 'Teams',    icon: '👥' },
  { key: 'bracket',  label: 'Bracket',  icon: '🏆' },
  { key: 'board',    label: 'Board',    icon: '📊' },
  { key: 'profile',  label: 'Profile',  icon: '👤' },
  { key: 'gallery',  label: 'Gallery',  icon: '🖼️' },
  { key: 'history',  label: 'History',  icon: '🕘' },
];

// Which sub-segments highlight which tab (deep pages inside an event)
const SUB_ALIAS = { game: '' };

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
      font-size: 0.62rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: color 0.15s;
      -webkit-tap-highlight-color: transparent;
      min-width: 0;
    }
    .tab.active { color: var(--purple); }
    .tab:hover:not(.active) { color: var(--text-dim); }
    .tab-icon { font-size: 1.2rem; line-height: 1; }
  </style>`;

/** Parse the current hash into { eventId, sub } when inside an event. */
function eventContext(path) {
  const m = /^\/event\/([^/]+)(?:\/([^/]+))?/.exec(path);
  if (!m) return null;
  return { eventId: m[1], sub: m[2] ?? '' };
}

/**
 * Render the tab bar for the current route.
 * @param {HTMLElement} $el - the #tab-bar <nav> element
 */
export function render($el) {
  if (!document.getElementById('tab-bar-style')) {
    document.head.insertAdjacentHTML('beforeend', style);
  }

  const currentPath = (window.location.hash.slice(1) || '/').split('?')[0];
  let ev = eventContext(currentPath);

  if (ev) {
    // Remember for /game/* routes, which carry no event id in the URL
    try { sessionStorage.setItem('racked_last_event', ev.eventId); } catch { /* private mode */ }
  } else if (currentPath.startsWith('/game/')) {
    // Live game / game recap: stay in the event context the user came from
    let last = null;
    try { last = sessionStorage.getItem('racked_last_event'); } catch { /* private mode */ }
    if (last) ev = { eventId: last, sub: null };
  }

  if (ev) {
    let trichterOn = true;
    let tournament = false;
    try {
      trichterOn = sessionStorage.getItem('racked_event_trichter') !== '0';
      tournament = sessionStorage.getItem('racked_event_tournament') === '1';
    } catch { /* private mode */ }
    // Tournament events: Play · Teams · Bracket · Board · Profile · Gallery · History
    // Standard events:   Play · Trichter · Board · Profile · Gallery · History
    const tabs = EVENT_TABS.filter(t => {
      if (t.key === 'trichter') return trichterOn && !tournament;
      if (t.key === 'teams' || t.key === 'bracket') return tournament;
      return true;
    });
    const activeKey = ev.sub == null ? null : (SUB_ALIAS[ev.sub] ?? ev.sub);
    $el.innerHTML = tabs.map(tab => {
      const href = tab.key === 'profile'
        ? `#/event/${ev.eventId}/profile/${currentUser?.id ?? ''}`
        : `#/event/${ev.eventId}${tab.key ? '/' + tab.key : ''}`;
      const active = tab.key === activeKey ? ' active' : '';
      return `
        <a class="tab${active}" href="${href}" aria-label="${tab.label}">
          <span class="tab-icon" aria-hidden="true">${tab.icon}</span>
          <span>${tab.label}</span>
        </a>`;
    }).join('');
    return;
  }

  $el.innerHTML = ROOT_TABS.map(tab => {
    const active = tab.match(currentPath) ? ' active' : '';
    return `
      <a class="tab${active}" href="${tab.hash}" aria-label="${tab.label}">
        <span class="tab-icon" aria-hidden="true">${tab.icon}</span>
        <span>${tab.label}</span>
      </a>`;
  }).join('');
}
