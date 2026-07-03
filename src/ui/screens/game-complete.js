/**
 * src/ui/screens/game-complete.js
 *
 * Post-game summary screen. Shown immediately after a game ends
 * (navigated to by live-game.js when status becomes 'complete').
 *
 * Displays:
 *   • Winning team + players
 *   • Final throw stats per player (throws, hits, accuracy)
 *   • Quick-start button for a rematch
 *
 * Params: { id: gameId }
 */

import { supabase } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';

export default async function render($el, { id: gameId }) {
  if (!gameId) { navigate('#/'); return; }

  $el.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">Loading results…</p></div>`;

  const { game, participants, throws, error } = await loadGameResult(gameId);

  if (error || !game) {
    toast('Could not load game result', 'error');
    navigate('#/');
    return;
  }

  const winner = game.winner_team;
  const winnerColor = winner === 'A' ? 'var(--red)' : 'var(--blue)';
  const teamColor = team => (team === 'A' ? 'var(--red)' : 'var(--blue)');

  // Build per-player stats
  const playerStats = buildPlayerStats(participants, throws);
  const teamA = playerStats.filter(p => p.team === 'A');
  const teamB = playerStats.filter(p => p.team === 'B');

  $el.innerHTML = `
    <div>
      <!-- Winner banner -->
      <div style="text-align:center; padding:1.5rem 0 1rem;">
        <div style="font-size:0.8rem; color:var(--text-faint); letter-spacing:0.1em; text-transform:uppercase; margin-bottom:0.25rem;">
          Winner
        </div>
        <div style="font-family:'Bebas Neue',sans-serif; font-size:4rem; color:${winnerColor}; line-height:1;">
          Team ${winner}
        </div>
        <div style="color:var(--text-dim); font-size:0.9rem; margin-top:0.25rem;">
          ${teamA.filter(p => p.team === winner).concat(teamB.filter(p => p.team === winner))
              .map(p => p.name).join(' & ') || (winner === 'A' ? teamA : teamB).map(p => p.name).join(' & ')}
        </div>
      </div>

      <!-- Stats grid -->
      <div class="card" style="margin-bottom:0.75rem;">
        <span class="label">Final Stats</span>
        <table style="width:100%; border-collapse:collapse; font-size:0.85rem; margin-top:0.5rem;">
          <thead>
            <tr style="color:var(--text-faint); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.06em;">
              <th style="text-align:left; padding:0.3rem 0;">Player</th>
              <th style="text-align:center; padding:0.3rem 0;">Team</th>
              <th style="text-align:center; padding:0.3rem 0;">Throws</th>
              <th style="text-align:center; padding:0.3rem 0;">Hits</th>
              <th style="text-align:center; padding:0.3rem 0;">Acc%</th>
            </tr>
          </thead>
          <tbody>
            ${[...teamA, ...teamB].map(p => `
              <tr style="border-top:1px solid var(--surface-3);">
                <td style="padding:0.4rem 0; color:${p.team === winner ? winnerColor : 'var(--text)'};">
                  ${p.name}
                  ${p.team === winner ? ' 🏆' : ''}
                </td>
                <td style="text-align:center; color:${teamColor(p.team)}; font-size:0.75rem;">
                  ${p.team}
                </td>
                <td style="text-align:center; color:var(--text-dim);">${p.throws}</td>
                <td style="text-align:center; color:var(--green);">${p.hits}</td>
                <td style="text-align:center; color:var(--text-dim);">${p.accuracy}%</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <!-- Throw count summary -->
      <div style="display:flex; gap:0.75rem; margin-bottom:1rem;">
        <div class="card" style="flex:1; text-align:center; padding:0.75rem;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:2rem; color:var(--text);">${throws.length}</div>
          <div style="font-size:0.65rem; color:var(--text-faint); text-transform:uppercase;">Total throws</div>
        </div>
        <div class="card" style="flex:1; text-align:center; padding:0.75rem;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:2rem; color:var(--green);">
            ${throws.filter(t => t.outcome === 'hit' || t.outcome === 'dodge').length}
          </div>
          <div style="font-size:0.65rem; color:var(--text-faint); text-transform:uppercase;">Cups hit</div>
        </div>
        <div class="card" style="flex:1; text-align:center; padding:0.75rem;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:2rem; color:var(--amber);">
            ${throws.filter(t => t.outcome === 'dodge').length}
          </div>
          <div style="font-size:0.65rem; color:var(--text-faint); text-transform:uppercase;">Dodges</div>
        </div>
      </div>

      <!-- Actions -->
      <div style="display:flex; flex-direction:column; gap:0.5rem;">
        <button id="btn-home" class="btn-primary">Back to games</button>
        <button id="btn-board" class="btn-secondary">View leaderboard</button>
      </div>
    </div>`;

  document.getElementById('btn-home').addEventListener('click', () => navigate('#/'));
  document.getElementById('btn-board').addEventListener('click', () => navigate('#/board'));
}

// ─── Data loading ──────────────────────────────────────────────────────────

async function loadGameResult(gameId) {
  const [gameRes, participantsRes, throwsRes] = await Promise.all([
    supabase.from('games').select('id, cup_count, winner_team, started_at, ended_at').eq('id', gameId).single(),
    supabase.from('game_participants').select('team, user_id, profiles(display_name)').eq('game_id', gameId),
    supabase.from('throws').select('thrower_user_id, throwing_team, outcome').eq('game_id', gameId),
  ]);

  const error = gameRes.error?.message ?? participantsRes.error?.message ?? throwsRes.error?.message;
  return {
    game: gameRes.data,
    participants: participantsRes.data ?? [],
    throws: throwsRes.data ?? [],
    error,
  };
}

// ─── Stats computation ─────────────────────────────────────────────────────

function buildPlayerStats(participants, throws) {
  return participants.map(p => {
    const myThrows = throws.filter(t => t.thrower_user_id === p.user_id);
    const hits = myThrows.filter(t => t.outcome === 'hit' || t.outcome === 'dodge').length;
    return {
      name: p.profiles?.display_name ?? 'Unknown',
      team: p.team,
      throws: myThrows.length,
      hits,
      accuracy: myThrows.length > 0 ? Math.round((hits / myThrows.length) * 100) : 0,
    };
  });
}
