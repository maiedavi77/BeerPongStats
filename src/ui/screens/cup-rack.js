/**
 * src/ui/components/cup-rack.js
 *
 * SVG cup rack renderer for 6-cup and 10-cup layouts.
 * Renders cups in the classic beer pong triangle arrangement.
 *
 * 10-cup layout (rack_position → row,col):
 *   Row 0 (tip):  pos 0
 *   Row 1:        pos 1, 2
 *   Row 2:        pos 3, 4, 5
 *   Row 3 (back): pos 6, 7, 8, 9
 *
 * 6-cup layout:
 *   Row 0 (tip):  pos 0
 *   Row 1:        pos 1, 2
 *   Row 2 (back): pos 3, 4, 5
 */

const CUP_RADIUS = 22;
const CUP_SPACING = 52;

const LAYOUTS = {
  10: [
    [{ pos: 0 }],
    [{ pos: 1 }, { pos: 2 }],
    [{ pos: 3 }, { pos: 4 }, { pos: 5 }],
    [{ pos: 6 }, { pos: 7 }, { pos: 8 }, { pos: 9 }],
  ],
  6: [
    [{ pos: 0 }],
    [{ pos: 1 }, { pos: 2 }],
    [{ pos: 3 }, { pos: 4 }, { pos: 5 }],
  ],
};

/**
 * Compute pixel coordinates for a rack layout.
 * @param {number} cupCount - 6 or 10
 * @returns {{ pos: number, x: number, y: number }[]}
 */
function computePositions(cupCount) {
  const rows = LAYOUTS[cupCount] ?? LAYOUTS[10];
  const maxCols = rows[rows.length - 1].length;
  const width = maxCols * CUP_SPACING;
  const result = [];

  rows.forEach((row, rowIdx) => {
    const rowWidth = row.length * CUP_SPACING;
    const offsetX = (width - rowWidth) / 2;
    row.forEach((cup, colIdx) => {
      result.push({
        pos: cup.pos,
        x: offsetX + colIdx * CUP_SPACING + CUP_SPACING / 2,
        y: rowIdx * CUP_SPACING + CUP_SPACING / 2,
      });
    });
  });

  return result;
}

/**
 * Render a cup rack as an SVG string.
 *
 * @param {object[]} cups     - cups array from game state
 * @param {object}   options
 * @param {boolean}  [options.interactive] - add data-cup-id for click handling
 * @param {number}   [options.heatmap]     - if provided, color by hit count (0..heatmap)
 * @param {Map}      [options.hitCounts]   - Map<rack_position, count> for heatmap
 * @returns {string} SVG markup (without wrapping <svg> tag — caller provides container)
 */
export function renderRack(cups, options = {}) {
  const cupCount = cups.length > 6 ? 10 : 6;
  const positions = computePositions(cupCount);
  const maxCols = (LAYOUTS[cupCount] ?? LAYOUTS[10]).at(-1).length;
  const svgWidth = maxCols * CUP_SPACING + 10;
  const svgHeight = (LAYOUTS[cupCount] ?? LAYOUTS[10]).length * CUP_SPACING + 10;

  // Build a map from rack_position → cup
  const cupMap = new Map(cups.map(c => [c.rack_position, c]));

  const circles = positions.map(({ pos, x, y }) => {
    const cup = cupMap.get(pos);
    if (!cup) return ''; // position unused (after penalty cup removal)

    let fill, stroke, opacity = '1';

    if (cup.status === 'hit') {
      fill = 'var(--surface-3)';
      stroke = 'var(--surface-2)';
      opacity = '0.35';
    } else if (options.heatmap && options.hitCounts) {
      const count = options.hitCounts.get(pos) ?? 0;
      const intensity = options.heatmap > 0 ? count / options.heatmap : 0;
      // Interpolate from blue to red
      const r = Math.round(61 + (225 - 61) * intensity);
      const g = Math.round(134 + (64 - 134) * intensity);
      const b = Math.round(198 + (45 - 198) * intensity);
      fill = `rgb(${r},${g},${b})`;
      stroke = 'var(--surface-3)';
    } else {
      fill = 'var(--blue)';
      stroke = 'var(--surface-3)';
    }

    const attrs = options.interactive && cup.status === 'standing'
      ? `data-cup-id="${cup.id}" data-rack-pos="${pos}" style="cursor:pointer;"`
      : '';

    return `
      <circle
        cx="${x}" cy="${y}" r="${CUP_RADIUS}"
        fill="${fill}" stroke="${stroke}" stroke-width="2"
        opacity="${opacity}" ${attrs}
      />
      ${cup.status === 'standing' && !options.heatmap ? `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="11" fill="rgba(255,255,255,0.5)" font-family="Inter,sans-serif">${pos + 1}</text>` : ''}
    `;
  }).join('');

  return `<svg viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}"
    xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">${circles}</svg>`;
}

/**
 * Get the cup count implied by a cups array.
 */
export function cupCountFromArray(cups) {
  return cups.length > 6 ? 10 : 6;
}
