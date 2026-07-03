/**
 * src/ui/components/cup-rack.js
 *
 * SVG cup rack renderer.
 *
 * Geometry ported from V2_rerack_reference.html (trapezoid cups, staggered
 * touching rows), scaled up for tap targets, extended with line-cup slots
 * (rack_position >= 100 — see LINE_SLOTS in the engine).
 *
 * Rendering is POSITIONAL (v1 model): all standard grid slots are always
 * drawn; a slot is "active" when a standing cup occupies it and a tipped
 * ghost otherwise. Cup states:
 *   active     — solid gradient, tappable
 *   ghost      — faded outline (hit / empty slot)
 *   pending    — hit by ball 1 this pair: stays solid with amber pulse ring
 *   bonus-sel  — selected for bonus removal: green ring + check badge
 */

import { LINE_SLOTS } from '../../game-engine.js';

// ─── Geometry (reference × 2 for tap targets) ───────────────────────────────
const CUP_W   = 36;
const CUP_H   = 28;
const CUP_BOT = 20;
const CELL    = 52;
const PAD     = 12;

export const GRID10 = {
  0: { x: 0,   y: 0 }, 1: { x: 1,   y: 0 }, 2: { x: 2,   y: 0 }, 3: { x: 3, y: 0 },
  4: { x: 0.5, y: 1 }, 5: { x: 1.5, y: 1 }, 6: { x: 2.5, y: 1 },
  7: { x: 1,   y: 2 }, 8: { x: 2,   y: 2 },
  9: { x: 1.5, y: 3 },
};

export const GRID6 = {
  0: { x: 0,   y: 0 }, 1: { x: 1, y: 0 }, 2: { x: 2, y: 0 },
  3: { x: 0.5, y: 1 }, 4: { x: 1.5, y: 1 },
  5: { x: 1,   y: 2 },
};

export const ALL_SLOTS_10 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export const ALL_SLOTS_6  = [0, 1, 2, 3, 4, 5];

export function gridFor(cupCount)  { return cupCount === 6 ? GRID6 : GRID10; }
export function slotsFor(cupCount) { return cupCount === 6 ? ALL_SLOTS_6 : ALL_SLOTS_10; }

/** Resolve a rack_position (standard or line code) to grid coordinates. */
export function positionCoords(cupCount, rackPosition) {
  if (rackPosition >= 100) return LINE_SLOTS[cupCount]?.[rackPosition] ?? null;
  return gridFor(cupCount)[rackPosition] ?? null;
}

// Line cups sit exactly between the two grid rows they connect.
function yToPx(gy, scale = 1) {
  const cell = CELL * scale;
  if (Number.isInteger(gy)) return gy * cell;
  return ((Math.floor(gy) + Math.ceil(gy)) / 2) * cell;
}

function cupPolygon(cx, cy, scale = 1) {
  const hw = (CUP_W / 2) * scale;
  const hb = (CUP_BOT / 2) * scale;
  const t = cy - (CUP_H / 2) * scale;
  const b = cy + (CUP_H / 2) * scale;
  return `${cx - hw},${t} ${cx + hw},${t} ${cx + hb},${b} ${cx - hb},${b}`;
}

let _uid = 0;

/**
 * Render a rack.
 *
 * @param {Array}  cups    cup rows: { id, team, rack_position, status }
 * @param {object} options
 * @param {number}   options.cupCount        6 | 10
 * @param {boolean}  options.interactive     add data-cup-id targets
 * @param {string[]} options.pendingCupIds   ball-1 hits this pair (stay solid)
 * @param {string[]} options.bonusSelected   cup ids selected for bonus removal
 * @param {number}   options.scale           render scale (1 = live game)
 */
