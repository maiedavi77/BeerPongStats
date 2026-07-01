/**
 * src/ui/screens/re-rack.js
 *
 * Re-rack screen — shown when a team reaches a trigger cup count.
 *
 * Formation library ported from V2_rerack_reference.html with:
 * - Proper SVG cup design (trapezoidal with gradients)
 * - Line cup support for special formations
 * - Grid layout matching the reference
 *
 * Slot numbering (10-cup):
 *   [0][1][2][3]  ← tip row (required: at least 1 cup here)
 *      [4][5][6]
 *        [7][8]
 *          [9]   ← back row
 *
 * Slot numbering (6-cup):
 *   [0][1][2]  ← tip row (required)
 *      [3][4]
 *        [5]
 *
 * Params: { id: gameId, team: 'A' | 'B' }
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate }              from '../../router.js';
import { toast }                 from '../components/toast.js';

// ─── SVG Constants (matching V2_rerack_reference.html) ────────────────────
const CUP_W   = 18;
const CUP_H   = 14;
const CUP_BOT = 10;
const CELL    = 26;
const PAD     = 8;

const GRID10 = {
  0:{x:0,   y:0}, 1:{x:1,   y:0}, 2:{x:2,   y:0}, 3:{x:3,   y:0},
  4:{x:0.5, y:1}, 5:{x:1.5, y:1}, 6:{x:2.5, y:1},
  7:{x:1,   y:2}, 8:{x:2,   y:2},
  9:{x:1.5, y:3},
};

const GRID6 = {
  0:{x:0,   y:0}, 1:{x:1,   y:0}, 2:{x:2,   y:0},
  3:{x:0.5, y:1}, 4:{x:1.5, y:1},
  5:{x:1,   y:2},
};

const ALL10 = [0,1,2,3,4,5,6,7,8,9];
const ALL6  = [0,1,2,3,4,5];

let _uid = 0;

function yToPx(gy) {
  return Math.ceil(gy) * CELL;
}

/**
 * Render a cup as SVG polygon with proper trapezoidal shape.
 */
function renderCup(cx, cy, isActive, isRed, isLineCup = false) {
  const hw = CUP_W / 2;
  const hb = CUP_BOT / 2;
  const t = cy - CUP_H / 2;
  const b = cy + CUP_H / 2;
  const pts = `${cx-hw},${t} ${cx+hw},${t} ${cx+hb},${b} ${cx-hb},${b}`;

  const fill = isActive
    ? (isRed ? 'url(#grad-red)' : 'url(#grad-blue)')
    : (isRed ? 'rgba(226,64,45,0.09)' : 'rgba(61,134,198,0.09)');

  const stroke = isActive
    ? (isRed ? '#C43020' : '#2A6A9E')
    : (isRed ? 'rgba(226,64,45,0.16)' : 'rgba(61,134,198,0.16)');

  return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
}

/**
 * Build complete SVG for a formation.
 */
