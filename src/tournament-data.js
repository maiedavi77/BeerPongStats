/**
 * src/tournament-data.js
 *
 * Teams + tournament bracket persistence (v4 Phase 3).
 * Bracket generation itself is pure (src/bracket.js); this module writes
 * the result to tournament_matches, starts match games, and keeps the
 * bracket in sync with finished games (idempotent, runs on every load).
 */

import { supabase, currentUser } from './supabase.js';
import { generateBracket } from './bracket.js';

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
 * Generate the single-elimination bracket from the event's teams and
 * persist it, REPLACING any existing bracket (caller confirms with the
 * user). Two passes: insert all matches, then wire winner_to ids.
 */
export async function generateAndPersistBracket(eventId, teams) {
  if (teams.length < 2) return { error: 'At least 2 teams are needed' };

  const bracket = generateBracket(teams.map(t => ({ id: t.id, name: t.name, seed: t.seed ?? null })));

  // Replace any previous bracket (games keep their rows; the link column
  // on old matches disappears with them via ON DELETE ... games keep
  // tournament_match_id pointing nowhere? -> clear links first).
  await supabase.from('games').update({ tournament_match_id: null })
    .eq('event_id', eventId).not('tournament_match_id', 'is', null);
  const { error: delErr } = await supabase
    .from('tournament_matches').delete().eq('event_id', eventId);
  if (delErr) return { error: delErr.message };

  // Pass 1: insert rows (byes' next-round teams were pre-filled by the
  // generator, so team slots of later rounds may already be set).
  const rows = bracket.all.map(m => ({
    event_id: eventId,
    round: m.round,
    position: m.position,
    team_a: m.a?.id ?? null,
    team_b: m.b?.id ?? null,
    is_bye: m.isBye,
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
        winner_to: idByPos.get(`${target.round}:${target.position}`),
        winner_slot: m.winnerSlot,
      })
      .eq('id', idByPos.get(`${m.round}:${m.position}`));
    if (error) return { error: error.message };
  }
  return {};
}

/**
 * Start the live game for a match: creates the game (linked via
 * tournament_match_id) with both teams' members as participants, cups,
 * and stores game_id on the match.
 */
export async function startMatchGame(eventId, match, teamsById, cupCount) {
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
