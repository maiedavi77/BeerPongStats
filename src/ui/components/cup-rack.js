/**
 * src/ui/components/cup-rack.js
 *
 * Renders beer pong cup racks with proper SVG design matching V2_rerack_reference.html.
 * Supports 6-cup and 10-cup layouts with trapezoidal cups and team gradients.
 */

// ─── Constants ─────────────────────────────────────────────────────────────
const CUP_W   = 18;    // Cup width
const CUP_H   = 14;    // Cup height
const CUP_BOT = 10;    // Cup bottom width (creates trapezoid)
const CELL    = 26;    // Row pitch (vertical spacing)
const PAD     = 8;     // Padding

// Grid coordinate systems (matching V2_rerack_reference.html)
const GRID10 = {
  0:{x:0,   y:0}, 1:{x:1,   y:0}, 2:{x:2,   y:0}, 3:{x:3,   y:0},    // Row 0 (tip)
  4:{x:0.5, y:1}, 5:{x:1.5, y:1}, 6:{x:2.5, y:1},                    // Row 1
  7:{x:1,   y:2}, 8:{x:2,   y:2},                                  // Row 2
  9:{x:1.5, y:3},                                                   // Row 3 (back)
};

const GRID6 = {
  0:{x:0,   y:0}, 1:{x:1,   y:0}, 2:{x:2,   y:0},    // Row 0 (tip)
  3:{x:0.5, y:1}, 4:{x:1.5, y:1},                    // Row 1
  5:{x:1,   y:2},                                     // Row 2 (back)
};

const ALL_SLOTS_10 = [0,1,2,3,4,5,6,7,8,9];
const ALL_SLOTS_6  = [0,1,2,3,4,5];

let _uid = 0;

/**
 * Convert grid Y coordinate to pixel Y position.
 * Half-positions (0.5, 1.5, 2.5) are centered between integer rows.
 */
function yToPx(gy) {
  return Math.ceil(gy) * CELL;
}

/**
 * Render a single cup as SVG polygon.
 * @param {number} cx - Center X in pixels
 * @param {number} cy - Center Y in pixels
 * @param {boolean} isActive - Whether cup is standing (not hit)
 * @param {boolean} isRed - Team A (red) or Team B (blue)
 * @param {boolean} isLineCup - Whether this is a line cup (half-position)
 * @returns {string} SVG polygon element
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
 * Generate unique gradient IDs for this SVG.
 */
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
 * @param {boolean} options.showLineCups - Show line cup positions (for re-rack)
 * @param {Array} options.lineCups - Array of line cup positions {x, y}
 * @returns {string} SVG markup
 */
export function renderRack(cups, options = {}) {
  const {
    cupCount = 10,
    interactive = false,
    showGhosts = false,
    showLineCups = false,
    lineCups = [],
  } = options;

  const grid = cupCount === 6 ? GRID6 : GRID10;
  const allSlots = cupCount === 6 ? ALL_SLOTS_6 : ALL_SLOTS_10;

  // Group cups
  const activeCups = cups.filter(c => c.status === 'standing');
  const hitCups = cups.filter(c => c.status === 'hit');

  // Calculate SVG dimensions based on grid bounds
  const allXs = allSlots.map(s => grid[s].x);
  const allYs = allSlots.map(s => grid[s].y);
  const minX = Math.min(...allXs);
  const maxX = Math.max(...allXs);
  const minY = Math.min(...allYs);
  const maxY = Math.max(...allYs);

  // Account for line cups in bounds
  if (showLineCups && lineCups.length > 0) {
    lineCups.forEach(lc => {
      allXs.push(lc.x);
      allYs.push(lc.y);
    });
    const lineMinX = Math.min(...lineCups.map(lc => lc.x));
    const lineMaxX = Math.max(...lineCups.map(lc => lc.x));
    const lineMinY = Math.min(...lineCups.map(lc => lc.y));
    const lineMaxY = Math.max(...lineCups.map(lc => lc.y));
    allXs.push(lineMinX, lineMaxX);
    allYs.push(lineMinY, lineMaxY);
  }

  const svgW = (Math.max(...allXs) - Math.min(...allXs)) * CELL + CUP_W + PAD * 2;
  const svgH = (Math.max(...allYs) - Math.min(...allYs)) * CELL + CUP_H + PAD * 2;

  const { redId, blueId } = getGradientIds();

  function toXY(gx, gy) {
    const minXAll = Math.min(...allXs);
    const minYAll = Math.min(...allYs);
    return {
      cx: PAD + CUP_W / 2 + (gx - minXAll) * CELL,
      cy: PAD + CUP_H / 2 + yToPx(gy) - yToPx(minYAll),
    };
  }

  let shapes = '';

  // Draw ghost cups (inactive positions) first
  if (showGhosts) {
    allSlots.forEach(slot => {
      const cup = activeCups.find(c => c.rack_position === slot);
      if (!cup) {
        const {x, y} = grid[slot];
        const {cx, cy} = toXY(x, y);
        shapes += renderCup(cx, cy, false, false);
      }
    });
  }

  // Draw active cups
  activeCups.forEach(cup => {
    const {x, y} = grid[cup.rack_position];
    const {cx, cy} = toXY(x, y);
    const isRed = cup.team === 'A';
    const cupSvg = renderCup(cx, cy, true, isRed);
    
    if (interactive) {
      shapes += `<g data-cup-id="${cup.id}" data-team="${cup.team}" data-rack-position="${cup.rack_position}">${cupSvg}</g>`;
    } else {
      shapes += cupSvg;
    }
  });

  // Draw line cups (for re-rack formations)
  if (showLineCups && lineCups.length > 0) {
    lineCups.forEach(lc => {
      const {cx, cy} = toXY(lc.x, lc.y);
      // Line cups are always active in formation previews
      shapes += renderCup(cx, cy, true, false, true);
    });
  }

  // Draw hit cups (as X marks or different style)
  hitCups.forEach(cup => {
    const {x, y} = grid[cup.rack_position];
    const {cx, cy} = toXY(x, y);
    const isRed = cup.team === 'A';
    shapes += renderCup(cx, cy, false, isRed);
    
    // Add X mark for hit cups
    const size = CUP_W * 0.6;
    shapes += `<line x1="${cx-size/2}" y1="${cy-size/2}" x2="${cx+size/2}" y2="${cy+size/2}" 
              stroke="${isRed ? '#E2402D' : '#3D86C6'}" stroke-width="2" opacity="0.7"/>
              <line x1="${cx+size/2}" y1="${cy-size/2}" x2="${cx-size/2}" y2="${cy+size/2}" 
              stroke="${isRed ? '#E2402D' : '#3D86C6'}" stroke-width="2" opacity="0.7"/>`;
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
