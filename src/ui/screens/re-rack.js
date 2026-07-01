/**
 * src/ui/screens/re-rack.js
 *
 * Re-rack screen — shown when a team reaches a trigger cup count.
 *
 * Formation library is ported from V2_rerack_reference.html.
 * Slot numbering matches the RACKED reference grid:
 *
 *   10-cup (4-3-2-1):        6-cup (3-2-1):
 *   [0][1][2][3]  ← tip      [0][1][2]  ← tip
 *      [4][5][6]               [3][4]
 *        [7][8]                  [5]
 *          [9]   ← back
 *
 * Params: { id: gameId, team: 'A' | 'B' }  (team from query string)
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate }              from '../../router.js';
import { toast }                 from '../components/toast.js';
import { renderRack }            from '../components/cup-rack.js';

// ─── Formation library ──────────────────────────────────────────────────────
// Keyed by game cup count (10 or 6), then by cups-remaining count.
// Each formation: { name, slots[] }
// Slot numbers correspond directly to rack_position values in the DB.

const FORMATIONS = {
  10: {
    6: [
      { name: 'Triangle L',    slots: [0,1,2,4,5,7] },
      { name: 'Triangle R',    slots: [1,2,3,5,6,8] },
      { name: 'Rev. Triangle', slots: [0,4,5,7,8,9] },
    ],
    5: [
      { name: 'Triangle L',   slots: [0,1,2,4,5] },
      { name: 'Triangle R',   slots: [1,2,3,5,6] },
      { name: 'House L',      slots: [0,1,4,5,7] },
      { name: 'House R',      slots: [2,3,5,6,8] },
    ],
    4: [
      { name: 'Square L',     slots: [0,1,4,5] },
      { name: 'Square R',     slots: [2,3,5,6] },
      { name: 'T-shape L',    slots: [0,1,2,5] },
      { name: 'T-shape R',    slots: [1,2,3,5] },
    ],
    3: [
      { name: 'Triangle L',   slots: [0,1,2] },
      { name: 'Triangle R',   slots: [1,2,3] },
      { name: 'Corner L',     slots: [0,1,4] },
      { name: 'Corner R',     slots: [2,3,6] },
      { name: 'L-shape L',    slots: [0,4,5] },
      { name: 'L-shape R',    slots: [3,5,6] },
    ],
    2: [
      { name: 'Side by Side (L)',  slots: [0,1] },
      { name: 'Side by Side (M)',  slots: [1,2] },
      { name: 'Side by Side (R)',  slots: [2,3] },
      { name: 'Diagonal L',        slots: [0,4] },
      { name: 'Diagonal R',        slots: [3,6] },
    ],
    1: [
      { name: 'Slot 0', slots: [0] },
      { name: 'Slot 1', slots: [1] },
      { name: 'Slot 2', slots: [2] },
      { name: 'Slot 3', slots: [3] },
    ],
  },
  6: {
    5: [
      { name: 'Near Full L', slots: [0,1,2,3,5] },
      { name: 'Near Full R', slots: [0,1,2,4,5] },
    ],
    4: [
      { name: 'Diamond',      slots: [1,3,4,5] },
      { name: 'Trapezoid L',  slots: [0,1,3,4] },
      { name: 'Trapezoid R',  slots: [1,2,3,4] },
      { name: 'Square L',     slots: [0,1,3,5] },
      { name: 'Square R',     slots: [1,2,4,5] },
    ],
    3: [
      { name: 'Triangle',     slots: [0,1,2] },
      { name: 'Corner L',     slots: [0,1,3] },
      { name: 'Corner R',     slots: [1,2,4] },
      { name: 'L-shape L',    slots: [0,3,4] },
      { name: 'L-shape R',    slots: [2,3,4] },
    ],
    2: [
      { name: 'Side by Side (L)', slots: [0,1] },
      { name: 'Side by Side (R)', slots: [1,2] },
      { name: 'Diagonal L',       slots: [0,3] },
      { name: 'Diagonal R',       slots: [2,4] },
    ],
    1: [
      { name: 'Slot 0', slots: [0] },
      { name: 'Slot 1', slots: [1] },
      { name: 'Slot 2', slots: [2] },
    ],
  },
};

// ─── Screen ─────────────────────────────────────────────────────────────────

export default async function render($el, { id: gameId, team }) {
  if (!gameId || !team) { navigate('#/'); return; }

  $el.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">Loading…</p></div>`;

  // Load game (need cup_count) + standing cups for the re-racking team
  const [gameRes, cupsRes] = await Promise.all([
    supabase.from('games').select('cup_count').eq('id', gameId).single(),
    supabase.from('cups')
      .select('id, rack_position, status, team')
      .eq('game_id', gameId)
      .eq('team', team)
      .eq('status', 'standing')
      .order('rack_position'),
  ]);

  if (gameRes.error || cupsRes.error) {
    toast('Could not load game data', 'error');
    navigate(`#/game/${gameId}`);
    return;
  }

  const gameCupCount = gameRes.data.cup_count;          // 6 or 10
  const standingCups = cupsRes.data ?? [];
  const remaining    = standingCups.length;

  // Look up formations for this cup count and remaining count
  const formations = FORMATIONS[gameCupCount]?.[remaining] ?? [];
  const teamColor  = team === 'A' ? 'var(--blue)' : 'var(--amber)';

  let selectedIndex = 0;

  // ─── Render screen ────────────────────────────────────────────────────────

  $el.innerHTML = `
    <div>
      <!-- Header -->
      <div style="display:flex; align-items:baseline; gap:0.75rem; margin-bottom:1.25rem;">
        <h1 style="font-size:2.5rem; color:var(--amber);">RE-RACK</h1>
        <span style="font-size:0.8rem; color:var(--text-faint); padding-bottom:0.35rem;">
          Team <span style="color:${teamColor};">${team}</span>
          · ${remaining} cup${remaining !== 1 ? 's' : ''} remaining
        </span>
      </div>

      <!-- Current layout preview -->
      <div class="card" style="margin-bottom:1rem; text-align:center; padding:1rem;">
        <div style="font-size:0.7rem; color:var(--text-faint); text-transform:uppercase;
                    letter-spacing:0.06em; margin-bottom:0.6rem;">Current layout</div>
        <div style="display:inline-block;" id="current-preview">
          ${renderRack(standingCups, { cupCount: gameCupCount, showGhosts: true })}
        </div>
      </div>

      ${formations.length === 0 ? `
        <!-- No formations — just confirm or skip -->
        <p style="color:var(--text-dim); text-align:center; margin-bottom:1rem;">
          No standard formations for ${remaining} cup${remaining !== 1 ? 's' : ''}.
        </p>
      ` : `
        <!-- Formation grid -->
        <p style="font-size:0.85rem; color:var(--text-dim); margin-bottom:0.75rem;">
          Choose a new formation:
        </p>
        <div id="formation-grid"
          style="display:grid; grid-template-columns:repeat(auto-fill, minmax(100px, 1fr));
                 gap:0.6rem; margin-bottom:1rem;">
          ${formations.map((f, i) => `
            <button class="formation-card ${i === 0 ? 'selected' : ''}"
              data-idx="${i}"
              style="${cardStyle(i === 0)}">
              <div style="margin-bottom:0.4rem; display:flex; justify-content:center;">
                ${previewSVG(f.slots, gameCupCount, remaining)}
              </div>
              <div style="font-size:0.65rem; font-weight:500; color:${i === 0 ? 'var(--text)' : 'var(--text-dim)'};">
                ${f.name}
              </div>
            </button>
          `).join('')}
        </div>
      `}

      <!-- Actions -->
      <div style="display:flex; flex-direction:column; gap:0.5rem;">
        <button id="confirm-rerack" class="btn-primary"
          style="${formations.length === 0 ? 'display:none;' : ''}">
          Apply Formation
        </button>
        <button id="skip-rerack" class="btn-secondary">
          Skip — keep current layout
        </button>
      </div>
    </div>`;

  // ─── Formation selection ──────────────────────────────────────────────────

  $el.querySelectorAll('.formation-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedIndex = Number(card.dataset.idx);
      $el.querySelectorAll('.formation-card').forEach((c, i) => {
        const sel = i === selectedIndex;
        c.style.cssText = cardStyle(sel);
        c.querySelector('div:last-child').style.color = sel ? 'var(--text)' : 'var(--text-dim)';
        if (sel) c.classList.add('selected'); else c.classList.remove('selected');
      });
    });
  });

  // ─── Skip ────────────────────────────────────────────────────────────────

  document.getElementById('skip-rerack').addEventListener('click', async () => {
    // Still log the re_racks row so history is accurate
    await supabase.from('re_racks').insert({
      game_id: gameId, team,
      cups_remaining_at_rerack: remaining,
      performed_by: currentUser?.id,
    });
    navigate(`#/game/${gameId}`);
  });

  // ─── Confirm ─────────────────────────────────────────────────────────────

  const confirmBtn = document.getElementById('confirm-rerack');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Applying…';

      try {
        const formation = formations[selectedIndex];
        if (!formation) throw new Error('No formation selected');

        // Assign each standing cup to the formation's slot in order
        for (let i = 0; i < standingCups.length; i++) {
          const newPos = formation.slots[i] ?? i;
          const { error } = await supabase
            .from('cups')
            .update({ rack_position: newPos })
            .eq('id', standingCups[i].id);
          if (error) throw new Error(error.message);
        }

        // Log the re_racks event
        await supabase.from('re_racks').insert({
          game_id: gameId, team,
          cups_remaining_at_rerack: remaining,
          performed_by: currentUser?.id,
        });

        navigate(`#/game/${gameId}`);
      } catch (err) {
        toast(`Re-rack failed: ${err.message}`, 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Apply Formation';
      }
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function cardStyle(selected) {
  return [
    'background:' + (selected ? 'var(--surface-2)' : 'var(--surface)'),
    'border:1px solid ' + (selected ? 'var(--purple)' : 'transparent'),
    'border-radius:12px',
    'padding:0.6rem 0.4rem',
    'cursor:pointer',
    'text-align:center',
    'transition:border-color 0.15s',
  ].join(';');
}

/**
 * Render a small preview SVG for a formation.
 * Shows ghost positions for all slots in the layout, highlights active slots.
 *
 * @param {number[]} slots      - active rack_positions in this formation
 * @param {number}   gameCupCount - 6 or 10 (full game layout)
 * @param {number}   remaining  - cups remaining count
 */
