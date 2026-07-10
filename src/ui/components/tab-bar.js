/**
 * src/ui/components/tab-bar.js
 *
 * Global bottom navigation (v4 design) — FOUR tabs, always the same:
 *
 *   Events · New · Board · Me
 *
 * The old per-event bottom tabs (up to 8 of them) moved into the event
 * screen itself as a horizontal chip row (see event.js). The bottom bar
 * stays global so navigation feels the same everywhere; "New" and "Board"
 * are CONTEXT-AWARE — they act on the event you're currently in (or the
 * one you last visited), so starting a game or checking the leaderboard
 * is one tap from anywhere:
 *
 *   New   → new game in the current event (tournament → its bracket,
 *           since tournament games start from matches)
 *   Board → the current event's leaderboard
 *   …no event context yet → both land on the Events list.
 *
 * On desktop (≥1024px) the bar becomes the left sidebar (pure CSS,
 * #app flips to row-reverse — see index.html).
 */

import { currentUser } from '../../supabase.js';

// ─── Icons (from the design system, inline SVG, stroke = currentColor) ───
const I = {
  events: `<svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`,
  plus:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  board:  `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>`,
  me:     `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
};

const style = `
  <style id="tab-bar-style">
    #tab-bar {
      display: flex;
      background: var(--bg);
      border-top: 1px solid rgba(226, 217, 204, 0.08);
      height: 68px;
      padding-top: 8px;
      padding-bottom: env(safe-area-inset-bottom, 0);
      position: sticky;
      bottom: 0;
      z-index: 100;
      align-items: flex-start;
    }
    .tab {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      gap: 3px;
      color: rgba(226, 217, 204, 0.28);
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: color 0.15s;
      -webkit-tap-highlight-color: transparent;
      min-width: 0;
    }
    .tab.active { color: var(--amber); }
    .tab:hover:not(.active) { color: var(--text-dim); }
    .tab-icon { line-height: 1; display: flex; align-items: center; justify-content: center; height: 28px; }
    /* "New" gets the circled + bubble from the design */
    .tab-bubble {
      width: 28px; height: 28px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: rgba(255, 255, 255, 0.03);
      border: 1.5px solid rgba(226, 217, 204, 0.14);
      transition: background 0.15s, border-color 0.15s;
    }
    .tab.active .tab-bubble {
      background: var(--amber-dim);
      border-color: var(--amber);
    }

    /* Desktop (≥1024px): bottom bar becomes a left sidebar
       (#app switches to flex-direction: row-reverse — see index.html) */
    @media (min-width: 1024px) {
      #tab-bar {
        flex-direction: column;
        justify-content: flex-start;
        gap: 4px;
        width: 216px;
        flex: none;
        height: auto;
        border-top: none;
        border-right: 1px solid rgba(226, 217, 204, 0.08);
        padding: 20px 12px calc(20px + env(safe-area-inset-bottom, 0));
        position: static;
        overflow-y: none;
      }
      #tab-bar::before {
        content: 'RACKLY';
        font-family: 'Syne', sans-serif;
        font-weight: 800;
        font-size: 1.45rem;
        letter-spacing: 0.24em;
        color: var(--amber);
        padding: 0 14px 16px;
        display: block;
      }
      .tab {
        flex: none;
        flex-direction: row;
        justify-content: flex-start;
        gap: 11px;
        padding: 11px 14px;
        border-radius: 10px;
        font-size: 0.85rem;
      }
      .tab.active { background: var(--amber-dim); }
      .tab:hover:not(.active) { background: var(--surface-2); }
      .tab-icon { height: auto; }
    }
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

  // Remember the event context so New/Board keep working from /game/*,
  // the events list, the profile, … — the "fluent" part.
  if (ev) {
    try { sessionStorage.setItem('rackly_last_event', ev.eventId); } catch { /* private mode */ }
  } else {
    let last = null;
    try { last = sessionStorage.getItem('rackly_last_event'); } catch { /* private mode */ }
    if (last) ev = { eventId: last, sub: null };
  }

  let tournament = false;
  try { tournament = sessionStorage.getItem('rackly_event_tournament') === '1'; } catch { /* private mode */ }

  // Context-aware targets (fall back to the events list without a context)
  const newHref = ev
    ? (tournament ? `#/event/${ev.eventId}/bracket` : `#/event/${ev.eventId}/game/new`)
    : '#/';
  const boardHref = ev ? `#/event/${ev.eventId}/board` : '#/';

  const onNewGame = currentPath.endsWith('/game/new')
    || (tournament && ev?.sub === 'bracket');
  const onBoard = ev?.sub === 'board';

  const tabs = [
    {
      label: 'Events', href: '#/',
      icon: `<span class="tab-icon">${I.events}</span>`,
      active: !onNewGame && !onBoard
        && !currentPath.startsWith('/profile')
        && currentPath !== '/people' && currentPath !== '/change-password',
    },
    {
      label: 'New', href: newHref,
      icon: `<span class="tab-icon"><span class="tab-bubble">${I.plus}</span></span>`,
      active: onNewGame,
    },
    {
      label: 'Board', href: boardHref,
      icon: `<span class="tab-icon">${I.board}</span>`,
      active: onBoard,
    },
    {
      label: 'Me', href: '#/profile',
      icon: `<span class="tab-icon">${I.me}</span>`,
      active: currentPath.startsWith('/profile')
        || currentPath === '/people' || currentPath === '/change-password',
    },
  ];

  $el.innerHTML = tabs.map(t => `
    <a class="tab${t.active ? ' active' : ''}" href="${t.href}" aria-label="${t.label}">
      ${t.icon}
      <span>${t.label}</span>
    </a>`).join('');
}
