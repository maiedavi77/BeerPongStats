/**
 * src/game-engine.js 
 *
 * Pure beer pong game state machine — RACKED rules implementation.
 *
 * Turn flow:
 *   throw1 → throw2 → resolve → (bonus?) → finalizePair → throw1 (next team or same if balls-back)
 *
 * BONUS RULES (critical):
 * - Same cup hit by both balls: +2 bonus removals
 * - Each dodge hit: +1 bonus removal
 * - Two balls in same cup WITH one dodge: +3 bonus removals (2+1)
 * - Two balls in same cup WITH two dodges: +4 bonus removals (2+2)
 * - Two balls in different cups: balls back (same team throws again)
 * - Dodge flag must be armed BEFORE tapping the cup
 *
 * Balls back: BOTH players hit ANY cups → same team throws again.
 * Bonus phase: attacking team taps cups on defending rack to select bonus removals.
 */

const MAX_UNDO = 20;

// ─── State factory ────────────────────────────────────────────────────────

export function buildGameState(gameRow, cups, participants, throws = []) {
  const cupCount = gameRow.cup_count;
  const cupsA = cups.filter(c => c.team === 'A').sort((a, b) => a.rack_position - b.rack_position);
  const cupsB = cups.filter(c => c.team === 'B').sort((a, b) => a.rack_position - b.rack_position);
  const partA = participants.filter(p => p.team === 'A').sort((a, b) => a.throw_order - b.throw_order);
  const partB = participants.filter(p => p.team === 'B').sort((a, b) => a.throw_order - b.throw_order);

  return {
    id:           gameRow.id,
    cupCount,
    status:       gameRow.status       ?? 'active',
    throwingTeam: gameRow.throwing_team ?? 'A',
    phase:        'throw1',  // 'throw1' | 'throw2' | 'bonus'
    cups:         { A: cupsA, B: cupsB },
    participants: { A: partA, B: partB },
    currentThrowerIdx: { A: 0, B: 0 },
    pendingPair:  { throws: [] },
    allThrows:    throws,
    undoStack:    [],
    winner:       gameRow.winner_team ?? null,
    // Bonus-phase fields (set by _resolvePair)
    _targetTeam:   gameRow.throwing_team === 'A' ? 'B' : 'A',
    _bothHit:      false,
    bonusRequired: 0,
    bonusSelected: [],  // cup IDs selected for bonus removal
    dodgeCount:    0,
    sameCupHit:    false,
  };
}

// ─── Undo ─────────────────────────────────────────────────────────────────

function snapshot(g) {
  const snap = structuredClone(g);
  snap.undoStack = [];
  g.undoStack.push(JSON.stringify(snap));
  if (g.undoStack.length > MAX_UNDO) g.undoStack.shift();
}

export function doUndo(g) {
  if (g.undoStack.length === 0) return g;
  const prev = JSON.parse(g.undoStack.pop());
  prev.undoStack = g.undoStack;
  return prev;
}

// ─── logThrow ─────────────────────────────────────────────────────────────

/**
 * Record a throw and advance the game phase.
 *
 * @param {object}  g          - game state (mutated in place)
 * @param {'hit'|'miss'|'airball'} outcome
 * @param {string|null} cupId  - DB cup id; required when outcome === 'hit'
 * @param {string}  throwerId  - participant user_id
 * @param {boolean} [isDodge]  - true when outcome==='hit' and dodge was armed
 */
export function logThrow(g, outcome, cupId, throwerId, isDodge = false) {
  if (g.status !== 'active') throw new Error('Game is not active');
  if (g.phase !== 'throw1' && g.phase !== 'throw2') throw new Error('Not in throw phase');

  snapshot(g);

  const throwRecord = {
    id:            `throw-${g.allThrows.length + 1}`,
    game_id:       g.id,
    sequence_no:   g.allThrows.length + 1,
    throwing_team: g.throwingTeam,
    thrower_user_id: throwerId,
    outcome,
    cup_id:   cupId ?? null,
    isDodge:  outcome === 'hit' ? isDodge : false,
    created_at: new Date().toISOString(),
  };

  g.pendingPair.throws.push(throwRecord);
  g.allThrows.push(throwRecord);

  if (g.phase === 'throw1') {
    g.phase = 'throw2';
    _advanceThrower(g, g.throwingTeam);
  } else {
    _resolvePair(g);
  }

  return g;
}

// ─── Bonus phase ──────────────────────────────────────────────────────────

/**
 * Toggle a defending cup into / out of the bonus-removal selection.
 * Returns false (and does nothing) if selection is already full.
 */
