/**
 * src/game-engine.js
 *
 * Pure beer pong game state machine.
 * NO Supabase calls, NO DOM access.
 */

const RERACK_TRIGGERS = {
  10: new Set([6, 5, 4, 3, 2, 1]),
  6:  new Set([5, 4, 3, 2, 1]),
};

const MAX_UNDO = 20;

// ─── State factory ────────────────────────────────────────────────────────

export function buildGameState(gameRow, cups, participants, throws = []) {
  const cupCount = gameRow.cup_count;
  const cupsA = cups.filter(c => c.team === 'A').sort((a, b) => a.rack_position - b.rack_position);
  const cupsB = cups.filter(c => c.team === 'B').sort((a, b) => a.rack_position - b.rack_position);
  const partA = participants.filter(p => p.team === 'A').sort((a, b) => a.throw_order - b.throw_order);
  const partB = participants.filter(p => p.team === 'B').sort((a, b) => a.throw_order - b.throw_order);

  return {
    id: gameRow.id,
    cupCount,
    status: gameRow.status ?? 'active',
    throwingTeam: gameRow.throwing_team ?? 'A',
    phase: 'throw1',
    bonusThrowsLeft: 0,
    cups: { A: cupsA, B: cupsB },
    participants: { A: partA, B: partB },
    currentThrowerIdx: { A: 0, B: 0 },
    // pendingPair tracks the two throws of a normal turn
    pendingPair: { throws: [], throwers: [] },
    allThrows: throws,
    undoStack: [],
    winner: gameRow.winner_team ?? null,
    ballsBack: false,
    // lastDodgeBy: tracks consecutive dodges by the same player within the SAME team turn
    lastDodgeBy: null,
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
 * Log a throw and advance game phase.
 * @param {GameState} g
 * @param {'hit'|'miss'|'airball'|'dodge'} outcome
 * @param {string|null} cupId  - required when outcome === 'hit'
 * @param {string} throwerId  - participant id
 * @returns {GameState}
 */
export function logThrow(g, outcome, cupId, throwerId) {
  if (g.status !== 'active') throw new Error('Game is not active');

  snapshot(g);

  const throwRecord = {
    id: `throw-${g.allThrows.length + 1}`,
    game_id: g.id,
    sequence_no: g.allThrows.length + 1,
    throwing_team: g.throwingTeam,
    thrower_user_id: throwerId,
    outcome,
    cup_id: cupId ?? null,
    created_at: new Date().toISOString(),
  };

  g.pendingPair.throws.push(throwRecord);
  g.pendingPair.throwers.push(throwerId);
  g.allThrows.push(throwRecord);

  if (outcome === 'hit') {
    _markCupHit(g, cupId);
  } else if (outcome === 'dodge') {
    _applyDodgePenalty(g, throwerId);
  }

  // Phase transitions
  if (g.phase === 'throw1') {
    g.phase = 'throw2';
    _advanceThrower(g, g.throwingTeam);

  } else if (g.phase === 'throw2') {
    _resolvePair(g);

  } else if (g.phase === 'bonus') {
    // Each bonus throw is individual
    g.bonusThrowsLeft--;
    if (outcome === 'hit') {
      _checkGameOver(g);
    }
    if (g.status === 'complete') return g;
    if (g.bonusThrowsLeft <= 0) {
      _swapTeams(g);
      _resetPair(g);
      g.phase = 'throw1';
    }
  }

  return g;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function _markCupHit(g, cupId) {
  for (const team of ['A', 'B']) {
    const cup = g.cups[team].find(c => c.id === cupId);
    if (cup) { cup.status = 'hit'; return; }
  }
}

function _applyDodgePenalty(g, throwerId) {
  // +2 cups if same player dodges twice in a row (consecutive within a turn)
  const penalty = (g.lastDodgeBy === throwerId) ? 2 : 1;
  g.lastDodgeBy = throwerId;

  // Per spec §9.2: dodge adds cups to the DEFENDING team's rack
  const defendingTeam = g.throwingTeam === 'A' ? 'B' : 'A';
  const maxPos = Math.max(...g.cups[defendingTeam].map(c => c.rack_position), -1);

  for (let i = 0; i < penalty; i++) {
    g.cups[defendingTeam].push({
      id: `penalty-${Date.now()}-${i}`,
      game_id: g.id,
      team: defendingTeam,
      rack_position: maxPos + 1 + i,
      status: 'standing',
      _isPenalty: true,
    });
  }
}

function _resolvePair(g) {
  const hits = g.pendingPair.throws.filter(t => t.outcome === 'hit');
  const hitCount = hits.length;

  // Balls back: exactly 2 hits and both hit the SAME cup
  if (hitCount === 2) {
    const [h1, h2] = hits;
    if (h1.cup_id && h1.cup_id === h2.cup_id) {
      // Balls back — same team throws again
      g.ballsBack = true;
      _resetPair(g);
      // Reset thrower index back to first thrower
      g.phase = 'throw1';
      return;
    }
  }

  // Both players hit (2 different cups) → bonus throws
  if (hitCount === 2) {
    const defendingTeam = g.throwingTeam === 'A' ? 'B' : 'A';
    const remaining = standingCups(g, defendingTeam);
    if (remaining > 0) {
      g.phase = 'bonus';
      g.bonusThrowsLeft = remaining;
      _resetPair(g);
      _checkGameOver(g); // edge case: cups might already be 0
      return;
    }
  }

  // Normal resolution: check game over then swap
  _checkGameOver(g);
  if (g.status === 'complete') return;

  _swapTeams(g);
  _resetPair(g);
  g.phase = 'throw1';
}

function _checkGameOver(g) {
  const defendingTeam = g.throwingTeam === 'A' ? 'B' : 'A';
  if (standingCups(g, defendingTeam) === 0) {
    g.status = 'complete';
    g.winner = g.throwingTeam;
  }
}

function _swapTeams(g) {
  g.throwingTeam = g.throwingTeam === 'A' ? 'B' : 'A';
  g.lastDodgeBy = null;
}

function _advanceThrower(g, team) {
  const parts = g.participants[team];
  if (parts.length <= 1) return;
  g.currentThrowerIdx[team] = (g.currentThrowerIdx[team] + 1) % parts.length;
}

function _resetPair(g) {
  g.pendingPair = { throws: [], throwers: [] };
  g.ballsBack = false;
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

export function shouldTriggerRerack(g, team) {
  const triggers = RERACK_TRIGGERS[g.cupCount] ?? new Set();
  return triggers.has(standingCups(g, team));
}

export function applyRerack(g, team, newPositions) {
  snapshot(g);
  const standing = g.cups[team].filter(c => c.status === 'standing');
  standing.forEach((cup, i) => { cup.rack_position = newPositions[i] ?? i; });
}