function buildFormationSVG(formation, grid, allSlots, isRed = false) {
  const id = _uid++;
  const gradRed = `gr-${id}-red`;
  const gradBlue = `gr-${id}-blue`;

  const activeSet = new Set(formation.slots || []);
  const lineCups = formation.lineCups || [];

  const allXs = allSlots.map(s => grid[s].x);
  const allYs = allSlots.map(s => grid[s].y);
  const minX = Math.min(...allXs);
  const maxX = Math.max(...allXs);
  const minY = Math.min(...allYs);
  const maxY = Math.max(...allYs);

  // Include line cups in bounds
  lineCups.forEach(lc => {
    allXs.push(lc.x);
    allYs.push(lc.y);
  });

  const svgW = (maxX - minX) * CELL + CUP_W + PAD * 2;
  const svgH = (maxY - minY) * CELL + CUP_H + PAD * 2;

  function toXY(gx, gy) {
    return {
      cx: PAD + CUP_W / 2 + (gx - minX) * CELL,
      cy: PAD + CUP_H / 2 + yToPx(gy) - yToPx(minY),
    };
  }

  let shapes = '';

  // Draw inactive cups (ghosts)
  allSlots.forEach(slot => {
    if (!activeSet.has(slot)) {
      const {x, y} = grid[slot];
      const {cx, cy} = toXY(x, y);
      shapes += renderCup(cx, cy, false, isRed);
    }
  });

  // Draw active regular cups
  allSlots.forEach(slot => {
    if (activeSet.has(slot)) {
      const {x, y} = grid[slot];
      const {cx, cy} = toXY(x, y);
      shapes += renderCup(cx, cy, true, isRed);
    }
  });

  // Draw line cups
  lineCups.forEach(lc => {
    const {cx, cy} = toXY(lc.x, lc.y);
    shapes += renderCup(cx, cy, true, isRed, true);
  });

  return `<svg width="${Math.ceil(svgW)}" height="${Math.ceil(svgH)}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs>
      <linearGradient id="${gradRed}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#F2604B"/>
        <stop offset="100%" stop-color="#C43020"/>
      </linearGradient>
      <linearGradient id="${gradBlue}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5AA3DE"/>
        <stop offset="100%" stop-color="#2A6A9E"/>
      </linearGradient>
    </defs>
    ${shapes}
  </svg>`;
}

// ─── Formation Library (with line cup support) ─────────────────────────────