export function selectBonusCup(g, cupId) {
  const idx = g.bonusSelected.indexOf(cupId);
  if (idx >= 0) {
    g.bonusSelected.splice(idx, 1);
    return true;
  }
  if (g.bonusSelected.length >= g.bonusRequired) return false;
  g.bonusSelected.push(cupId);
  return true;
}

/**
 * Confirm bonus cup removal.
 * Marks selected cups as hit in state, then finalizes the pair.
 * Returns the removed cup IDs on success, or null if selection not complete.
 */
export function confirmBonusRemoval(g) {
  if (g.bonusSelected.length !== g.bonusRequired) return null;
  snapshot(g);

  const removedIds = [...g.bonusSelected];
  for (const cupId of removedIds) {
    const cup = g.cups[g._targetTeam].find(c => c.id === cupId);
    if (cup) cup.status = 'hit';
  }
  g.bonusSelected = [];
  g.bonusRequired = 0;

  _checkGameOver(g);
  if (g.status === 'complete') return removedIds;

  _finalizePair(g);
  return removedIds;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function _resolvePair(g) {
  const t1  = g.pendingPair.throws[0];
  const t2  = g.pendingPair.throws[1];
  const tgt = g.throwingTeam === 'A' ? 'B' : 'A';
  g._targetTeam = tgt;

  // Collect unique cup IDs that were hit (deduplicate same-cup hits)
  const hitIds = [];
  if (t1.outcome === 'hit' && t1.cup_id) hitIds.push(t1.cup_id);
  if (t2.outcome === 'hit' && t2.cup_id) hitIds.push(t2.cup_id);
  const uniqueHitIds = [...new Set(hitIds)];

  // Remove hit cups from in-memory state
  for (const cupId of uniqueHitIds) {
    _markCupHit(g, cupId);
  }

  // Game over check (before bonus)
  _checkGameOver(g);
  if (g.status === 'complete') return;

  // BONUS CALCULATION - RACKED RULES:
  const bothHit    = t1.outcome === 'hit' && t2.outcome === 'hit';
  const sameCup    = bothHit && t1.cup_id && t1.cup_id === t2.cup_id;
  const dodgeCount = (t1.isDodge ? 1 : 0) + (t2.isDodge ? 1 : 0);

  // Bonus cups = dodge hits + (2 if same cup hit by both)
  // Examples:
  // - Both hit same cup, no dodge: 0 + 2 = 2 bonus cups
  // - Both hit same cup, 1 dodge: 1 + 2 = 3 bonus cups
  // - Both hit same cup, 2 dodges: 2 + 2 = 4 bonus cups
  // - Both hit different cups, 1 dodge: 1 + 0 = 1 bonus cup
  const bonusCount = dodgeCount + (sameCup ? 2 : 0);

  g._bothHit   = bothHit;   // both hit ANY cups → balls back
  g.dodgeCount = dodgeCount;
  g.sameCupHit = sameCup;

  const remaining = standingCups(g, tgt);

  if (bonusCount > 0 && remaining > 0) {
    g.phase        = 'bonus';
    g.bonusRequired = Math.min(bonusCount, remaining);
    g.bonusSelected = [];
  } else {
    _finalizePair(g);
  }
}

function _finalizePair(g) {
  g.pendingPair   = { throws: [] };
  g.bonusRequired = 0;
  g.bonusSelected = [];

  if (g._bothHit) {
    // Balls back — same team throws again, reset to first thrower
    g.phase = 'throw1';
    g.currentThrowerIdx[g.throwingTeam] = 0;
  } else {
    g.throwingTeam = g.throwingTeam === 'A' ? 'B' : 'A';
    g.phase        = 'throw1';
    g.currentThrowerIdx[g.throwingTeam] = 0;
  }
}

function _markCupHit(g, cupId) {
  for (const team of ['A', 'B']) {
    const cup = g.cups[team].find(c => c.id === cupId);
    if (cup) { cup.status = 'hit'; return; }
  }
}

function _checkGameOver(g) {
  const tgt = g.throwingTeam === 'A' ? 'B' : 'A';
  if (standingCups(g, tgt) === 0) {
    g.status = 'complete';
    g.winner = g.throwingTeam;
  }
}

function _advanceThrower(g, team) {
  const parts = g.participants[team];
  if (!parts || parts.length <= 1) return;
  g.currentThrowerIdx[team] = (g.currentThrowerIdx[team] + 1) % parts.length;
}

// ─── Public helpers ───────────────────────────────────────────────────────

export function currentThrower(g, team = g.throwingTeam) {
  const parts = g.participants[team];
  if (!parts?.length) return null;
  return parts[g.currentThrowerIdx[team]] ?? parts[0];
}

export function standingCups(g, team) {
  return g.cups[team].filter(c => c.status === 'standing').length;
}
