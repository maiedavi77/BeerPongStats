/**
 * src/game-engine.js
 *
 * Pure beer pong rules engine — authoritative RACKED rules ported from
 * v1.052 (see SPEC.md). No DOM, no Supabase: fully unit-testable.
 *
 * Turn flow:
 *   throw1 → throw2 → resolve → (bonus?) → finalize → throw1
 *   (same team again on balls-back, otherwise the turn flips)
 *
 * RULES:
 * - A thrower must be explicitly selected before a throw is logged.
 * - Cups hit by ball 1 stay standing (pending) until the pair resolves;
 *   ball 2 may target the same cup.
 * - Pair resolve: unique hit cups removed. 0 left → complete (bonus skipped).
 * - Bonus removals = dodge-hits + (2 if both balls sank the SAME cup),
 *   capped at cups remaining.
 * - Balls back when BOTH balls hit (dodge-hits count as hits).
 * - Dodge-hits are persisted with DB outcome 'dodge' and normalized back
 *   to { outcome:'hit', isDodge:true } on load.
 *
 * PERSISTENCE MODEL (undo-safe):
 * - Nothing is written for ball 1. logThrow() for ball 2 returns a
 *   `persist` plan (throw rows + hit cup ids); confirmBonus() returns the
 *   bonus removals. The sync layer executes these plans.
 * - The undo stack is cleared at every persistence boundary, so undo can
 *   never desync from the database.
 */

// ─── Line-cup slot codes (rack_position >= 100) ─────────────────────────────
// Line cups sit in the horizontal GAP between two adjacent starting cups on the
// same row (the "middle lane"), only used by re-rack line formations. The other
// centre-column positions (row 1 / row 3 centres) are already real slots, so
// only the gaps need codes.
//
//   10-cup grid          centre column (x = 1.5)
//     0 1 2 3    y=0   →  gap 1|2 = (1.5, 0)  → code 100
//      4 5 6     y=1   →  slot 5  = (1.5, 1)
//       7 8      y=2   →  gap 7|8 = (1.5, 2)  → code 101
//        9       y=3   →  slot 9  = (1.5, 3)
//
//   6-cup grid           centre column (x = 1)
//     0 1 2      y=0   →  slot 1  = (1, 0)
//      3 4       y=1   →  gap 3|4 = (1, 1)    → code 100
//       5        y=2   →  slot 5  = (1, 2)
export const LINE_SLOT_BASE = 100;

export const LINE_SLOTS = {
  10: {
    100: { x: 1.5, y: 0 },  // between cups 1 and 2 (row 0)
    101: { x: 1.5, y: 2 },  // between cups 7 and 8 (row 2)
  },
  6: {
    100: { x: 1, y: 1 },    // between cups 3 and 4 (row 1)
  },
};

/** Map a reference lineCup coordinate to its rack_position code. */
export function lineSlotCode(cupCount, coord) {
  const table = LINE_SLOTS[cupCount] ?? {};
  for (const [code, c] of Object.entries(table)) {
    if (c.x === coord.x && c.y === coord.y) return Number(code);
  }
  return null;
}

const MAX_UNDO = 25;

// ─── Participant identity ───────────────────────────────────────────────────
// A thrower is addressed by a KEY so registered users and event guests
// (event_temp_users) are handled uniformly:
//   'u:<user_id>'       registered player
//   't:<temp_user_id>'  guest (no account)

/** Key for a game_participants row. */
export function participantKey(p) {
  return p.participant_type === 'temp' ? `t:${p.temp_user_id}` : `u:${p.user_id}`;
}

/** Split a key back into DB throw columns. */
export function keyToThrowFields(key) {
  if (key?.startsWith('t:')) {
    return { thrower_type: 'temp', thrower_user_id: null, thrower_temp_id: key.slice(2) };
  }
  return { thrower_type: 'user', thrower_user_id: key?.slice(2) ?? null, thrower_temp_id: null };
}

