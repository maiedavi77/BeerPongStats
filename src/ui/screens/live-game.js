/**
 * src/ui/screens/live-game.js
 *
 * Live game scoring screen.
 *
 * UX:
 *  - Only the DEFENDING team's rack is shown as the main action area.
 *  - Tapping a cup directly = hit (no separate "Hit" button).
 *  - Miss / Airball / Dodge are explicit buttons below the rack.
 *  - After both throws of a turn complete, the rack swaps to the other team.
 *
 * Bug fixes vs original:
 *  - writeThrow() is persisted BEFORE any navigation (re-rack / game-complete).
 *  - shouldTriggerRerack() is only checked after a 'hit' outcome.
 *  - The DEFENDING team's rack is interactive, not the throwing team's.
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate }              from '../../router.js';
import { toast }                 from '../components/toast.js';
import { renderRack }            from '../components/cup-rack.js';
import { subscribeGame }         from '../../realtime.js';
import {
  buildGameState, logThrow, doUndo,
  currentThrower, standingCups, shouldTriggerRerack,
} from '../../game-engine.js';

// Module-level game state (reset on teardown)
let _state         = null;
let _unsub         = null;
let _gameId        = null;
let _isParticipant = false;
let _throwing      = false;  // debounce: prevent double-tap

// ─── Screen entry point ────────────────────────────────────────────────────

export default async function render($el, { id: gameId }) {
  if (!gameId) { navigate('#/'); return; }
  _gameId = gameId;

  $el.innerHTML = `
    <div id="live-wrapper">

      <!-- Back + live badge -->
      <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:0.75rem;">
        <button id="back-live" class="btn-secondary"
          style="width:auto; padding:0.4rem 0.75rem; font-size:0.8rem;">← Games</button>
        <span id="game-status-badge"
          style="font-size:0.75rem; color:var(--green); font-weight:500;">● LIVE</span>
      </div>

      <!-- Score bar -->
      <div style="display:flex; justify-content:center; gap:2.5rem; margin-bottom:0.75rem;">
        <div style="text-align:center;">
          <div id="score-a"
            style="font-family:'Bebas Neue',sans-serif; font-size:2.75rem; color:var(--blue); line-height:1;">–</div>
          <div id="name-a" style="font-size:0.75rem; color:var(--text-dim);">Team A</div>
        </div>
        <div style="align-self:center; color:var(--text-faint); font-size:0.85rem;">vs</div>
        <div style="text-align:center;">
          <div id="score-b"
            style="font-family:'Bebas Neue',sans-serif; font-size:2.75rem; color:var(--amber); line-height:1;">–</div>
          <div id="name-b" style="font-size:0.75rem; color:var(--text-dim);">Team B</div>
        </div>
      </div>

      <!-- Current thrower + phase -->
      <div class="card" style="padding:0.6rem 1rem; margin-bottom:0.75rem;">
        <div id="thrower-label" style="font-size:0.85rem; color:var(--text);">Loading…</div>
        <div id="phase-label"   style="font-size:0.7rem;  color:var(--text-faint); margin-top:2px;"></div>
      </div>

      <!-- DEFENDING team's rack — tap a cup to log a hit -->
      <div class="card" id="target-card"
        style="margin-bottom:0.75rem; text-align:center; padding:0.75rem 0.75rem 1rem;">
        <div id="target-label"
          style="font-size:0.7rem; color:var(--text-faint); text-transform:uppercase;
                 letter-spacing:0.06em; margin-bottom:0.6rem;">
          Target rack — tap to hit
        </div>
        <div id="rack-target" style="display:inline-block;"></div>
      </div>

      <!-- Non-hit outcomes -->
      <div id="throw-controls"
        style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.5rem; margin-bottom:0.75rem;">
        <button class="outcome-btn" data-outcome="miss"
          style="background:var(--surface-3); color:var(--text); border-radius:12px; padding:0.65rem 0; font-size:0.85rem;">
          Miss
        </button>
        <button class="outcome-btn" data-outcome="airball"
          style="background:var(--surface-3); color:var(--text); border-radius:12px; padding:0.65rem 0; font-size:0.85rem;">
          Airball
        </button>
        <button class="outcome-btn" data-outcome="dodge"
          style="background:var(--amber); color:#000; border-radius:12px; padding:0.65rem 0; font-size:0.85rem;">
          Dodge 🛡️
        </button>
      </div>

      <!-- Spectator notice -->
      <div id="spectator-note"
        style="display:none; text-align:center; color:var(--text-faint); font-size:0.8rem; margin-bottom:0.5rem;">
        👁️ Spectating — view only
      </div>

      <!-- Undo -->
      <div style="margin-bottom:0.75rem;">
        <button id="undo-btn" class="btn-secondary"
          style="width:auto; padding:0.4rem 0.75rem; font-size:0.8rem;" disabled>↩ Undo</button>
      </div>

      <!-- Throw log -->
      <div class="card">
        <span class="label">Throw log</span>
        <div id="throw-log"
          style="max-height:160px; overflow-y:auto; font-size:0.8rem;
                 font-family:'JetBrains Mono',monospace; color:var(--text-dim);">
          <p style="color:var(--text-faint);">No throws yet</p>
        </div>
      </div>

    </div>`;

  document.getElementById('back-live').addEventListener('click', () => navigate('#/'));

  // ─── Load initial game state ─────────────────────────────────────────────
  const { gameRow, cups, participants, throws, error } = await loadGameData(gameId);
  if (error) {
    toast('Failed to load game', 'error');
    $el.innerHTML = `<div class="empty-state"><p style="color:var(--red);">${error}</p></div>`;
    return;
  }

  _state         = buildGameState(gameRow, cups, participants, throws);
  _isParticipant = participants.some(p => p.user_id === currentUser?.id);

  if (!_isParticipant) {
    document.getElementById('throw-controls').style.display = 'none';
    document.getElementById('spectator-note').style.display = 'block';
  }

  // ─── Realtime subscription ───────────────────────────────────────────────
  _unsub = subscribeGame(gameId, {
    onCupChange: async () => {
      const { cups: fresh } = await loadGameData(gameId);
      if (!fresh) return;
      _state.cups.A = fresh.filter(c => c.team === 'A');
      _state.cups.B = fresh.filter(c => c.team === 'B');
      updateUI();
    },
    onThrowChange: async () => {
      const { throws: fresh } = await loadGameData(gameId);
      if (fresh) { _state.allThrows = fresh; renderThrowLog(); }
    },
    onGameChange: payload => {
      if (payload.new?.status === 'complete') navigate(`#/game/${gameId}/complete`);
    },
  });

  updateUI();
  attachOutcomeHandlers();

  return () => { _unsub?.(); _state = null; _throwing = false; };
}

// ─── UI ────────────────────────────────────────────────────────────────────

function updateUI() {
  if (!_state) return;
  const g         = _state;
  const defending = g.throwingTeam === 'A' ? 'B' : 'A';
  const throwCol  = g.throwingTeam === 'A' ? 'var(--blue)' : 'var(--amber)';

  // Scores
  document.getElementById('score-a').textContent = standingCups(g, 'A');
  document.getElementById('score-b').textContent = standingCups(g, 'B');

  // Names
  const namesA = g.participants.A.map(p => p.profiles?.display_name ?? '?').join(' & ');
  const namesB = g.participants.B.map(p => p.profiles?.display_name ?? '?').join(' & ');
  document.getElementById('name-a').textContent = namesA || 'Team A';
  document.getElementById('name-b').textContent = namesB || 'Team B';

  // Thrower label
  const thrower    = currentThrower(g);
  const throwerName = thrower?.profiles?.display_name ?? '?';
  const phase = g.phase === 'bonus'
    ? `Bonus — ${g.bonusThrowsLeft} throw${g.bonusThrowsLeft !== 1 ? 's' : ''} remaining`
    : `Throw ${g.phase === 'throw1' ? '1' : '2'} of 2`;

  const throwEl = document.getElementById('thrower-label');
  if (throwEl) throwEl.innerHTML =
    `<span style="color:${throwCol}; font-weight:600;">Team ${g.throwingTeam}</span>` +
    ` — ${throwerName} throws`;
  const phaseEl = document.getElementById('phase-label');
  if (phaseEl) phaseEl.textContent = phase;

  // Target rack label
  const targetLabel = document.getElementById('target-label');
  const defColor = defending === 'A' ? 'var(--blue)' : 'var(--amber)';
  if (targetLabel) targetLabel.innerHTML =
    `Team <span style="color:${defColor};">${defending}</span>'s cups` +
    (_isParticipant ? ' — tap to register a hit' : '');

  // Defending team's rack (interactive when participant)
  const $target = document.getElementById('rack-target');
  if ($target) {
    $target.innerHTML = renderRack(g.cups[defending], {
      interactive: _isParticipant,
      cupCount: g.cupCount,
    });

    // Wire cup clicks → hit
    if (_isParticipant) {
      $target.querySelectorAll('[data-cup-id]').forEach(el => {
        el.addEventListener('click', () => {
          if (_throwing) return;
          persistThrow('hit', el.dataset.cupId);
        });
      });
    }
  }

  // Undo button
  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) undoBtn.disabled = g.undoStack.length === 0;

  renderThrowLog();
}

function renderThrowLog() {
  const $log = document.getElementById('throw-log');
  if (!$log || !_state) return;
  const throws = [...(_state.allThrows ?? [])].reverse().slice(0, 20);
  if (!throws.length) {
    $log.innerHTML = '<p style="color:var(--text-faint);">No throws yet</p>';
    return;
  }
  const icons  = { hit: '🎯', miss: '○', airball: '💨', dodge: '🛡️' };
  const allP   = [...(_state.participants.A ?? []), ...(_state.participants.B ?? [])];
  $log.innerHTML = throws.map(t => {
    const name = t.thrower_user_id
      ? (allP.find(p => p.user_id === t.thrower_user_id)?.profiles?.display_name ?? '?')
      : '?';
    return `<div style="padding:0.2rem 0; border-bottom:1px solid var(--surface-2);">
      <span style="color:var(--text-faint);">#${t.sequence_no}</span>
      ${icons[t.outcome] ?? '·'}
      <span style="color:var(--text);">${name}</span>
      <span style="color:var(--text-faint); font-size:0.7rem;"> ${t.outcome}</span>
    </div>`;
  }).join('');
}

// ─── Outcome handlers ───────────────────────────────────────────────────────

function attachOutcomeHandlers() {
  if (!_isParticipant) return;

  document.querySelectorAll('.outcome-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (_throwing) return;
      persistThrow(btn.dataset.outcome, null);
    });
  });

  document.getElementById('undo-btn').addEventListener('click', () => {
    _state = doUndo(_state);
    updateUI();
  });
}

// ─── Persist throw ─────────────────────────────────────────────────────────

async function persistThrow(outcome, cupId) {
  if (!_state || _throwing) return;
  _throwing = true;

  // Capture throwing team BEFORE logThrow (which may swap teams after throw2)
  const throwingTeamSnapshot = _state.throwingTeam;
  const defendingTeam        = throwingTeamSnapshot === 'A' ? 'B' : 'A';
  const throwerId            = currentThrower(_state)?.user_id ?? currentUser?.id;

  // Apply to in-memory state
  try {
    logThrow(_state, outcome, cupId, throwerId);
  } catch (err) {
    toast(err.message, 'error');
    _throwing = false;
    return;
  }

  updateUI();

  // ★ PERSIST FIRST — before any navigation so the throw is never lost
  const { error } = await writeThrow(outcome, cupId, throwerId);
  if (error) toast(`Sync error: ${error}`, 'error');

  _throwing = false;

  // Check game over
  if (_state.status === 'complete') {
    await finalizeGame(_gameId, _state.winner);
    navigate(`#/game/${_gameId}/complete`);
    return;
  }

  // Check re-rack — ONLY after a hit, ONLY the defending team's cups
  if (outcome === 'hit' && shouldTriggerRerack(_state, defendingTeam)) {
    navigate(`#/game/${_gameId}/rerack?team=${defendingTeam}`);
  }
}

// ─── Supabase writes ────────────────────────────────────────────────────────

async function writeThrow(outcome, cupId, throwerId) {
  if (!_state) return { error: 'No game state' };

  const seqNo = _state.allThrows.length;  // allThrows already contains this throw

  const throwRow = {
    game_id:         _gameId,
    sequence_no:     seqNo,
    thrower_type:    'user',
    thrower_user_id: throwerId,
    throwing_team:   _state.throwingTeam,  // may have swapped; use snapshot if needed
    outcome,
    logged_by:       currentUser.id,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: throwData, error: throwErr } = await supabase
      .from('throws')
      .insert({ ...throwRow, sequence_no: seqNo + attempt })
      .select('id')
      .single();

    if (throwErr) {
      if (throwErr.code === '23505' && attempt === 0) continue; // conflict, retry
      return { error: throwErr.message };
    }

    if (outcome === 'hit' && cupId) {
      const { error: cupErr } = await supabase
        .from('cups')
        .update({ status: 'hit' })
        .eq('id', cupId)
        .eq('status', 'standing');
      if (cupErr) return { error: cupErr.message };

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
    gameRow:      gameRes.data,
    cups:         cupsRes.data ?? [],
    participants: participantsRes.data ?? [],
    throws:       throwsRes.data ?? [],
    error,
  };
}
