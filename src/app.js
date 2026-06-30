/**
 * src/app.js
 *
 * Application entry point. Wires together:
 *   - Supabase auth state
 *   - Hash router
 *   - Screen rendering
 *   - Auth + admin guards
 */

import { onRouteChange, currentRoute, navigate, matchPath } from './router.js';
import { currentUser, onUserChange } from './supabase.js';
import renderLogin from './ui/screens/login.js';

// ─── Screen registry ────────────────────────────────────────────────────────
// Each screen module exports a default render(params) function that writes
// HTML into #screen and attaches event listeners.

const SCREENS = [
  { pattern: '/login',             auth: false, import: () => import('./ui/screens/login.js') },
  { pattern: '/auth/callback',     auth: false, import: () => import('./ui/screens/auth-callback.js') },
  { pattern: '/change-password',   auth: true,  import: () => import('./ui/screens/change-password.js') },
  { pattern: '/',                  auth: true,  import: () => import('./ui/screens/home.js') },
  { pattern: '/game/new',          auth: true,  import: () => import('./ui/screens/new-game.js') },
  { pattern: '/game/:id/rerack',   auth: true,  import: () => import('./ui/screens/re-rack.js') },
  { pattern: '/game/:id/complete', auth: true,  import: () => import('./ui/screens/game-complete.js') },
  { pattern: '/game/:id',          auth: true,  import: () => import('./ui/screens/live-game.js') },
  { pattern: '/board',             auth: true,  import: () => import('./ui/screens/leaderboard.js') },
  { pattern: '/profile/:id',       auth: true,  import: () => import('./ui/screens/profile.js') },
  { pattern: '/trichter',          auth: true,  import: () => import('./ui/screens/trichter.js') },
  { pattern: '/history',           auth: true,  import: () => import('./ui/screens/history.js') },
  { pattern: '/people',            auth: true,  admin: true, import: () => import('./ui/screens/people.js') },
];

const $screen = document.getElementById('screen');

// Listen for auth state changes
supabase.auth.onAuthStateChange((event, session) => {
  console.log('[app] Auth state changed:', event);  // <-- DEBUG
  if (session) {
    navigate('#/');  // Redirect to home
  } else {
    navigate('#/login');
  }
});

// Initial render
const { data: { session } } = await supabase.auth.getSession();
renderLogin(document.getElementById('screen'));

// Track the current teardown fn so screens can clean up Realtime channels etc.
let teardown = null;

async function render(route) {
  // Find matching screen definition
  let matchedScreen = null;
  let pathParams = {};

  for (const screen of SCREENS) {
    const segments = matchPath(screen.pattern, route.path);
    if (segments !== null) {
      matchedScreen = screen;
      pathParams = segments;
      break;
    }
  }

  if (!matchedScreen) {
    // Unknown route → home or login
    navigate(currentUser ? '#/' : '#/login');
    return;
  }

  // Auth guard
  if (matchedScreen.auth && !currentUser) {
    const next = encodeURIComponent(window.location.hash);
    navigate(`#/login?next=${next}`);
    return;
  }

  // Admin guard
  if (matchedScreen.admin && !currentUser?.is_admin) {
    navigate('#/');
    return;
  }

  // Must-change-password guard: lock user to change-password screen
  if (
    currentUser?.must_change_password &&
    route.path !== '/change-password' &&
    route.path !== '/auth/callback'
  ) {
    navigate('#/change-password');
    return;
  }

  // If logged in and trying to view login, redirect to home
  if (route.path === '/login' && currentUser && !currentUser.must_change_password) {
    navigate('#/');
    return;
  }

  // Call previous screen's teardown
  if (typeof teardown === 'function') {
    try { teardown(); } catch (_) {}
    teardown = null;
  }

  // Show loading state in screen while module loads
  $screen.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';

  try {
    const mod = await matchedScreen.import();
    const params = { ...pathParams, ...route.params };
    teardown = await mod.default($screen, params) ?? null;
  } catch (err) {
    console.error('[app] screen render error:', err);
    $screen.innerHTML = `
      <div class="empty-state">
        <h2>Something went wrong</h2>
        <p>${err.message}</p>
      </div>`;
  }

  // Show / hide tab bar based on auth
  updateTabBar();
}

// ─── Tab bar visibility ─────────────────────────────────────────────────────

function updateTabBar() {
  const $tabBar = document.getElementById('tab-bar');
  if (!currentUser || !$tabBar) return;
  // Tab bar module is loaded lazily to avoid circular deps
  import('./ui/components/tab-bar.js').then(m => m.render($tabBar, currentUser));
}

// ─── Boot ───────────────────────────────────────────────────────────────────

// Re-render on route change
onRouteChange(route => render(route));

// Re-render when auth state changes (login / logout)
onUserChange(() => render(currentRoute()));