// ─── State construction & DB replay ─────────────────────────────────────────

/** Normalize a DB throw row into the in-memory shape. */
function normalizeThrow(row) {
  const isDodge = row.outcome === 'dodge';
  const thrower = row.thrower_type === 'temp'
    ? (row.thrower_temp_id ? `t:${row.thrower_temp_id}` : null)
    : (row.thrower_user_id ? `u:${row.thrower_user_id}` : null);
  return {
    sequence_no: row.sequence_no,
    team:        row.throwing_team,
    outcome:     isDodge ? 'hit' : row.outcome,   // 'hit' | 'miss' | 'airball'
    isDodge,
    thrower,
    cup_id:      row.throw_cups?.[0]?.cup_id ?? row.cup_id ?? null,
  };
}

function isHit(t) { return t.outcome === 'hit'; }
function other(team) { return team === 'A' ? 'B' : 'A'; }

/**
 * Build game state from DB rows.
 *
 * Throws are only persisted in complete pairs, so replaying pairs with the
 * balls-back rule deterministically yields the current throwing team.
 *
 * @param {object}   gameRow      games row
 * @param {object[]} cups         cups rows
 * @param {object[]} participants game_participants rows (with profiles)
 * @param {object[]} throws       throws rows ordered by sequence_no,
 *                                optionally with embedded throw_cups
 * @param {object[]} reRacks      re_racks rows ({ team })
 * @param {{firstTeam?: 'A'|'B'}} opts fallback before any throw exists
 */
export function buildGameState(gameRow, cups, participants, throws = [], reRacks = [], opts = {}) {
  const byPos = (a, b) => a.rack_position - b.rack_position;
  const byOrder = (a, b) => (a.throw_order ?? 0) - (b.throw_order ?? 0);
  const withIdentity = p => ({
    ...p,
    key:  participantKey(p),
    name: p.participant_type === 'temp'
      ? (p.event_temp_users?.display_name ?? 'Guest')
      : (p.profiles?.display_name ?? '?'),
  });

  const g = {
    id:       gameRow.id,
    cupCount: gameRow.cup_count,
    status:   gameRow.status ?? 'active',
    winner:   gameRow.winner_team ?? null,

    cups: {
      A: cups.filter(c => c.team === 'A').sort(byPos),
      B: cups.filter(c => c.team === 'B').sort(byPos),
    },
    participants: {
      A: participants.filter(p => p.team === 'A').sort(byOrder).map(withIdentity),
      B: participants.filter(p => p.team === 'B').sort(byOrder).map(withIdentity),
    },

    throwingTeam: opts.firstTeam ?? 'A',
    phase:        'throw1',            // 'throw1' | 'throw2' | 'bonus' | 'complete' | 'cancelled'
    ballsBack:    false,

    selectedThrower:     null,         // user_id — must be set before logThrow
    throwerIsSuggestion: false,

    pendingPair: { throws: [] },
    bonus:       { required: 0, selected: [], dodgeCount: 0, sameCup: false },
    _targetTeam: null,

    allThrows:           throws.map(normalizeThrow),
    persistedThrowCount: throws.length,

    rerackUsed: {
      A: reRacks.some(r => r.team === 'A'),
      B: reRacks.some(r => r.team === 'B'),
    },

    undoStack: [],
  };

  // ── Replay pairs to derive throwingTeam / ballsBack / phase ──
  const ts = g.allThrows;
  if (ts.length > 0) {
    let team = ts[0].team;
    let back = false;
    let i = 0;
    for (; i + 1 < ts.length; i += 2) {
      const bothHit = isHit(ts[i]) && isHit(ts[i + 1]);
      team = bothHit ? ts[i].team : other(ts[i].team);
      back = bothHit;
    }
    if (i < ts.length) {
      // Defensive: an odd row count should not occur with pair-batched writes.
      g.throwingTeam = ts[ts.length - 1].team;
      g.phase = 'throw2';
      g.pendingPair.throws = [ts[ts.length - 1]];
      g.ballsBack = false;
    } else {
      g.throwingTeam = team;
      g.ballsBack = back;
    }
  }

  if (g.status !== 'active') g.phase = g.status;
  else autoSelectThrower(g);

  return g;
}

