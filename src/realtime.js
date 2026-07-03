/**
 * src/realtime.js
 *
 * Supabase Realtime helpers.
 * Wraps postgres_changes subscriptions behind a clean API so screens
 * never deal with channel lifecycle directly.
 */

import { supabase } from './supabase.js';

/**
 * Subscribe to all game-related table changes for a single game.
 *
 * @param {string} gameId - UUID of the game to watch
 * @param {{
 *   onCupChange?:   (payload: object) => void,
 *   onThrowChange?: (payload: object) => void,
 *   onGameChange?:  (payload: object) => void,
 * }} callbacks
 * @returns {() => void} unsubscribe function — call on screen teardown
 */
export function subscribeGame(gameId, { onCupChange, onThrowChange, onGameChange } = {}) {
  const channel = supabase
    .channel(`game:${gameId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cups', filter: `game_id=eq.${gameId}` },
      (payload) => onCupChange?.(payload)
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'throws', filter: `game_id=eq.${gameId}` },
      (payload) => onThrowChange?.(payload)
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => onGameChange?.(payload)
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
