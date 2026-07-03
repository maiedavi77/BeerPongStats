/**
 * src/game-sync.js
 *
 * Supabase persistence for the game engine.
 * The engine (src/game-engine.js) is pure and returns "persist plans";
 * this module executes them. Writes stay compatible with the RLS design:
 *   - throws are inserted in complete pairs (never deleted)
 *   - cups are only updated while status = 'standing' (optimistic lock)
 *   - UNIQUE(game_id, sequence_no) conflicts are retried once with a
 *     refreshed sequence base
 */

import { supabase, currentUser } from './supabase.js';

// ─── First-team memory (games table has no first_team column) ───────────────

export function rememberFirstTeam(gameId, team) {
  try { localStorage.setItem(`racked_first_team_${gameId}`, team); } catch { /* private mode */ }
}

export function recallFirstTeam(gameId) {
  try { return localStorage.getItem(`racked_first_team_${gameId}`) ?? 'A'; } catch { return 'A'; }
}

// ─── Loading ────────────────────────────────────────────────────────────────

export async function loadGameData(gameId) {
  const [gameRes, cupsRes, participantsRes, throwsRes, reRacksRes] = await Promise.all([
    supabase.from('games').select('*').eq('id', gameId).single(),
    supabase.from('cups').select('*').eq('game_id', gameId),
    supabase.from('game_participants')
      .select('*, profiles(display_name)')
      .eq('game_id', gameId),
    supabase.from('throws')
      .select('*, throw_cups(cup_id)')
      .eq('game_id', gameId)
      .order('sequence_no'),
    supabase.from('re_racks').select('team').eq('game_id', gameId),
  ]);

  const error =
    gameRes.error?.message ??
    cupsRes.error?.message ??
    participantsRes.error?.message;

  return {
    gameRow:      gameRes.data,
    cups:         cupsRes.data ?? [],
    participants: participantsRes.data ?? [],
    throws:       throwsRes.data ?? [],
    reRacks:      reRacksRes.data ?? [],
    error,
  };
}

// ─── Writing ────────────────────────────────────────────────────────────────

/**
 * Persist a resolved pair: 2 throw rows + throw_cups links + hit cup updates.
 * @param {string} gameId
 * @param {object} plan  engine persist plan { throwRows, hitCupIds, complete, winner }
 * @returns {{error?: string}}
 */
export async function writePair(gameId, plan) {
  const loggedBy = currentUser?.id;

  for (let attempt = 0; attempt < 2; attempt++) {
    let rows = plan.throwRows;

    if (attempt === 1) {
      // Sequence conflict: refresh the base from the DB and renumber.
      const { count } = await supabase
        .from('throws')
        .select('id', { count: 'exact', head: true })
        .eq('game_id', gameId);
      const base = count ?? 0;
      rows = plan.throwRows.map((r, i) => ({ ...r, sequence_no: base + i }));
    }

    const inserts = rows.map(r => ({
      game_id:         gameId,
      sequence_no:     r.sequence_no,
      thrower_type:    r.thrower_type,
      thrower_user_id: r.thrower_user_id,
      throwing_team:   r.throwing_team,
      outcome:         r.outcome,
      logged_by:       loggedBy,
    }));

    const { data, error } = await supabase
      .from('throws')
      .insert(inserts)
      .select('id, sequence_no');

    if (error) {
      if (error.code === '23505' && attempt === 0) continue; // retry once
      return { error: error.message };
    }

    // Link throws → cups (hits and dodge-hits)
    const links = [];
    rows.forEach((r, i) => {
      if (r.cup_id) {
        const inserted = data.find(d => d.sequence_no === r.sequence_no) ?? data[i];
        if (inserted) links.push({ throw_id: inserted.id, cup_id: r.cup_id });
      }
    });
    if (links.length) {
      const { error: linkErr } = await supabase.from('throw_cups').insert(links);
      if (linkErr) console.error('[sync] throw_cups:', linkErr.message);
    }

    // Batched cup removal (optimistic lock on standing)
    if (plan.hitCupIds.length) {
      const { error: cupErr } = await supabase
        .from('cups')
        .update({ status: 'hit' })
        .in('id', plan.hitCupIds)
        .eq('status', 'standing');
      if (cupErr) return { error: cupErr.message };
    }

    return {};
  }
  return { error: 'Sequence conflict — please retry' };
}

/** Persist bonus cup removals. */
export async function writeBonus(cupIds) {
  if (!cupIds.length) return {};
  const { error } = await supabase
    .from('cups')
    .update({ status: 'hit' })
    .in('id', cupIds)
    .eq('status', 'standing');
  return error ? { error: error.message } : {};
}

/** Persist a re-rack: position updates + the re_racks log row. */
export async function writeRerack(gameId, team, updates, cupsRemaining) {
  // Line-slot codes (>= 100) go first: if the DB constraint rejects them
  // (migration not applied yet), no cup has moved and the rack stays intact.
  const ordered = [...updates].sort((a, b) => b.rack_position - a.rack_position);
  for (const u of ordered) {
    const { error } = await supabase
      .from('cups')
      .update({ rack_position: u.rack_position })
      .eq('id', u.id)
      .eq('status', 'standing');
    if (error) {
      // See migrations/2026-07-03-line-cup-positions.sql
      if (error.message?.includes('cups_rack_position_check')) {
        return { error: 'Line positions are blocked by the database — run migrations/2026-07-03-line-cup-positions.sql in Supabase' };
      }
      return { error: error.message };
    }
  }
  const { error } = await supabase.from('re_racks').insert({
    game_id: gameId,
    team,
    cups_remaining_at_rerack: cupsRemaining,
    performed_by: currentUser?.id,
  });
  return error ? { error: error.message } : {};
}

/** Mark the game complete / cancelled. */
export async function writeGameStatus(gameId, status, winnerTeam = null) {
  const upd = { status };
  if (winnerTeam) upd.winner_team = winnerTeam;
  if (status === 'complete' || status === 'cancelled') upd.ended_at = new Date().toISOString();
  const { error } = await supabase.from('games').update(upd).eq('id', gameId);
  return error ? { error: error.message } : {};
}
