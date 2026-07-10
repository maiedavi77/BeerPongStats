/**
 * src/ui/components/rerack-sheet.js
 *
 * Re-rack bottom sheet (v1 flow — no route change, cancel is free).
 *
 * Formation library ported verbatim from V2_rerack_reference.html,
 * including line-cup ("middle lane") formations. Line cups are persisted
 * as rack_position codes >= 100 (see LINE_SLOTS in the engine).
 *
 * Confirmed rules:
 *   - Formations exist only for <=6 standing (10-cup) / <=5 (6-cup).
 *   - One re-rack per rack per game; cancel does NOT consume it.
 *   - Tip-row rule: every formation keeps >=1 cup in the tip row.
 */

import { lineSlotCode }           from '../../game-engine.js';
import { renderFormationPreview } from './cup-rack.js';

// ─── Formation library (V2_rerack_reference.html) ───────────────────────────

export const FORMATIONS = {
  10: {
    6: [
      { name: 'Pyramide',    slots: [0, 1, 2, 4, 5, 7] },
      { name: 'Pyramide',    slots: [1, 2, 3, 5, 6, 8] },
      { name: 'Skulptur', slots: [1, 2, 5, 7, 8, 9] },
    ],
    5: [
      { name: 'Trapez', slots: [1, 2, 4, 5, 7] },
      { name: 'Trapez', slots: [1, 2, 5, 6, 8] },
      { name: 'Trapez', slots: [0, 1, 4, 5, 7] },
      { name: 'Trapez', slots: [2, 3, 5, 6, 8] },
      { name: 'Mehnerskolben', slots: [1, 2, 5, 9], lineCups: [{ x: 1.5, y: 2 }] },
    ],
    4: [
      { name: 'Raute',  slots: [0, 1, 4, 5] },
      { name: 'Raute',  slots: [2, 3, 5, 6] },
      { name: 'stehende Raute', slots: [1, 4, 5, 7] },
      { name: 'stehende Raute', slots: [2, 5, 6, 8] },
      { name: 'Straße', slots: [5, 9], lineCups: [{ x: 1.5, y: 0 }, { x: 1.5, y: 2 }] },
      { name: 'P....', slots: [1, 2, 5], lineCups: [ { x: 1.5, y: 2 } ] },
    ],
    3: [
      { name: 'Dreieck', slots: [0, 1, 4] },
      { name: 'Dreieck',   slots: [1, 2, 5] },
      { name: 'Dreieck',   slots: [2, 3, 6] },
      { name: 'rumgedrehtes Dreieck',   slots: [1, 4, 5] },
      { name: 'rumgedrehtes Dreieck',   slots: [2, 5, 6] },
      { name: 'Ampel', slots: [5], lineCups: [{ x: 1.5, y: 0 }, { x: 1.5, y: 2 }] },
    ],
    2: [
      { name: 'Fußgängerampel', slots: [5], lineCups: [{ x: 1.5, y: 0 }] },
    ],
    1: [
      { name: 'Links', slots: [0] },
      { name: 'Mitte Links', slots: [1] },
      { name: 'Mitte Rechts', slots: [2] },
      { name: 'Rechts', slots: [3] },
    ],
  },
  6: {
    4: [
      { name: 'stehende Raute',     slots: [1, 3, 4, 5] },
      { name: 'liegende Raute', slots: [0, 1, 3, 4] },
      { name: 'liegende Raute', slots: [1, 2, 3, 4] },
    ],
    3: [
      { name: 'Dreieck',  slots: [0, 1, 3] },
      { name: 'Dreieck',  slots: [1, 2, 4] },
      { name: 'rumgedrehtes Dreieck', slots: [1, 3, 4] },
      { name: 'Ampel', slots: [1, 5], lineCups: [{ x: 1, y: 1 }] },
    ],
    2: [
      { name: 'Fußgängerampel', slots: [1], lineCups: [{ x: 1, y: 1 }] },
    ],
    1: [
      { name: 'Links', slots: [0] },
      { name: 'Mitte', slots: [1] },
      { name: 'Rechts', slots: [2] },
    ],
  },
};

/** True when formations exist for this standing count. */
export function hasFormations(cupCount, standing) {
  return (FORMATIONS[cupCount]?.[standing] ?? []).length > 0;
}

/** Flatten a formation into rack_position values (standard slots + line codes). */
export function formationPositions(formation, cupCount) {
  const positions = [...(formation.slots ?? [])];
  for (const lc of formation.lineCups ?? []) {
    const code = lineSlotCode(cupCount, lc);
    if (code == null) throw new Error(`No line slot code for (${lc.x},${lc.y}) in ${cupCount}-cup`);
    positions.push(code);
  }
  return positions;
}

// ─── Sheet ──────────────────────────────────────────────────────────────────

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Open the re-rack sheet.
 *
 * @param {object} opts
 * @param {'A'|'B'} opts.team       rack owner (defending team)
 * @param {string}  opts.teamLabel
 * @param {number}  opts.cupCount   6 | 10
 * @param {number}  opts.standing   standing cup count
 * @param {(formation: object, positions: number[]) => Promise<boolean>} opts.onConfirm
 *   returns true on success (sheet closes), false to keep it open
 */
export function openRerackSheet({ team, teamLabel, cupCount, standing, onConfirm }) {
  const formations = FORMATIONS[cupCount]?.[standing] ?? [];
  if (!formations.length) return;

  const col = team === 'A' ? 'var(--red)' : 'var(--blue)';
  const tipRange = cupCount === 10 ? '0–3' : '0–2';

  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <h2 style="color:${col};">Re-rack — ${esc(teamLabel)}</h2>
      <p style="font-size:12.5px; color:var(--text-dim); margin:0 0 14px; line-height:1.5;">
        ${standing} cup${standing === 1 ? '' : 's'} remaining. Pick a formation — this uses
        ${esc(teamLabel)}'s one re-rack for the game.
      </p>
      <div class="rerack-formations">
        ${formations.map((f, i) => `
          <div class="formation-card" data-fi="${i}">
            <div class="formation-name">${esc(f.name)}</div>
            <div class="formation-preview">${renderFormationPreview(f, cupCount, team)}</div>
          </div>`).join('')}
      </div>
      <button class="btn btn-primary btn-block" id="rr-confirm" disabled>Confirm re-rack</button>
      <button class="btn btn-ghost btn-block" style="margin-top:8px;" id="rr-cancel">Cancel</button>
      <p class="rerack-note">
        Tip-row rule: at least one cup stays in the tip row (slots ${tipRange}).
        Line formations place cups between rows. Cancelling keeps your re-rack.
      </p>
    </div>`;
  document.body.appendChild(bd);

  let selFi = null;
  bd.querySelectorAll('.formation-card').forEach(card => {
    card.addEventListener('click', () => {
      bd.querySelectorAll('.formation-card').forEach(x => x.classList.remove('sel'));
      card.classList.add('sel');
      selFi = Number(card.dataset.fi);
      bd.querySelector('#rr-confirm').disabled = false;
    });
  });

  const close = () => bd.remove();
  bd.querySelector('#rr-cancel').addEventListener('click', close);
  bd.addEventListener('click', e => { if (e.target === bd) close(); });

  bd.querySelector('#rr-confirm').addEventListener('click', async () => {
    if (selFi === null) return;
    const btn = bd.querySelector('#rr-confirm');
    btn.disabled = true;
    btn.textContent = 'Applying…';
    const formation = formations[selFi];
    const ok = await onConfirm(formation, formationPositions(formation, cupCount));
    if (ok) close();
    else { btn.disabled = false; btn.textContent = 'Confirm re-rack'; }
  });
}
