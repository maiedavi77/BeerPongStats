/**
 * src/tournament-data.js
 *
 * Teams + tournament bracket persistence (v4 Phase 3).
 * Bracket generation itself is pure (src/bracket.js); this module writes
 * the result to tournament_matches, starts match games, and keeps the
 * bracket in sync with finished games (idempotent, runs on every load).
 */

import { supabase, currentUser } from './supabase.js';
import { generateBracket, distributeGroups, roundRobin } from './bracket.js';

// Finals matches share the (event_id, round, position) unique key with group
// matches; group positions encode the group (group_no * 100 + i) and finals
// positions are offset so the two stages never collide.
const FINALS_POS_OFFSET = 1000;

// ─── Teams ──────────────────────────────────────────────────────────────────

export async function eventTeams(eventId) {
  const { data, error } = await supabase
    .from('teams')
    .select(`
      id, name, seed, created_at,
      team_members ( id, user_id, temp_user_id,
        profiles ( display_name, avatar_path ),
        event_temp_users ( display_name ) )
    `)
    .eq('event_id', eventId)
    .order('seed', { ascending: true, nullsFirst: false })
    .order('created_at');
  return { teams: data ?? [], error: error?.message };
}

export async function createTeam(eventId, name) {
  const { data, error } = await supabase
    .from('teams')
    .insert({ event_id: eventId, name, created_by: currentUser.id })
    .select('id')
    .single();
  return error ? { error: error.message } : { teamId: data.id };
}

export async function deleteTeam(teamId) {
  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  return error ? { error: error.message } : {};
}

export async function setTeamSeed(teamId, seed) {
  const { error } = await supabase.from('teams').update({ seed }).eq('id', teamId);
  return error ? { error: error.message } : {};
}

/** entry: { type: 'user'|'temp', id } */
export async function addTeamMember(eventId, teamId, entry) {
  const { error } = await supabase.from('team_members').insert({
    team_id: teamId,
    event_id: eventId,
    user_id: entry.type === 'user' ? entry.id : null,
    temp_user_id: entry.type === 'temp' ? entry.id : null,
  });
  if (error) {
    return { error: error.code === '23505'
      ? 'This person is already in a team' : error.message };
  }
  return {};
}

export async function removeTeamMember(memberId) {
  const { error } = await supabase.from('team_members').delete().eq('id', memberId);
  return error ? { error: error.message } : {};
}

export function teamMemberName(m) {
  return m.user_id
    ? (m.profiles?.display_name ?? '?')
    : (m.event_temp_users?.display_name ?? 'Guest');
}

// ─── Bracket ────────────────────────────────────────────────────────────────

export async function loadMatches(eventId) {
  const { data, error } = await supabase
    .from('tournament_matches')
    .select('*')
    .eq('event_id', eventId)
    .order('round')
    .order('position');
  return { matches: data ?? [], error: error?.message };
}

/**
 * Step 1 of bracket generation: the GROUP STAGE.
 * Teams are snake-distributed into `numGroups` groups (seeds spread apart)
 * and a full round-robin is scheduled within each group. REPLACES any
 * existing bracket — group stage AND finals (caller confirms).
 *
 * @param {number} cupCount 6 | 10 — every group match is played with this
 */
export async function generateGroupStage(eventId, teams, numGroups, cupCount) {
  if (teams.length < 2) return { error: 'At least 2 teams are needed' };
  if (numGroups < 1 || teams.length / numGroups < 2) {
    return { error: 'Each group needs at least 2 teams' };
  }

  // Replace any previous bracket: unlink games first, then delete matches.
  await supabase.from('games').update({ tournament_match_id: null })
    .eq('event_id', eventId).not('tournament_match_id', 'is', null);
  const { error: delErr } = await supabase
    .from('tournament_matches').delete().eq('event_id', eventId);
  if (delErr) return { error: delErr.message };

  const groups = distributeGroups(
    teams.map(t => ({ id: t.id, name: t.name, seed: t.seed ?? null })),
    numGroups,
  );

  const rows = [];
  groups.forEach((group, g) => {
    roundRobin(group).forEach((pairs, r) => {
      pairs.forEach(([a, b], i) => rows.push({
        event_id: eventId,
        stage: 'group',
        group_no: g,
        round: r,
        position: g * 100 + i,
        team_a: a.id,
        team_b: b.id,
        is_bye: false,
        cup_count: cupCount,
      }));
    });
  });

  const { error: insErr } = await supabase.from('tournament_matches').insert(rows);
  if (insErr) return { error: insErr.message };
  return {};
}

