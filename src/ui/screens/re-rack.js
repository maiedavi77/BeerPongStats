/**
 * src/ui/screens/re-rack.js
 *
 * Re-rack screen — shown when a team hits a classic re-rack count
 * (6, 5, 4, 3, 2, or 1 cups remaining depending on game mode).
 *
 * The defending team can rearrange their remaining standing cups
 * into any of the standard rack shapes. This screen persists the
 * new rack_position values to Supabase and logs the re_racks row,
 * then returns to the live game.
 *
 * Params:  { id: gameId, team: 'A' | 'B' }  (team from query string)
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
import { renderRack } from '../components/cup-rack.js';

// Standard rack shapes by cup count (rack_position indices for standing cups)
const RACK_SHAPES = {
  6:  { Diamond: [0, 1, 2, 3, 4, 5], Triangle: [0, 1, 2, 3, 4, 5] },
  5:  { 'V-shape': [0, 1, 2, 3, 4], Line: [0, 1, 2, 3, 4] },
  4:  { Diamond: [0, 1, 2, 3], Line: [0, 1, 2, 3] },
  3:  { Triangle: [0, 1, 2], Line: [0, 1, 2] },
  2:  { Side: [0, 1] },
  1:  { Center: [0] },
};

export default async function render($el, { id: gameId, team }) {
  if (!gameId || !team) { navigate('#/'); return; }

  $el.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">Loading…</p></div>`;

  // Load current standing cups for the re-racking team
  const { data: cups, error } = await supabase
    .from('cups')
    .select('id, rack_position, status, team')
    .eq('game_id', gameId)
    .eq('team', team)
    .eq('status', 'standing')
    .order('rack_position');

  if (error || !cups) {
    toast('Could not load cups', 'error');
    navigate(`#/game/${gameId}`);
    return;
  }

  const cupCount = cups.length;
  const shapes = RACK_SHAPES[cupCount] ?? {};
  const shapeNames = Object.keys(shapes);

  $el.innerHTML = `
    <div>
      <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:1.5rem;">
        <h1 style="font-size:2.5rem; color:var(--amber);">RE-RACK</h1>
        <span style="font-size:0.8rem; color:var(--text-faint); align-self:flex-end; padding-bottom:0.4rem;">
          Team ${team} · ${cupCount} cup${cupCount !== 1 ? 's' : ''} remaining
        </span>
      </div>

      <p style="color:var(--text-dim); margin-bottom:1rem; font-size:0.9rem;">
        Rearrange Team ${team}'s cups into a new formation.
      </p>

      <!-- Cup preview -->
      <div class="card" style="margin-bottom:1rem; text-align:center;" id="rack-preview">
        ${renderRack(cups)}
      </div>

      <!-- Shape selector (if multiple options) -->
      ${shapeNames.length > 1 ? `
        <div class="card" style="margin-bottom:1rem;">
          <span class="label">Choose shape</span>
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.5rem;">
            ${shapeNames.map((name, i) => `
              <button class="shape-btn ${i === 0 ? 'btn-primary' : 'btn-secondary'}"
                data-shape="${name}"
                style="width:auto; padding:0.35rem 0.75rem; font-size:0.8rem;">
                ${name}
              </button>`).join('')}
          </div>
        </div>` : ''}

      <button id="confirm-rerack" class="btn-primary" style="margin-top:0.5rem;">
        Confirm Re-rack
      </button>
      <button id="skip-rerack" class="btn-secondary" style="margin-top:0.5rem;">
        Skip (keep current)
      </button>
    </div>`;

  // Shape button handling
  let selectedShape = shapeNames[0] ?? null;
  $el.querySelectorAll('.shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $el.querySelectorAll('.shape-btn').forEach(b => {
        b.className = b === btn ? 'shape-btn btn-primary' : 'shape-btn btn-secondary';
        b.style.cssText = 'width:auto; padding:0.35rem 0.75rem; font-size:0.8rem;';
      });
      selectedShape = btn.dataset.shape;
    });
  });

  document.getElementById('skip-rerack').addEventListener('click', () => {
    navigate(`#/game/${gameId}`);
  });

  document.getElementById('confirm-rerack').addEventListener('click', async () => {
    const btn = document.getElementById('confirm-rerack');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      // Assign new positions: keep the same cup IDs, just renumber positions 0..N-1
      const newPositions = shapes[selectedShape] ?? cups.map((_, i) => i);
      const updates = cups.map((cup, i) => ({
        id: cup.id,
        rack_position: newPositions[i] ?? i,
      }));

      for (const { id, rack_position } of updates) {
        const { error: upErr } = await supabase
          .from('cups')
          .update({ rack_position })
          .eq('id', id);
        if (upErr) throw new Error(upErr.message);
      }

      // Log the re-rack event
      await supabase.from('re_racks').insert({
        game_id: gameId,
        team,
        cups_remaining_at_rerack: cupCount,
        performed_by: currentUser?.id,
      });

      navigate(`#/game/${gameId}`);
    } catch (err) {
      toast(`Re-rack failed: ${err.message}`, 'error');
      btn.disabled = false;
      btn.textContent = 'Confirm Re-rack';
    }
  });
}
