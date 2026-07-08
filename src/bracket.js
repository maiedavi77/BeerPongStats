/**
 * src/bracket.js
 *
 * Single-elimination bracket generation — a JavaScript port of the core
 * algorithms of `bracketool` by David Hontecillas
 * (https://github.com/dhontecillas/bracketool), used under the MIT License:
 *
 *   MIT License — Copyright (c) David Hontecillas
 *   Permission is hereby granted, free of charge, to any person obtaining
 *   a copy of this software and associated documentation files, to deal in
 *   the Software without restriction (see the repository's LICENSE file).
 *
 * Ported pieces: bye distribution (`_assign_byes` /
 * `generate_first_round_clashes`), bracket depth distance
 * (`brackets_depth_distance`), rating-based distance-maximising placement
 * (`PairingsGenerator._assign_by_rating` / `_further_from_others`) and the
 * round-linking loop of `SingleEliminationGen.generate`. RACKED's
 * competitors are whole teams, so the same-club separation features
 * (`use_teams`) are intentionally not ported.
 *
 * Output shape (pure data, persisted to tournament_matches by the caller):
 *   { rounds: Match[][], all: Match[] }
 *   Match = { round, position, a, b, isBye, winnerTo, winnerSlot }
 *   a/b are competitor objects ({ id, name, seed }) or null;
 *   winnerTo = index into `all`; winnerSlot = 'a' | 'b'.
 */

/** Distribute byes so bye-receivers meet as late as possible (port of _assign_byes). */
function assignByes(slots, begin, end, numByes) {
  if (numByes > 1) {
    const mid = begin + Math.floor((end - begin) / 2);
    const midByes = Math.floor(numByes / 2);
    assignByes(slots, begin, mid, midByes);
    assignByes(slots, mid, end, numByes - midByes);
  } else if (numByes === 1) {
    slots[begin].isBye = true;
  }
}

/** Port of generate_first_round_clashes. */
export function generateFirstRoundClashes(numCompetitors) {
  if (numCompetitors < 2) return [];
  const firstRoundSlots = 1 << Math.ceil(Math.log2(numCompetitors));
  const numClashes = firstRoundSlots / 2;
  const numByes = firstRoundSlots - numCompetitors;
  const clashes = Array.from({ length: numClashes }, () => ({
    a: null, b: null, isBye: false,
  }));
  if (numByes > 0) assignByes(clashes, 0, clashes.length, numByes);
  return clashes;
}

/** Port of brackets_depth_distance: rounds until slots idx_a and idx_b meet. */
export function depthDistance(numClashes, idxA, idxB) {
  if (idxA === idxB) return 1;
  let maxDistance = Math.log2(numClashes) + 1;
  let s = Math.floor(numClashes / 2);
  while (s > 0 && Math.floor(idxA / s) === Math.floor(idxB / s)) {
    maxDistance -= 1;
    s = Math.floor(s / 2);
  }
  return maxDistance;
}

function hasSpot(clash) {
  return clash.a === null || (clash.b === null && !clash.isBye);
}

function addCompetitor(clash, competitor) {
  if (clash.a === null) clash.a = competitor;
  else if (clash.b === null && !clash.isBye) clash.b = competitor;
  else throw new Error('Clash does not have a spot');
}

/** Port of _further_from_others: pick the open clash farthest from occupied ones. */
function furthestOption(options, clashes) {
  let best = options[0];
  let bestSum = -1;
  for (const opt of options) {
    let sum = 0;
    for (let i = 0; i < clashes.length; i++) {
      if (clashes[i].a !== null) sum += depthDistance(clashes.length, opt, i);
    }
    if (sum >= bestSum) { bestSum = sum; best = opt; }
  }
  return best;
}

/**
 * Generate a full single-elimination bracket.
 * Port of SingleEliminationGen.generate (use_teams=false):
 * seeds sorted best-first, each placed as far as possible from the
 * already-placed; unseeded competitors are shuffled behind the seeded.
 *
 * @param {Array<{id, name, seed?: number|null}>} competitors
 * @returns {{rounds: object[][], all: object[]}}
 */
export function generateBracket(competitors) {
  const first = generateFirstRoundClashes(competitors.length);
  if (!first.length) return { rounds: [], all: [] };

  // Rating order: explicit seeds first (1 = strongest), the rest random.
  const seeded = competitors.filter(c => Number.isFinite(c.seed));
  const unseeded = competitors.filter(c => !Number.isFinite(c.seed));
  for (let i = unseeded.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unseeded[i], unseeded[j]] = [unseeded[j], unseeded[i]];
  }
  const ordered = [...seeded.sort((x, y) => x.seed - y.seed), ...unseeded];

  for (const comp of ordered) {
    const options = [];
    for (let i = 0; i < first.length; i++) if (hasSpot(first[i])) options.push(i);
    if (!options.length) break; // defensive; cannot happen with correct sizing
    addCompetitor(first[furthestOption(options, first)], comp);
  }

  // Build the full structure with winner links (port of the round loop).
  const all = [];
  const rounds = [];
  let round = first.map((c, i) => ({
    round: 0, position: i, a: c.a, b: c.b, isBye: c.isBye,
    winnerTo: null, winnerSlot: null,
  }));
  rounds.push(round);
  all.push(...round);

  let last = round;
  let r = 1;
  while (last.length > 1) {
    const numNext = last.length / 2;
    const next = Array.from({ length: numNext }, (_, i) => ({
      round: r, position: i, a: null, b: null, isBye: false,
      winnerTo: null, winnerSlot: null,
    }));
    rounds.push(next);
    const base = all.length;
    for (let i = 0; i < last.length; i++) {
      last[i].winnerTo = base + Math.floor(i / 2);
      last[i].winnerSlot = i % 2 === 0 ? 'a' : 'b';
    }
    all.push(...next);
    last = next;
    r += 1;
  }

  // Byes auto-advance immediately.
  for (const m of rounds[0]) {
    if (m.isBye && m.a && m.winnerTo !== null) {
      const target = all[m.winnerTo];
      target[m.winnerSlot] = m.a;
    }
  }

  return { rounds, all };
}