/**
 * Group standings, computed from decided group matches.
 * Rank within a group: wins desc → losses asc → seed asc → name.
 *
 * @returns {Array<Array<{team, played, wins, losses, done}>>} per group
 */
export function computeGroupStandings(groupMatches, teamsById) {
  const groups = new Map();
  for (const m of groupMatches) {
    const g = m.group_no ?? 0;
    if (!groups.has(g)) groups.set(g, new Map());
    const table = groups.get(g);
    for (const tid of [m.team_a, m.team_b]) {
      if (tid && !table.has(tid)) {
        table.set(tid, { teamId: tid, played: 0, wins: 0, losses: 0 });
      }
    }
    if (m.winner_team_id) {
      const loser = m.winner_team_id === m.team_a ? m.team_b : m.team_a;
      const w = table.get(m.winner_team_id);
      const l = table.get(loser);
      if (w) { w.played++; w.wins++; }
      if (l) { l.played++; l.losses++; }
    }
  }

  return [...groups.keys()].sort((a, b) => a - b).map(g =>
    [...groups.get(g).values()]
      .map(row => ({ ...row, team: teamsById.get(row.teamId) }))
      .sort((a, b) =>
        b.wins - a.wins
        || a.losses - b.losses
        || ((a.team?.seed ?? 999) - (b.team?.seed ?? 999))
        || (a.team?.name ?? '').localeCompare(b.team?.name ?? '')));
}

/**
 * Step 2 of bracket generation: the FINALS bracket.
 * Takes the top `advancePerGroup` teams of every group (by current
 * standings) and builds a single-elimination bracket. Qualifiers are seeded
 * by their group rank (all group winners get the top seeds, then all
 * runners-up, …) so teams from the same group meet as late as possible.
 * REPLACES only a previously generated finals bracket; the group stage
 * stays untouched.
 *
 * @param {number} cupCount 6 | 10 — every finals match is played with this
 */
export async function generateFinals(eventId, groupMatches, teamsById, advancePerGroup, cupCount) {
  const standings = computeGroupStandings(groupMatches, teamsById);
  const qualifiers = [];
  for (let rank = 0; rank < advancePerGroup; rank++) {
    // Alternate group order per rank so e.g. A1 and B2 land in the same half
    const order = rank % 2 === 0 ? standings : [...standings].reverse();
    for (const table of order) {
      const row = table[rank];
      if (row?.team) qualifiers.push({ id: row.teamId, name: row.team.name, seed: qualifiers.length + 1 });
    }
  }
  if (qualifiers.length < 2) return { error: 'At least 2 qualifying teams are needed' };

  // Replace only the finals: unlink finals games, delete finals matches.
  const { data: oldFinals } = await supabase
    .from('tournament_matches').select('id')
    .eq('event_id', eventId).eq('stage', 'finals');
  if (oldFinals?.length) {
    await supabase.from('games').update({ tournament_match_id: null })
      .in('tournament_match_id', oldFinals.map(m => m.id));
    const { error: delErr } = await supabase
      .from('tournament_matches').delete().eq('event_id', eventId).eq('stage', 'finals');
    if (delErr) return { error: delErr.message };
  }

  const bracket = generateBracket(qualifiers);

  // Pass 1: insert rows (byes' next-round teams were pre-filled by the
  // generator, so team slots of later rounds may already be set).
  const rows = bracket.all.map(m => ({
    event_id: eventId,
    stage: 'finals',
    round: m.round,
    position: FINALS_POS_OFFSET + m.position,
    team_a: m.a?.id ?? null,
    team_b: m.b?.id ?? null,
    is_bye: m.isBye,
    cup_count: cupCount,
  }));
  const { data: inserted, error: insErr } = await supabase
    .from('tournament_matches')
    .insert(rows)
    .select('id, round, position');
  if (insErr) return { error: insErr.message };

  // Pass 2: wire winner_to via (round, position) → id
  const idByPos = new Map(inserted.map(r => [`${r.round}:${r.position}`, r.id]));
  for (let i = 0; i < bracket.all.length; i++) {
    const m = bracket.all[i];
    if (m.winnerTo === null) continue;
    const target = bracket.all[m.winnerTo];
    const { error } = await supabase
      .from('tournament_matches')
      .update({
        winner_to: idByPos.get(`${target.round}:${FINALS_POS_OFFSET + target.position}`),
        winner_slot: m.winnerSlot,
      })
      .eq('id', idByPos.get(`${m.round}:${FINALS_POS_OFFSET + m.position}`));
    if (error) return { error: error.message };
  }
  return {};
}