// ─── Undo (persistence-boundary aware) ──────────────────────────────────────

function snapshot(g) {
  const snap = structuredClone(g);
  snap.undoStack = [];
  g.undoStack.push(JSON.stringify(snap));
  if (g.undoStack.length > MAX_UNDO) g.undoStack.shift();
}

/** Clear undo history — called whenever a write hits the database. */
function persistenceBoundary(g) {
  g.undoStack = [];
}

export function canUndo(g) {
  return g.undoStack.length > 0;
}

export function doUndo(g) {
  if (!g.undoStack.length) return g;
  const prev = JSON.parse(g.undoStack.pop());
  prev.undoStack = g.undoStack;
  return prev;
}

// ─── Thrower selection ──────────────────────────────────────────────────────

export function setThrower(g, userId) {
  g.selectedThrower = userId;
  g.throwerIsSuggestion = false;
}

/**
 * Auto-select the next thrower for the attacking team (v1 algorithm):
 * single-player teams are picked outright; otherwise a suggestion is derived
 * by pattern-matching the team's throw history.
 */
export function autoSelectThrower(g) {
  const roster = g.participants[g.throwingTeam] ?? [];
  if (roster.length === 1) {
    g.selectedThrower = roster[0].key;
    g.throwerIsSuggestion = false;
    return;
  }
  const s = suggestNextThrower(g, g.throwingTeam);
  if (s) { g.selectedThrower = s; g.throwerIsSuggestion = true; }
  else   { g.selectedThrower = null; g.throwerIsSuggestion = false; }
}

function pairUp(arr) {
  const p = [];
  for (let i = 0; i + 1 < arr.length; i += 2) p.push([arr[i], arr[i + 1]]);
  return p;
}

/** Ported verbatim from v1.052 (names → user ids). */
export function suggestNextThrower(g, team) {
  const roster = (g.participants[team] ?? []).map(p => p.key);
  if (roster.length < 2) return null;
  const throws = g.allThrows.filter(t => t.team === team).map(t => t.thrower);

  if (throws.length % 2 === 1) {
    // Mid-pair: who throws ball 2?
    const ball1 = throws[throws.length - 1];
    const pp = pairUp(throws.slice(0, -1));
    if (!pp.length) return null;
    const sameCount = pp.filter(p => p[0] === p[1]).length;
    if (sameCount >= pp.length - sameCount) return ball1;      // solo-pair pattern
    const partners = {};
    pp.forEach(p => { if (p[0] === ball1 && p[1] !== ball1) partners[p[1]] = (partners[p[1]] || 0) + 1; });
    let best = null;
    Object.keys(partners).forEach(n => { if (!best || partners[n] > partners[best]) best = n; });
    if (best) return best;
    return roster[(roster.indexOf(ball1) + 1) % roster.length];
  }

  // New pair: rotate ball-1 throwers based on recent leads
  const pp2 = pairUp(throws);
  if (!pp2.length) return null;
  const primaries = pp2.map(p => p[0]);
  const order = [];
  primaries.slice(-8).forEach(n => { if (!order.includes(n)) order.push(n); });
  if (order.length < 2) return null;
  const last = primaries[primaries.length - 1];
  return order[(order.indexOf(last) + 1) % order.length];
}

// ─── Throw logging ──────────────────────────────────────────────────────────

