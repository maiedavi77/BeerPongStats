/**
 * src/ui/components/heatmap.js
 *
 * Cup-position hit heatmap renderer.
 *
 * Accepts throws loaded with an embedded throw_cups join:
 *   throws[n].throw_cups = [{ cup_id: "..." }]   (from Supabase embedded select)
 *
 * Pairs each hit throw's cup_id to a cup's rack_position to build
 * a frequency map, then renders an SVG coloured by hit density.
 */

const CUP_RADIUS = 18;
const CUP_SPACING = 44;

const LAYOUTS = {
  10: [
    [0],
    [1, 2],
    [3, 4, 5],
    [6, 7, 8, 9],
  ],
  6: [
    [0],
    [1, 2],
    [3, 4, 5],
  ],
};

/**
 * Build a Map<rack_position, hitCount> from throw + cup data.
 *
 * @param {object[]} throws - throw rows; each row may have .throw_cups[].cup_id
 * @param {object[]} cups   - cup rows with .id and .rack_position
 * @returns {Map<number, number>}
 */
function buildHitMap(throws, cups) {
  // cup.id → rack_position lookup
  const cupPosMap = new Map(cups.map(c => [c.id, c.rack_position]));
  const hitMap = new Map();

  for (const t of throws) {
    if (t.outcome !== 'hit') continue;

    // Support two data shapes:
    //   1. t.throw_cups = [{ cup_id }]  ← from JOIN (correct)
    //   2. t.cup_id                      ← legacy / in-memory (fallback)
    const cupIds = [];
    if (Array.isArray(t.throw_cups) && t.throw_cups.length > 0) {
      cupIds.push(...t.throw_cups.map(tc => tc.cup_id));
    } else if (t.cup_id) {
      cupIds.push(t.cup_id);
    }

    for (const cupId of cupIds) {
      const pos = cupPosMap.get(cupId);
      if (pos != null) {
        hitMap.set(pos, (hitMap.get(pos) ?? 0) + 1);
      }
    }
  }

  return hitMap;
}

/**
 * Render a cup-position heatmap as an SVG string.
 *
 * @param {object[]} throws   - throw rows (with throw_cups embedded join or cup_id)
 * @param {object[]} cups     - cup rows with id + rack_position
 * @param {6|10}     cupCount - layout to use (6 or 10 cups)
 * @returns {string} SVG markup ready to drop into innerHTML
 */
export function renderHeatmap(throws, cups, cupCount) {
  const layout = LAYOUTS[cupCount] ?? LAYOUTS[10];
  const hitMap = buildHitMap(throws, cups);
  const maxHits = hitMap.size > 0 ? Math.max(...hitMap.values()) : 1;

  const maxCols = layout[layout.length - 1].length;
  const svgW = maxCols * CUP_SPACING + 10;
  const svgH = layout.length * CUP_SPACING + 10;

  const circles = [];

  layout.forEach((row, rowIdx) => {
    const rowCols = row.length;
    const offsetX = ((maxCols - rowCols) / 2) * CUP_SPACING;

    row.forEach((pos, colIdx) => {
      const cx = offsetX + colIdx * CUP_SPACING + CUP_SPACING / 2;
      const cy = rowIdx * CUP_SPACING + CUP_SPACING / 2;
      const hits = hitMap.get(pos) ?? 0;
      const intensity = maxHits > 0 ? hits / maxHits : 0;

      // Interpolate: cold blue (#3D86C6) → hot red (#E2402D)
      const r = Math.round(61  + (226 - 61)  * intensity);
      const g = Math.round(134 + (64  - 134) * intensity);
      const b = Math.round(198 + (45  - 198) * intensity);
      const fill = `rgb(${r},${g},${b})`;

      circles.push(`
        <circle cx="${cx}" cy="${cy}" r="${CUP_RADIUS}"
          fill="${fill}" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" />
        ${hits > 0
          ? `<text x="${cx}" y="${cy + 4}" text-anchor="middle"
               font-size="10" font-family="Inter,sans-serif"
               fill="rgba(255,255,255,0.9)">${hits}</text>`
          : ''}
      `);
    });
  });

  return `<svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}"
    xmlns="http://www.w3.org/2000/svg" style="overflow:visible;"
    aria-label="${cupCount}-cup heatmap">
    ${circles.join('')}
  </svg>`;
}