/**
 * Start the live game for a match: creates the game (linked via
 * tournament_match_id) with both teams' members as participants, cups,
 * and stores game_id on the match. The cup count comes from the match
 * itself (set at bracket generation, not at game start).
 */
export async function startMatchGame(eventId, match, teamsById) {
  const cupCount = match.cup_count ?? 10;
  const rosterOf = teamId => teamsById.get(teamId)?.team_members ?? [];
  const aMembers = rosterOf(match.team_a);
  const bMembers = rosterOf(match.team_b);
  if (!aMembers.length || !bMembers.length) {
    return { error: 'Both teams need at least one member' };
  }

  const { data: game, error: gErr } = await supabase
    .from('games')
    .insert({
      event_id: eventId, cup_count: cupCount, status: 'active',
      started_by: currentUser.id, tournament_match_id: match.id,
    })
    .select('id')
    .single();
  if (gErr) return { error: gErr.message };

  const rows = [];
  const pushSide = (members, side) => members.slice(0, 4).forEach((m, idx) => rows.push({
    game_id: game.id, team: side,
    participant_type: m.user_id ? 'user' : 'temp',
    user_id: m.user_id ?? null,
    temp_user_id: m.temp_user_id ?? null,
    throw_order: idx,
  }));
  pushSide(aMembers, 'A');
  pushSide(bMembers, 'B');
  const { error: pErr } = await supabase.from('game_participants').insert(rows);
  if (pErr) return { error: pErr.message };

  const cupRows = [];
  for (const team of ['A', 'B']) {
    for (let pos = 0; pos < cupCount; pos++) {
      cupRows.push({ game_id: game.id, team, rack_position: pos, status: 'standing' });
    }
  }
  const { error: cErr } = await supabase.from('cups').insert(cupRows);
  if (cErr) return { error: cErr.message };

  const { error: mErr } = await supabase
    .from('tournament_matches')
    .update({ game_id: game.id })
    .eq('id', match.id);
  if (mErr) return { error: mErr.message };

  return { gameId: game.id };
}

/**
 * Idempotent bracket sync ("automatic advancement"): completed linked
 * games set the match winner and fill the next round's slot. Runs on
 * every bracket load — write permission failures (non-hosts) are ignored
 * because a host's next load will perform the same sync.
 */
export async function syncBracket(matches) {
  const pending = matches.filter(m => m.game_id && !m.winner_team_id);
  if (!pending.length) return { changed: false };

  const { data: games } = await supabase
    .from('games')
    .select('id, status, winner_team')
    .in('id', pending.map(m => m.game_id));
  const byId = new Map((games ?? []).map(g => [g.id, g]));

  let changed = false;
  for (const m of pending) {
    const g = byId.get(m.game_id);
    if (!g || g.status !== 'complete' || !g.winner_team) continue;

    const winnerTeamId = g.winner_team === 'A' ? m.team_a : m.team_b;
    if (!winnerTeamId) continue;

    const { error } = await supabase
      .from('tournament_matches')
      .update({ winner_team_id: winnerTeamId })
      .eq('id', m.id);
    if (error) continue; // e.g. no write permission — a host will sync

    if (m.winner_to && m.winner_slot) {
      await supabase
        .from('tournament_matches')
        .update({ [m.winner_slot === 'a' ? 'team_a' : 'team_b']: winnerTeamId })
        .eq('id', m.winner_to)
        .is(m.winner_slot === 'a' ? 'team_a' : 'team_b', null);
    }
    changed = true;
  }
  return { changed };
}
