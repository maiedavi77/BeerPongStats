/**
 * src/ui/screens/live-game.js
 *
 * Live game scoring screen.
 * Loads full game state, subscribes to Realtime, renders cup racks,
 * handles throw logging, undo, and delegates to re-rack / game-complete screens.
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
import { renderRack } from '../components/cup-rack.js';
import { subscribeGame } from '../../realtime.js';
import {
  buildGameState, logThrow, doUndo,
  currentThrower, standingCups, shouldTriggerRerack,
} from '../../game-engine.js';

let _state = null;   // in-memory game state
let _unsub = null;   // Realtime unsubscribe fn

export default async function render($el, { id: gameId }) {
  if (!gameId) { navigate('#/'); return; }

  $el.innerHTML = `
    <div id="live-wrapper">
      <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:1rem;">
        <button id="back-live" class="btn-secondary" style="width:auto; padding:0.4rem 0.75rem; font-size:0.8rem;">← Games</button>
        <span id="game-status-badge" style="font-size:0.75rem; color:var(--green); font-weight:500;">● LIVE</span>
      </div>

      <!-- Score bar -->
      <div style="display:flex; justify-content:space-between; margin-bottom:1rem;">
        <div style="text-align:center; flex:1;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:3rem; color:var(--blue); line-height:1;" id="score-a">–</div>
          <div style="font-size:0.8rem; color:var(--text-dim);" id="name-a">Team A</div>
        </div>
        <div style="color:var(--text-faint); align-self:center; font-size:0.9rem;">vs</div>
        <div style="text-align:center; flex:1;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:3rem; color:var(--amber); line-height:1;" id="score-b">–</div>
          <div style="font-size:0.8rem; color:var(--text-dim);" id="name-b">Team B</div>
        </div>
      </div>

      <!-- Cup racks -->
      <div style="display:flex; justify-content:space-around; margin-bottom:1.25rem; gap:0.5rem;">
        <div id="rack-a" style="text-align:center;"></div>
        <div id="rack-b" style="text-align:center;"></div>
      </div>

      <!-- Throw controls -->
      <div id="throw-controls" class="card" style="margin-bottom:0.75rem;">
        <div style="font-size:0.75rem; color:var(--text-dim); margin-bottom:0.75rem;" id="thrower-label">Loading…</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;" id="outcome-btns">
          <button class="outcome-btn" data-outcome="miss"    style="background:var(--surface-3); color:var(--text);">Miss</button>
          <button class="outcome-btn" data-outcome="airball" style="background:var(--surface-3); color:var(--text);">Airball</button>
          <button class="outcome-btn" data-outcome="dodge"   style="background:var(--amber); color:#000;">Dodge 🛡️</button>
          <button class="outcome-btn" data-outcome="hit"     style="background:var(--green); color:#000;">Hit 🎯</button>
        </div>
        <div style="margin-top:0.75rem; display:flex; gap:0.5rem;">
          <button id="undo-btn" class="btn-secondary" style="width:auto; padding:0.4rem 0.75rem; font-size:0.8rem;" disabled>↩ Undo</button>
          <span id="phase-label" style="align-self:center; font-size:0.75rem; color:var(--text-faint);"></span>
        </div>
      </div>

      <!-- Spectator note (shown for non-participants) -->
      <div id="spectator-note" style="display:none; text-align:center; color:var(--text-faint); font-size:0.8rem; margin-bottom:0.5rem;">
        👁️ Spectating — view only
      </div>

      <!-- Throw log -->
      <div class="card">
        <span class="label">Throw log</span>
        <div id="throw-log" style="max-height:180px; overflow-y:auto; font-size:0.8rem; font-family:'JetBrains Mono',monospace; color:var(--text-dim);">
          <p style="color:var(--text-faint);">No throws yet</p>
        </div>
      </div>
    </div>`;

  document.getElementById('back-live').addEventListener('click', () => navigate('#/'));

  // ─── Load game ─────────────────────────────────────────────────────────
  const { gameRow, cups, participants, throws, error } = await loadGameData(gameId);
  if (error) {
    toast('Failed to load game', 'error');
    $el.innerHTML = `<div class="empty-state"><p style="color:var(--red);">${error}</p></div>`;
    return;
  }

  _state = buildGameState(gameRow, cups, participants, throws);

  // Determine if current user is a participant
  const isParticipant = participants.some(p => p.user_id === currentUser?.id);

  if (!isParticipant) {
    document.getElementById('throw-controls').style.display = 'none';
    document.getElementById('spectator-note').style.display = 'block';
  }

  // ─── Realtime subscription ─────────────────────────────────────────────
  _unsub = subscribeGame(gameId, {
    onCupChange: async () => {
      const { cups: freshCups } = await loadGameData(gameId);
      if (freshCups) {
        _state.cups.A = freshCups.filter(c => c.team === 'A');
        _state.cups.B = freshCups.filter(c => c.team === 'B');
        updateUI();
      }
    },
    onThrowChange: async (payload) => {
      // Another player logged a throw — reload throw log
      const { throws: freshThrows } = await loadGameData(gameId);
      if (freshThrows) { _state.allThrows = freshThrows; renderThrowLog(); }
    },
    onGameChange: (payload) => {
      if (payload.new?.status === 'complete') {
        navigate(`#/game/${gameId}/complete`);
      }
    },
  });

  updateUI();
  attachOutcomeHandlers(gameId, isParticipant);

  // ─── Teardown ──────────────────────────────────────────────────────────
  return () => { _unsub?.(); _state = null; };
}

// ─── UI update ─────────────────────────────────────────────────────────────

function updateUI() {
  if (!_state) return;
  const g = _state;

  // Scores
  document.getElementById('score-a').textContent = standingCups(g, 'A');
  document.getElementById('score-b').textContent = standingCups(g, 'B');

  const namesA = g.participants.A.map(p => p.profiles?.display_name ?? '?').join(' & ');
  const namesB = g.participants.B.map(p => p.profiles?.display_name ?? '?').join(' & ');
  document.getElementById('name-a').textContent = namesA || 'Team A';
  document.getElementById('name-b').textContent = namesB || 'Team B';

  // Cup racks
  const rackA = document.getElementById('rack-a');
  const rackB = document.getElementById('rack-b');
  if (rackA) rackA.innerHTML = `<div style="font-size:0.7rem; color:var(--text-faint); margin-bottom:4px;">TEAM A</div>${renderRack(g.cups.A, { interactive: g.throwingTeam === 'A' })}`;
  if (rackB) rackB.innerHTML = `<div style="font-size:0.7rem; color:var(--text-faint); margin-bottom:4px;">TEAM B</div>${renderRack(g.cups.B, { interactive: g.throwingTeam === 'B' })}`;

  // Thrower label
  const thrower = currentThrower(g);
  const phaseLabel = g.phase === 'bonus' ? `Bonus (${g.bonusThrowsLeft} left)` : `Throw ${g.phase === 'throw1' ? '1' : '2'}`;
  const throwLabel = document.getElementById('thrower-label');
  if (throwLabel) throwLabel.textContent = `${thrower?.profiles?.display_name ?? '?'} throws — Team ${g.throwingTeam}`;

  const phaseEl = document.getElementById('phase-label');
  if (phaseEl) phaseEl.textContent = phaseLabel;

  // Undo button
  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) undoBtn.disabled = g.undoStack.length === 0;

  renderThrowLog();
}

function renderThrowLog() {
  const $log = document.getElementById('throw-log');
  if (!$log || !_state) return;
  const throws = [...(_state.allThrows ?? [])].reverse().slice(0, 20);
  if (!throws.length) { $log.innerHTML = '<p style="color:var(--text-faint);">No throws yet</p>'; return; }

  const icons = { hit: '🎯', miss: '○', airball: '💨', dodge: '🛡️' };
  $log.innerHTML = throws.map(t => {
    const throwerName = t.thrower_user_id
      ? [...(_state.participants.A ?? []), ...(_state.participants.B ?? [])]
          .find(p => p.user_id === t.thrower_user_id)?.profiles?.display_name ?? '?'
      : '?';
    return `<div style="padding:0.2rem 0; border-bottom:1px solid var(--surface-2);">
      <span style="color:var(--text-faint);">#${t.sequence_no}</span>
      ${icons[t.outcome] ?? '·'}
      <span style="color:var(--text);">${throwerName}</span>
      <span style="color:var(--text-faint); font-size:0.7rem;"> ${t.outcome}</span>
    </div>`;
  }).join('');
}

// ─── Outcome handlers ───────────────────────────────────────────────────────

function attachOutcomeHandlers(gameId, isParticipant) {
  if (!isParticipant) return;

  document.querySelectorAll('.outcome-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const outcome = btn.dataset.outcome;
      if (outcome === 'hit') {
        // Need cup selection — show overlay on the defending team's rack
        enterCupSelectMode(gameId);
      } else {
        await persistThrow(gameId, outcome, null);
      }
    });
  });

  document.getElementById('undo-btn').addEventListener('click', () => {
    _state = doUndo(_state);
    updateUI();
  });
}

function enterCupSelectMode(gameId) {
  const defendingTeam = _state.throwingTeam === 'A' ? 'B' : 'A';
  const rack = document.getElementById(`rack-${defendingTeam.toLowerCase()}`);
  if (!rack) return;

  // Highlight standing cups as clickable
  rack.querySelectorAll('[data-cup-id]').forEach(circle => {
    circle.style.outline = '2px solid var(--green)';
    circle.addEventListener('click', async function handler(e) {
      const cupId = e.currentTarget.dataset.cupId;
      rack.querySelectorAll('[data-cup-id]').forEach(c => { c.style.outline = ''; c.removeEventListener('click', handler); });
      await persistThrow(gameId, 'hit', cupId);
    }, { once: true });
  });

  toast('Tap the cup that was hit', 'info', 2000);
}

async function persistThrow(gameId, outcome, cupId) {
  if (!_state) return;
  const throwerId = currentThrower(_state)?.user_id ?? currentUser?.id;

  // Apply to in-memory state
  try {
    logThrow(_state, outcome, cupId, throwerId);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  updateUI();

  // Check game over
  if (_state.status === 'complete') {
    await finalizeGame(gameId, _state.winner);
    navigate(`#/game/${gameId}/complete`);
    return;
  }

  // Check re-rack
  const defendingTeam = _state.throwingTeam === 'A' ? 'B' : 'A';
  for (const team of ['A', 'B']) {
    if (shouldTriggerRerack(_state, team)) {
      navigate(`#/game/${gameId}/rerack?team=${team}`);
      return;
    }
  }

  // Persist to Supabase
  const { error } = await writeThrow(gameId, outcome, cupId, throwerId);
  if (error) {
    toast(`Sync error: ${error}`, 'error');
  }
}

// ─── Supabase writes ────────────────────────────────────────────────────────

async function writeThrow(gameId, outcome, cupId, throwerId) {
  const seqNo = _state.allThrows.length;

  const throwRow = {
    game_id: gameId,
    sequence_no: seqNo,
    thrower_type: 'user',
    thrower_user_id: throwerId,
    throwing_team: _state.throwingTeam,
    outcome,
    logged_by: currentUser.id,
  };

  // Retry once on sequence_no conflict (concurrent throw)
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: throwData, error: throwErr } = await supabase
      .from('throws')
      .insert({ ...throwRow, sequence_no: seqNo + attempt })
      .select('id')
      .single();

    if (throwErr) {
      if (throwErr.code === '23505' && attempt === 0) continue; // unique violation, retry
      return { error: throwErr.message };
    }

    // If hit, update cup status
    if (outcome === 'hit' && cupId) {
      const { error: cupErr } = await supabase
        .from('cups')
        .update({ status: 'hit' })
        .eq('id', cupId)
        .eq('status', 'standing'); // optimistic lock: only update if still standing

      if (cupErr) return { error: cupErr.message };

      // Link throw to cup
      await supabase.from('throw_cups').insert({ throw_id: throwData.id, cup_id: cupId });
    }

    return {};
  }

  return { error: 'Sequence conflict — please retry' };
}

async function finalizeGame(gameId, winnerTeam) {
  await supabase
    .from('games')
    .update({ status: 'complete', winner_team: winnerTeam, ended_at: new Date().toISOString() })
    .eq('id', gameId);
}

// ─── Data loading ────────────────────────────────────────────────────────────

async function loadGameData(gameId) {
  const [gameRes, cupsRes, participantsRes, throwsRes] = await Promise.all([
    supabase.from('games').select('*').eq('id', gameId).single(),
    supabase.from('cups').select('*').eq('game_id', gameId),
    supabase.from('game_participants').select('*, profiles(display_name)').eq('game_id', gameId),
    supabase.from('throws').select('*').eq('game_id', gameId).order('sequence_no'),
  ]);

  const error = gameRes.error?.message ?? cupsRes.error?.message ?? participantsRes.error?.message;
  return {
    gameRow: gameRes.data,
    cups: cupsRes.data ?? [],
    participants: participantsRes.data ?? [],
    throws: throwsRes.data ?? [],
    error,
  };
}