/**
 * Record a throw and advance the game.
 *
 * @param {object} g
 * @param {'hit'|'miss'|'airball'} outcome
 * @param {string|null} cupId   defending cup id — required for a hit
 * @param {boolean} isDodge     dodge toggle armed (only meaningful on a hit)
 * @returns {{resolved: boolean, persist: object|null}}
 *   `persist` (only when the pair resolves) =
 *   { throwRows, hitCupIds, complete, winner }
 *   throwRows carry DB outcomes ('dodge' for dodge-hits) and sequence_no.
 */
export function logThrow(g, outcome, cupId, isDodge = false) {
  if (g.status !== 'active') throw new Error('Game is not active');
  if (g.phase !== 'throw1' && g.phase !== 'throw2') throw new Error('Not in a throw phase');
  if (!g.selectedThrower) throw new Error('Pick who threw it first');
  if (outcome === 'hit' && !cupId) throw new Error('A hit needs a cup');

  snapshot(g);

  const t = {
    team:    g.throwingTeam,
    outcome,
    isDodge: outcome === 'hit' ? !!isDodge : false,
    cup_id:  outcome === 'hit' ? cupId : null,
    thrower: g.selectedThrower,
  };
  g.pendingPair.throws.push(t);
  g.allThrows.push(t);

  if (g.phase === 'throw1') {
    g.phase = 'throw2';
    autoSelectThrower(g);
    return { resolved: false, persist: null };
  }
  return { resolved: true, persist: resolvePair(g) };
}

/** Cup ids hit within the unresolved pair (for pending visuals). */
export function pendingHitCupIds(g) {
  return g.pendingPair.throws.filter(t => t.outcome === 'hit' && t.cup_id).map(t => t.cup_id);
}

// ─── Pair resolution ────────────────────────────────────────────────────────

function findCup(g, cupId) {
  return g.cups.A.find(c => c.id === cupId) ?? g.cups.B.find(c => c.id === cupId);
}

function resolvePair(g) {
  const [t1, t2] = g.pendingPair.throws;
  const tgt = other(g.throwingTeam);
  g._targetTeam = tgt;

  const bothHit = isHit(t1) && isHit(t2);
  const sameCup = bothHit && t1.cup_id != null && t1.cup_id === t2.cup_id;
  const dodgeCount = (t1.isDodge ? 1 : 0) + (t2.isDodge ? 1 : 0);

  // Remove unique hit cups
  const hitCupIds = [...new Set([t1, t2].filter(t => isHit(t) && t.cup_id).map(t => t.cup_id))];
  for (const id of hitCupIds) {
    const cup = findCup(g, id);
    if (cup) cup.status = 'hit';
  }

  // Build the persistence plan (throw rows written as a pair, v1 model)
  const seqBase = g.persistedThrowCount;
  const throwRows = [t1, t2].map((t, i) => ({
    sequence_no:   seqBase + i,
    throwing_team: t.team,
    outcome:       t.isDodge ? 'dodge' : t.outcome,
    ...keyToThrowFields(t.thrower),
    cup_id:        t.cup_id,          // consumed by the sync layer for throw_cups
  }));
  g.persistedThrowCount += 2;

  const persist = { throwRows, hitCupIds, complete: false, winner: null };

  g._bothHit = bothHit;

  if (standingCups(g, tgt) === 0) {
    completeGame(g, g.throwingTeam);
    persist.complete = true;
    persist.winner = g.winner;
    persistenceBoundary(g);
    return persist;
  }

  const bonusCount = dodgeCount + (sameCup ? 2 : 0);
  if (bonusCount > 0) {
    g.phase = 'bonus';
    g.bonus = {
      required:   Math.min(bonusCount, standingCups(g, tgt)),
      selected:   [],
      dodgeCount,
      sameCup,
    };
  } else {
    finalizePair(g);
  }

  persistenceBoundary(g);
  return persist;
}