function previewSVG(slots, gameCupCount, remaining) {
  const R    = 6;   // cup radius
  const S    = 17;  // cup spacing
  const activeSet = new Set(slots);

  // Layouts mirroring cup-rack.js but scaled small
  const MINI = {
    10: [
      [0,1,2,3],
      [4,5,6],
      [7,8],
      [9],
    ],
    6: [
      [0,1,2],
      [3,4],
      [5],
    ],
  };

  const rows    = MINI[gameCupCount] ?? MINI[10];
  const maxCols = Math.max(...rows.map(r => r.length));
  const W       = maxCols * S + 4;
  const H       = rows.length * S + 4;

  const circles = [];
  rows.forEach((row, rowIdx) => {
    const offsetX = ((maxCols - row.length) / 2) * S;
    row.forEach((pos, colIdx) => {
      const cx = offsetX + colIdx * S + S / 2 + 2;
      const cy = rowIdx  * S + S / 2 + 2;
      const active = activeSet.has(pos);
      circles.push(
        `<circle cx="${cx}" cy="${cy}" r="${R}"
          fill="${active ? 'var(--blue)' : 'rgba(255,255,255,0.07)'}"
          stroke="${active ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.05)'}"
          stroke-width="1"/>`
      );
    });
  });

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
    xmlns="http://www.w3.org/2000/svg">${circles.join('')}</svg>`;
}