const FORMATIONS = {
  10: {
    6: [
      { name: 'Triangle L',      slots: [0,1,2,4,5,7] },
      { name: 'Triangle R',      slots: [1,2,3,5,6,8] },
      { name: 'Rev. Triangle',   slots: [0,4,5,7,8,9] },
      { name: 'Mehnerskolben',    slots: [1,2], lineCups: [{x:1.5,y:0.5}, {x:1.5,y:1.5}, {x:1.5,y:2.5}] },
    ],
    5: [
      { name: 'Triangle L',      slots: [0,1,2,4,5] },
      { name: 'Triangle R',      slots: [1,2,3,5,6] },
      { name: 'House L',         slots: [0,1,4,5,7] },
      { name: 'House R',         slots: [2,3,5,6,8] },
      { name: 'Small Penis',     slots: [1,2,5], lineCups: [{x:1.5,y:1.5}] },
    ],
    4: [
      { name: 'Square L',        slots: [0,1,4,5] },
      { name: 'Square R',        slots: [2,3,5,6] },
      { name: 'T-shape L',       slots: [0,1,2,5] },
      { name: 'T-shape R',       slots: [1,2,3,5] },
      { name: 'Small Penis',     slots: [1,2,5], lineCups: [{x:1.5,y:2.5}] },
      { name: 'Line (4)',        slots: [1,2], lineCups: [{x:1.5,y:0.5}, {x:1.5,y:2.5}] },
    ],
    3: [
      { name: 'Triangle',        slots: [0,1,2] },
      { name: 'Triangle R',      slots: [1,2,3] },
      { name: 'Corner L',        slots: [0,1,4] },
      { name: 'Corner R',        slots: [2,3,6] },
      { name: 'L-shape L',       slots: [0,4,5] },
      { name: 'L-shape R',       slots: [3,5,6] },
      { name: 'Line (3)',        slots: [1,2], lineCups: [{x:1.5,y:0.5}] },
    ],
    2: [
      { name: 'Side by side L',  slots: [0,1] },
      { name: 'Side by side M',  slots: [1,2] },
      { name: 'Side by side R',  slots: [2,3] },
      { name: 'Diagonal L',      slots: [0,4] },
      { name: 'Diagonal R',      slots: [3,6] },
    ],
    1: [
      { name: 'Single (0)',      slots: [0] },
      { name: 'Single (1)',      slots: [1] },
      { name: 'Single (2)',      slots: [2] },
      { name: 'Single (3)',      slots: [3] },
    ],
  },
  6: {
    5: [
      { name: 'Near full L',     slots: [0,1,2,3,5] },
      { name: 'Near full R',     slots: [0,1,2,4,5] },
    ],
    4: [
      { name: 'Diamond',         slots: [1,3,4,5] },
      { name: 'Trapezoid L',     slots: [0,1,3,4] },
      { name: 'Trapezoid R',     slots: [1,2,3,4] },
      { name: 'Square L',        slots: [0,1,3,5] },
      { name: 'Square R',        slots: [1,2,4,5] },
    ],
    3: [
      { name: 'Triangle',        slots: [0,1,2] },
      { name: 'Corner L',        slots: [0,1,3] },
      { name: 'Corner R',        slots: [1,2,4] },
      { name: 'L-shape L',       slots: [0,3,4] },
      { name: 'L-shape R',       slots: [2,3,4] },
      { name: 'Line (centre)',   slots: [1,5], lineCups: [{x:1,y:1.5}] },
    ],
    2: [
      { name: 'Side by side L',  slots: [0,1] },
      { name: 'Side by side R',  slots: [1,2] },
      { name: 'Diagonal L',      slots: [0,3] },
      { name: 'Diagonal R',      slots: [2,4] },
      { name: 'Line (centre)',   slots: [1], lineCups: [{x:1,y:1.5}] },
    ],
    1: [
      { name: 'Single (0)',      slots: [0] },
      { name: 'Single (1)',      slots: [1] },
      { name: 'Single (2)',      slots: [2] },
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
  const grid = gameCupCount === 10 ? GRID10 : GRID6;
  const allSlots = gameCupCount === 10 ? ALL10 : ALL6;
  const teamColor = team === 'A' ? 'var(--red)' : 'var(--blue)';

  let selectedIndex = 0;

  // ─── Render screen ────────────────────────────────────────────────────────

  $el.innerHTML = `
    <div style="padding:18px 18px 24px; max-width:480px; margin:0 auto;">
      <!-- Header -->
      <div style="display:flex; align-items:baseline; gap:0.75rem; margin-bottom:1.25rem;">
        <h1 style="font-family:'Bebas Neue',sans-serif; font-size:2.5rem; color:var(--amber);">RE-RACK</h1>
        <span style="font-family:'JetBrains Mono',monospace; font-size:0.8rem; color:var(--text-faint); padding-bottom:0.35rem;">
          Team <span style="color:${teamColor};">${team}</span>
          · ${remaining} cup${remaining !== 1 ? 's' : ''} remaining
        </span>
      </div>

      <!-- Rules reminder -->
      <div style="background:var(--surface-2); border:1px solid var(--line);
          border-radius:14px; padding:16px 18px; margin-bottom:20px;
          font-size:13px; color:var(--text-dim); line-height:1.7;">
        <b style="color:var(--amber);">Tip-row rule:</b> at least one cup must be in the
        <b>tip row</b> (slots ${gameCupCount === 10 ? '0-3' : '0-2'}).
        All formations must be a <b>connected cluster</b> (cups touching).
        <b>Line formations</b> place cups at half-positions between rows.
      </div>

      <!-- Current layout preview -->
      <div class="card" style="margin-bottom:1rem; text-align:center; padding:1rem; background:var(--surface); border:1px solid var(--line); border-radius:14px;">
        <div style="font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:1px;
            text-transform:uppercase; color:var(--text-faint); margin-bottom:0.6rem;">Current layout</div>
        <div style="display:inline-block;" id="current-preview"></div>
      </div>

      ${formations.length === 0 ? `
        <!-- No formations -->
        <p style="color:var(--text-dim); text-align:center; margin-bottom:1rem;">
          No standard formations for ${remaining} cup${remaining !== 1 ? 's' : ''}.
        </p>
      ` : `
        <!-- Formation grid -->
        <p style="font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:1px;
            text-transform:uppercase; color:var(--text-faint); margin-bottom:0.75rem;">
          Choose a new formation:
        </p>
        <div id="formation-grid"
          style="display:grid; grid-template-columns:repeat(auto-fill, minmax(110px, 1fr));
                 gap:12px; margin-bottom:1rem;">
          ${formations.map((f, i) => {
            const svg = buildFormationSVG(f, grid, allSlots, team === 'A');
            const slotsStr = (f.slots || []).slice().sort((a,b) => a-b).join(', ');
            const lineStr = (f.lineCups || []).map(c => `(${c.x},${c.y})`).join(', ');
            const note = [slotsStr ? 'slots: ' + slotsStr : '', lineStr ? 'line: ' + lineStr : ''].filter(Boolean).join(' + ');
            
            return `
            <button class="formation-card" data-idx="${i}"
              style="background:var(--surface); border:1px solid var(--line); border-radius:14px;
                     padding:14px 12px 12px; cursor:pointer; text-align:center;
                     transition:all 0.15s ease;">
              <div style="margin-bottom:8px; display:flex; justify-content:center;">
                ${svg}
              </div>
              <div style="font-weight:600; font-size:12px; color:var(--text); margin-bottom:4px;">${f.name}</div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--text-faint);">${note}</div>
            </button>`;
          }).join('')}
        </div>
      `}

      <!-- Actions -->
      <div style="display:flex; flex-direction:column; gap:12px;">
        <button id="confirm-rerack" class="btn-primary" style="${formations.length === 0 ? 'display:none;' : ''}">
          Apply Formation
        </button>
        <button id="skip-rerack" class="btn-secondary">
          Skip — keep current layout
        </button>
      </div>
    </div>`;

  // Render current preview
  const previewEl = document.getElementById('current-preview');
  if (previewEl) {
    const grid = gameCupCount === 10 ? GRID10 : GRID6;
    const allSlots = gameCupCount === 10 ? ALL10 : ALL6;
    let previewSVG = '<svg width="200" height="150" xmlns="http://www.w3.org/2000/svg" style="display:block">';
    previewSVG += '<defs>';
    previewSVG += '<linearGradient id="preview-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#F2604B"/><stop offset="100%" stop-color="#C43020"/></linearGradient>';
    previewSVG += '<linearGradient id="preview-blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5AA3DE"/><stop offset="100%" stop-color="#2A6A9E"/></linearGradient>';
    previewSVG += '</defs>';

    // Draw all slots as ghosts
    allSlots.forEach(slot => {
      const cup = standingCups.find(c => c.rack_position === slot);
      const {x, y} = grid[slot];
      const cx = PAD + CUP_W / 2 + x * CELL;
      const cy = PAD + CUP_H / 2 + yToPx(y);
      const isRed = team === 'A';
      const fill = cup ? (isRed ? 'url(#preview-red)' : 'url(#preview-blue)') : 'rgba(255,255,255,0.07)';
      const stroke = cup ? (isRed ? '#C43020' : '#2A6A9E') : 'rgba(255,255,255,0.05)';
      const hw = CUP_W / 2;
      const hb = CUP_BOT / 2;
      const t = cy - CUP_H / 2;
      const b = cy + CUP_H / 2;
      previewSVG += `<polygon points="${cx-hw},${t} ${cx+hw},${t} ${cx+hb},${b} ${cx-hb},${b}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
    });

    previewSVG += '</svg>';
    previewEl.innerHTML = previewSVG;
  }

  // ─── Formation selection ──────────────────────────────────────────────────

  $el.querySelectorAll('.formation-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedIndex = Number(card.dataset.idx);
      $el.querySelectorAll('.formation-card').forEach((c, i) => {
        c.style.borderColor = i === selectedIndex ? 'var(--purple)' : 'var(--line)';
        c.style.background = i === selectedIndex ? 'var(--surface-2)' : 'var(--surface)';
      });
    });
  });

  // ─── Skip ────────────────────────────────────────────────────────────────

  document.getElementById('skip-rerack').addEventListener('click', async () => {
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
        // Regular slots first, then line cups (if we had DB support for them)
        const allPositions = [...(formation.slots || [])];
        
        for (let i = 0; i < standingCups.length; i++) {
          const newPos = allPositions[i] ?? i;
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