export function renderRack(cups, options = {}) {
  const {
    cupCount = 10,
    interactive = false,
    pendingCupIds = [],
    bonusSelected = [],
    scale = 1,
  } = options;

  const grid  = gridFor(cupCount);
  const slots = slotsFor(cupCount);
  const cell  = CELL * scale;
  const pad   = PAD * scale;

  const team  = cups[0]?.team ?? 'B';
  const isRed = team === 'A';
  const gid   = `rk${_uid++}`;

  const pendingSet = new Set(pendingCupIds);
  const bonusSet   = new Set(bonusSelected);

  const xs = slots.map(s => grid[s].x);
  const ys = slots.map(s => grid[s].y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const svgW = (maxX - minX) * cell + CUP_W * scale + pad * 2;
  const svgH = (maxY - minY) * cell + CUP_H * scale + pad * 2;

  const toXY = (gx, gy) => ({
    cx: pad + (CUP_W / 2) * scale + (gx - minX) * cell,
    cy: pad + (CUP_H / 2) * scale + yToPx(gy, scale) - yToPx(minY, scale),
  });

  const grad   = isRed ? `url(#${gid}-red)` : `url(#${gid}-blue)`;
  const stroke = isRed ? '#C43020' : '#2A6A9E';
  const ghostFill   = isRed ? 'rgba(226,64,45,0.09)'  : 'rgba(61,134,198,0.09)';
  const ghostStroke = isRed ? 'rgba(226,64,45,0.18)'  : 'rgba(61,134,198,0.18)';

  // Standing cups by position (pending cups are still status 'standing')
  const standingAt = new Map();
  cups.forEach(c => { if (c.status === 'standing') standingAt.set(c.rack_position, c); });

  let shapes = '';

  function drawCup(cup, gx, gy) {
    const { cx, cy } = toXY(gx, gy);
    const pts = cupPolygon(cx, cy, scale);
    const isPending = pendingSet.has(cup.id);
    const isBonus   = bonusSet.has(cup.id);
    const cls = ['cupg', isPending ? 'pending' : '', isBonus ? 'bonus-sel' : ''].filter(Boolean).join(' ');
    const attrs = interactive
      ? ` data-cup-id="${cup.id}" data-team="${cup.team}" data-pos="${cup.rack_position}" role="button" tabindex="0"`
      : '';
    let inner = `<polygon points="${pts}" fill="${grad}" stroke="${stroke}" stroke-width="1"/>`;
    if (isBonus) {
      const bx = cx + (CUP_W / 2) * scale - 3 * scale;
      const by = cy - (CUP_H / 2) * scale + 3 * scale;
      inner += `<circle cx="${bx}" cy="${by}" r="${8 * scale}" fill="#74B687"/>` +
               `<text x="${bx}" y="${by + 3.4 * scale}" text-anchor="middle" font-size="${10 * scale}" ` +
               `font-weight="700" fill="#0E2417" font-family="Inter,sans-serif">✓</text>`;
    }
    shapes += `<g class="${cls}"${attrs}>${inner}</g>`;
  }

  // 1. Ghost slots (standard grid positions with no standing cup)
  slots.forEach(slot => {
    if (!standingAt.has(slot)) {
      const { cx, cy } = toXY(grid[slot].x, grid[slot].y);
      shapes += `<polygon points="${cupPolygon(cx, cy, scale)}" fill="${ghostFill}" stroke="${ghostStroke}" stroke-width="1"/>`;
    }
  });

  // 2. Standing cups — standard slots then line slots
  cups.forEach(cup => {
    if (cup.status !== 'standing') return;
    const coords = positionCoords(cupCount, cup.rack_position);
    if (!coords) return;
    drawCup(cup, coords.x, coords.y);
  });

  return `<svg width="${Math.ceil(svgW)}" height="${Math.ceil(svgH)}" viewBox="0 0 ${Math.ceil(svgW)} ${Math.ceil(svgH)}"
    xmlns="http://www.w3.org/2000/svg" style="display:block; overflow:visible;">
    <defs>
      <linearGradient id="${gid}-red" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#F2604B"/><stop offset="100%" stop-color="#C43020"/>
      </linearGradient>
      <linearGradient id="${gid}-blue" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5AA3DE"/><stop offset="100%" stop-color="#2A6A9E"/>
      </linearGradient>
    </defs>
    ${shapes}
  </svg>`;
}

/**
 * Render a small formation preview (for the re-rack sheet).
 * @param {object} formation { slots: number[], lineCups?: {x,y}[] }
 */
export function renderFormationPreview(formation, cupCount, team) {
  const grid  = gridFor(cupCount);
  const slots = slotsFor(cupCount);
  const isRed = team === 'A';
  const gid   = `fp${_uid++}`;
  const scale = 0.5;
  const cell  = CELL * scale;
  const pad   = PAD * scale;

  const xs = slots.map(s => grid[s].x);
  const ys = slots.map(s => grid[s].y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const svgW = (maxX - minX) * cell + CUP_W * scale + pad * 2;
  const svgH = (maxY - minY) * cell + CUP_H * scale + pad * 2;

  const toXY = (gx, gy) => ({
    cx: pad + (CUP_W / 2) * scale + (gx - minX) * cell,
    cy: pad + (CUP_H / 2) * scale + yToPx(gy, scale) - yToPx(minY, scale),
  });

  const grad   = isRed ? `url(#${gid}-r)` : `url(#${gid}-b)`;
  const stroke = isRed ? '#C43020' : '#2A6A9E';
  const ghostFill   = isRed ? 'rgba(226,64,45,0.09)' : 'rgba(61,134,198,0.09)';
  const ghostStroke = isRed ? 'rgba(226,64,45,0.16)' : 'rgba(61,134,198,0.16)';

  const active = new Set(formation.slots ?? []);
  let shapes = '';

  slots.forEach(slot => {
    if (!active.has(slot)) {
      const { cx, cy } = toXY(grid[slot].x, grid[slot].y);
      shapes += `<polygon points="${cupPolygon(cx, cy, scale)}" fill="${ghostFill}" stroke="${ghostStroke}" stroke-width="1"/>`;
    }
  });
  slots.forEach(slot => {
    if (active.has(slot)) {
      const { cx, cy } = toXY(grid[slot].x, grid[slot].y);
      shapes += `<polygon points="${cupPolygon(cx, cy, scale)}" fill="${grad}" stroke="${stroke}" stroke-width="1"/>`;
    }
  });
  (formation.lineCups ?? []).forEach(lc => {
    const { cx, cy } = toXY(lc.x, lc.y);
    shapes += `<polygon points="${cupPolygon(cx, cy, scale)}" fill="${grad}" stroke="${stroke}" stroke-width="1"/>`;
  });

  return `<svg width="${Math.ceil(svgW)}" height="${Math.ceil(svgH)}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs>
      <linearGradient id="${gid}-r" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#F2604B"/><stop offset="100%" stop-color="#C43020"/>
      </linearGradient>
      <linearGradient id="${gid}-b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5AA3DE"/><stop offset="100%" stop-color="#2A6A9E"/>
      </linearGradient>
    </defs>
    ${shapes}
  </svg>`;
}