function finalizePair(g) {
  g.pendingPair = { throws: [] };
  g.bonus = { required: 0, selected: [], dodgeCount: 0, sameCup: false };
  g.phase = 'throw1';
  if (g._bothHit) {
    g.ballsBack = true;                        // same team throws again
  } else {
    g.ballsBack = false;
    g.throwingTeam = other(g.throwingTeam);
  }
  autoSelectThrower(g);
}

function completeGame(g, winner) {
  g.status = 'complete';
  g.phase = 'complete';
  g.winner = winner;
  g.pendingPair = { throws: [] };
  g.bonus = { required: 0, selected: [], dodgeCount: 0, sameCup: false };
}

// ─── Bonus phase ────────────────────────────────────────────────────────────

/**
 * Toggle a defending cup in the bonus selection.
 * @returns {boolean} false when the selection is already full.
 */
export function toggleBonusCup(g, cupId) {
  const idx = g.bonus.selected.indexOf(cupId);
  if (idx >= 0) { g.bonus.selected.splice(idx, 1); return true; }
  if (g.bonus.selected.length >= g.bonus.required) return false;
  const cup = findCup(g, cupId);
  if (!cup || cup.status !== 'standing' || cup.team !== g._targetTeam) return false;
  g.bonus.selected.push(cupId);
  return true;
}

/**
 * Confirm bonus removals.
 * @returns {{removedCupIds: string[], complete: boolean, winner: string|null}|null}
 *   null when the selection is incomplete.
 */
export function confirmBonus(g) {
  if (g.phase !== 'bonus') return null;
  if (g.bonus.selected.length !== g.bonus.required) return null;

  const removedCupIds = [...g.bonus.selected];
  for (const id of removedCupIds) {
    const cup = findCup(g, id);
    if (cup) cup.status = 'hit';
  }

  const result = { removedCupIds, complete: false, winner: null };
  if (standingCups(g, g._targetTeam) === 0) {
    completeGame(g, g.throwingTeam);
    result.complete = true;
    result.winner = g.winner;
  } else {
    finalizePair(g);
  }
  persistenceBoundary(g);
  return result;
}

// ─── Re-rack ────────────────────────────────────────────────────────────────

/**
 * Confirmed rules: only the DEFENDING rack, before ball 1 of the turn,
 * never during balls-back, once per game per rack, 0 < standing < cupCount.
 * (Formation availability for the standing count is checked by the caller.)
 */
export function rerackEligible(g, team) {
  if (g.status !== 'active') return false;
  if (team === g.throwingTeam) return false;
  if (g.phase !== 'throw1' || g.pendingPair.throws.length > 0) return false;
  if (g.ballsBack) return false;
  if (g.rerackUsed[team]) return false;
  const standing = standingCups(g, team);
  return standing > 0 && standing < g.cupCount;
}

/**
 * Move the team's standing cups onto the formation's positions
 * (standard slots and/or line-slot codes >= 100).
 *
 * @param {string[]|number[]} positions - one entry per standing cup
 * @returns {{id: string, rack_position: number}[]} updates for the sync layer
 */
export function applyRerack(g, team, positions) {
  const standing = g.cups[team].filter(c => c.status === 'standing');
  if (positions.length !== standing.length) {
    throw new Error(`Formation has ${positions.length} slots for ${standing.length} cups`);
  }
  const updates = standing.map((cup, i) => {
    cup.rack_position = Number(positions[i]);
    return { id: cup.id, rack_position: cup.rack_position };
  });
  g.cups[team].sort((a, b) => a.rack_position - b.rack_position);
  g.rerackUsed[team] = true;
  persistenceBoundary(g);
  return updates;
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function standingCups(g, team) {
  return g.cups[team].filter(c => c.status === 'standing').length;
}

/** v1 score semantics: cups a team has TAKEN from the opponent. */
export function cupsTaken(g, team) {
  return g.cupCount - standingCups(g, other(team));
}

export function participantName(g, key) {
  const all = [...g.participants.A, ...g.participants.B];
  return all.find(p => p.key === key)?.name ?? '?';
}
