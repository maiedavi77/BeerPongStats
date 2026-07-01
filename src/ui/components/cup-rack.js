/**
 * src/ui/components/cup-rack.js
 *
 * SVG cup rack renderer for 6-cup and 10-cup layouts.
 *
 * Coordinate system matches the RACKED reference grid:
 *   Tip row (row 0) = furthest from the thrower → WIDEST row
 *   Back row (last) = closest to the thrower    → narrowest row
 *
 * 10-cup layout (4-3-2-1):
 *   Row 0 (tip):  pos 0,1,2,3  — 4 cups
 *   Row 1:        pos 4,5,6    — 3 cups
 *   Row 2:        pos 7,8      — 2 cups
 *   Row 3 (back): pos 9        — 1 cup
 *
 * 6-cup layout (3-2-1):
 *   Row 0 (tip):  pos 0,1,2   — 3 cups
 *   Row 1:        pos 3,4     — 2 cups
 *   Row 2 (back): pos 5       — 1 cup
 */

const CUP_RADIUS  = 20;
const CUP_SPACING = 48;

// Tip-to-back layouts: widest row first.
const LAYOUTS = {
  10: [
    [{ pos: 0 }, { pos: 1 }, { pos: 2 }, { pos: 3 }], // Row 0 (tip) — 4 cups
    [{ pos: 4 }, { pos: 5 }, { pos: 6 }],              // Row 1 — 3 cups
    [{ pos: 7 }, { pos: 8 }],                          // Row 2 — 2 cups
    [{ pos: 9 }],                                      // Row 3 (back) — 1 cup
  ],
  6: [
    [{ pos: 0 }, { pos: 1 }, { pos: 2 }], // Row 0 (tip) — 3 cups
    [{ pos: 3 }, { pos: 4 }],             // Row 1 — 2 cups
    [{ pos: 5 }],                         // Row 2 (back) — 1 cup
  ],
};

/**
 * Build pixel coordinates for every cup position in a layout.
 * Rows are centered relative to the widest (tip) row.
 *
 * @param {number} cupCount - 6 or 10
 * @returns {Map<number, {x:number, y:number}>}
 */
function buildPositionMap(cupCount) {
  const rows    = LAYOUTS[cupCount] ?? LAYOUTS[10];
  // Use the widest row (tip row) for total width — NOT the last row.
  const maxCols = Math.max(...rows.map(r => r.length));
  const totalW  = maxCols * CUP_SPACING;
  const posMap  = new Map();

  rows.forEach((row, rowIdx) => {
    const rowW   = row.length * CUP_SPACING;
    const offsetX = (totalW - rowW) / 2;
    row.forEach((cup, colIdx) => {
      posMap.set(cup.pos, {
        x: offsetX + colIdx * CUP_SPACING + CUP_SPACING / 2,
        y: rowIdx  * CUP_SPACING + CUP_SPACING / 2,
      });
    });
  });

  return posMap;
}

/**
 * Render a cup rack as an inline SVG string.
 *
 * @param {object[]} cups       - cup rows from game state (all cups incl. hit ones)
 * @param {object}   [options]
 * @param {boolean}  [options.interactive]  - add data-cup-id attrs for tap-to-hit
 * @param {number}   [options.cupCount]     - override layout selection (6|10)
 * @param {boolean}  [options.showGhosts]   - show empty positions as faint outlines
 * @param {Map}      [options.hitCounts]    - Map<rack_position, count> for heatmap
 * @returns {string} SVG markup
 */
export function renderRack(cups, options = {}) {
  const cupCount  = options.cupCount ?? (cups.length > 6 ? 10 : 6);
  const rows      = LAYOUTS[cupCount] ?? LAYOUTS[10];
  const maxCols   = Math.max(...rows.map(r => r.length));
  const svgWidth  = maxCols * CUP_SPACING + 8;
  const svgHeight = rows.length * CUP_SPACING + 8;
  const posMap    = buildPositionMap(cupCount);

  // Build lookup: rack_position → cup object
  const cupByPos = new Map(cups.map(c => [c.rack_position, c]));

  const elements = [];

  for (const [pos, { x, y }] of posMap) {
    const cup = cupByPos.get(pos);

    if (!cup) {
      // Ghost: position exists in layout but no cup assigned here
      if (options.showGhosts) {
        elements.push(`<circle cx="${x}" cy="${y}" r="${CUP_RADIUS}"
          fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"
          stroke-dasharray="3 3"/>`);
      }
      continue;
    }

    let fill, stroke, opacity = '1';

    if (cup.status === 'hit') {
      fill    = 'var(--surface-3)';
      stroke  = 'var(--surface-2)';
      opacity = '0.30';
    } else if (options.hitCounts) {
      // Heatmap mode
      const count     = options.hitCounts.get(pos) ?? 0;
      const maxCount  = Math.max(...options.hitCounts.values(), 1);
      const intensity = count / maxCount;
      const r = Math.round(61  + (225 - 61)  * intensity);
      const g = Math.round(134 + (64  - 134) * intensity);
      const b = Math.round(198 + (45  - 198) * intensity);
      fill   = `rgb(${r},${g},${b})`;
      stroke = 'var(--surface-3)';
    } else {
      fill   = 'var(--blue)';
      stroke = 'rgba(255,255,255,0.15)';
    }

    const isClickable = options.interactive && cup.status === 'standing';
    const attrs = isClickable
      ? `data-cup-id="${cup.id}" data-rack-pos="${pos}" style="cursor:pointer;"`
      : '';

    elements.push(`
      <circle cx="${x}" cy="${y}" r="${CUP_RADIUS}"
        fill="${fill}" stroke="${stroke}" stroke-width="2"
        opacity="${opacity}" ${attrs}/>
      ${cup.status === 'standing' && !options.hitCounts
        ? `<text x="${x}" y="${y + 4}" text-anchor="middle"
             font-size="10" font-weight="500"
             fill="rgba(255,255,255,0.55)" font-family="Inter,sans-serif"
             pointer-events="none">${pos + 1}</text>`
        : ''}
    `);
  }

  return `<svg viewBox="0 0 ${svgWidth} ${svgHeight}"
    width="${svgWidth}" height="${svgHeight}"
    xmlns="http://www.w3.org/2000/svg"
    style="overflow:visible; display:block;">${elements.join('')}</svg>`;
}

/** Convenience: derive cup count from array length. */
export function cupCountFromArray(cups) {
  return cups.length > 6 ? 10 : 6;
}
