/**
 * src/router.js
 *
 * Hash-based SPA router for GitHub Pages compatibility.
 * GitHub Pages cannot rewrite paths to index.html, so all navigation
 * uses the URL fragment (e.g. /#/game/abc-123).
 *
 * Usage:
 *   import { navigate, onRouteChange } from './router.js';
 *   navigate('#/game/new');
 *   onRouteChange(({ path, params }) => { ... });
 */

/** @type {Array<(route: Route) => void>} */
const listeners = [];

/**
 * @typedef {{ path: string, params: Record<string, string> }} Route
 */

/**
 * Parse the current window.location.hash into a path and params.
 * Hash format: #/path/segment?key=value
 * @returns {Route}
 */
export function currentRoute() {
  const raw = window.location.hash.slice(1) || '/';
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart || '/';
  const params = {};
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((v, k) => { params[k] = v; });
  }
  return { path, params };
}

/**
 * Navigate to a hash path.
 * @param {string} hash - e.g. '#/game/new' or '#/login?next=%23%2Fgame%2Fabc'
 */
export function navigate(hash) {
  window.location.hash = hash.startsWith('#') ? hash.slice(1) : hash;
}

/**
 * Register a callback fired on every route change (including initial load).
 * @param {(route: Route) => void} fn
 */
export function onRouteChange(fn) {
  listeners.push(fn);
}

/**
 * Extract a named segment from a path template.
 * matchPath('/game/:id', '/game/abc-123') → { id: 'abc-123' }
 * @param {string} template - e.g. '/game/:id'
 * @param {string} path     - e.g. '/game/abc-123'
 * @returns {Record<string, string> | null} null if no match
 */
export function matchPath(template, path) {
  const tParts = template.split('/');
  const pParts = path.split('/');
  if (tParts.length !== pParts.length) return null;

  const segments = {};
  for (let i = 0; i < tParts.length; i++) {
    if (tParts[i].startsWith(':')) {
      segments[tParts[i].slice(1)] = decodeURIComponent(pParts[i]);
    } else if (tParts[i] !== pParts[i]) {
      return null;
    }
  }
  return segments;
}

function dispatch() {
  const route = currentRoute();
  for (const fn of listeners) {
    try { fn(route); } catch (err) { console.error('[router] listener error:', err); }
  }
}

// Fire on hash change
window.addEventListener('hashchange', dispatch);

// Fire on initial load (DOMContentLoaded may already have fired)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', dispatch);
} else {
  // Already loaded — fire on next microtask so listeners registered
  // synchronously after import() have time to attach.
  Promise.resolve().then(dispatch);
}
