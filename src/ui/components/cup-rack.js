/**
 * src/ui/components/cup-rack.js
 *
 * Renders beer pong cup racks with proper SVG design matching V2_rerack_reference.html.
 * NOW: Shows cups hit in current pair even if marked as 'hit' in DB (for same-cup hits)
 */

// ─── Constants ─────────────────────────────────────────────────────────────
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

const ALL_SLOTS_10 = [0,1,2,3,4,5,6,7,8,9];
const ALL_SLOTS_6  = [0,1,2,3,4,5];

let _uid = 0;

function yToPx(gy) {
  return Math.ceil(gy) * CELL;
}

function renderCup(cx, cy, isActive, isRed, isHit = false, isCurrentPairHit = false) {
  const hw = CUP_W / 2;
  const hb = CUP_BOT / 2;
  const t = cy - CUP_H / 2;
  const b = cy + CUP_H / 2;
  const pts = `${cx-hw},${t} ${cx+hw},${t} ${cx+hb},${b} ${cx-hb},${b}`;

  // ✅ FIX: Cups hit in current pair stay visible (not dimmed)
  const isVisible = isActive || isCurrentPairHit;

  const fill = isVisible
    ? (isRed ? 'url(#grad-red)' : 'url(#grad-blue)')
    : (isRed ? 'rgba(226,64,45,0.09)' : 'rgba(61,134,198,0.09)');

  const stroke = isVisible
    ? (isRed ? '#C43020' : '#2A6A9E')
    : (isRed ? 'rgba(226,64,45,0.16)' : 'rgba(61,134,198,0.16)');

  // ✅ ADD: Visual indicator for current pair hits (optional)
  const opacity = isCurrentPairHit ? 0.7 : 1;

  return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="1" style="opacity:${opacity}"/>`;
}

function getGradientIds() {
  const redId = `grad-red-${_uid}`;
  const blueId = `grad-blue-${_uid++}`;
  return { redId, blueId };
}

/**
 * Render a complete cup rack as SVG.
 *
 * @param {Array} cups - Array of cup objects with: id, team, rack_position, status
 * @param {Object} options - Configuration options
 * @param {number} options.cupCount - 6 or 10 (game type)
 * @param {boolean} options.interactive - Add data attributes for interactivity
 * @param {boolean} options.showGhosts - Show empty slots as ghost cups
 * @param {Array} options.currentPairHitCups - IDs of cups hit in current pair (to keep visible)
 */
export function renderRack(cups, options = {}) {
  const {
    cupCount = 10,
    interactive = false,
    showGhosts = false,
    currentPairHitCups = [],  // ✅ NEW: Cups hit in current pair
  } = options;

  const grid = cupCount === 6 ? GRID6 : GRID10;
  const allSlots = cupCount === 6 ? ALL_SLOTS_6 : ALL_SLOTS_10;

  // ✅ CHANGE: Don't filter by status - we'll handle visibility per-cup
  const cupsToRender = [...cups];

  // Calculate SVG dimensions based on grid bounds
  const allXs = allSlots.map(s => grid[s].x);
  const allYs = allSlots.map(s => grid[s].y);
  const minX = Math.min(...allXs);
  const maxX = Math.max(...allXs);
  const minY = Math.min(...allYs);
  const maxY = Math.max(...allYs);

  const svgW = (maxX - minX) * CELL + CUP_W + PAD * 2;
  const svgH = (maxY - minY) * CELL + CUP_H + PAD * 2;

  const { redId, blueId } = getGradientIds();
  const currentPairHitSet = new Set(currentPairHitCups);

  function toXY(gx, gy) {
    return {
      cx: PAD + CUP_W / 2 + (gx - minX) * CELL,
      cy: PAD + CUP_H / 2 + yToPx(gy) - yToPx(minY),
    };
  }

  let shapes = '';

  // Draw ghost cups (inactive positions) first
  if (showGhosts) {
    allSlots.forEach(slot => {
      const cup = cupsToRender.find(c => c.rack_position === slot);
      if (!cup) {
        const {x, y} = grid[slot];
        const {cx, cy} = toXY(x, y);
        shapes += renderCup(cx, cy, false, false, false, false);
      }
    });
  }

  // Draw all cups (both standing and hit-in-current-pair)
  cupsToRender.forEach(cup => {
    const {x, y} = grid[cup.rack_position];
    const {cx, cy} = toXY(x, y);
    const isRed = cup.team === 'A';
    const isHit = cup.status === 'hit';
    const isCurrentPairHit = currentPairHitSet.has(cup.id);

    // ✅ KEY FIX: Keep cup visible if it's in current pair
    const isVisible = cup.status === 'standing' || isCurrentPairHit;

    if (interactive) {
      shapes += `<g data-cup-id="${cup.id}" data-team="${cup.team}" data-rack-position="${cup.rack_position}">` +
                renderCup(cx, cy, isVisible, isRed, isHit, isCurrentPairHit) +
                '</g>';
    } else {
      shapes += renderCup(cx, cy, isVisible, isRed, isHit, isCurrentPairHit);
    }

    // Add X mark for cups that are hit AND not in current pair
    if (isHit && !isCurrentPairHit) {
      const size = CUP_W * 0.6;
      shapes += `<line x1="${cx-size/2}" y1="${cy-size/2}" x2="${cx+size/2}" y2="${cy+size/2}" 
                stroke="${isRed ? '#E2402D' : '#3D86C6'}" stroke-width="2" opacity="0.7"/>
                <line x1="${cx+size/2}" y1="${cy-size/2}" x2="${cx-size/2}" y2="${cy+size/2}" 
                stroke="${isRed ? '#E2402D' : '#3D86C6'}" stroke-width="2" opacity="0.7"/>`;
    }
  });

  return `<svg width="${Math.ceil(svgW)}" height="${Math.ceil(svgH)}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs>
      <linearGradient id="${redId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#F2604B"/>
        <stop offset="100%" stop-color="#C43020"/>
      </linearGradient>
      <linearGradient id="${blueId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5AA3DE"/>
        <stop offset="100%" stop-color="#2A6A9E"/>
      </linearGradient>
    </defs>
    ${shapes}
  </svg>`;
}
