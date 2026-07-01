
/**
 * src/ui/screens/live-game.js
 *
 * Live game scoring screen.
 *
 * Throw flow:
 *   1. throw1 — attacking team selects thrower, taps a cup (hit) or Miss/Airball.
 *              Dodge toggle arms the next hit as a dodge (+1 bonus removal).
 *   2. throw2 — same flow for second ball.
 *   3. bonus  — if bonus cups earned (dodge / same cup), tap defending cups to
 *              select for removal, then confirm.
 *
 * Re-rack:
 *   Each team may re-rack the cups they throw at ONCE per game.
 *   Button appears at the start of throw1 only (before any throw).
 *   Navigates to re-rack.js which updates rack_positions and returns here.
 *
 * Dodge:
 *   Toggle the Dodge button BEFORE tapping the cup.
 *   The cup is still removed; 1 bonus cup removal is earned.
 *   Resets automatically after each throw.
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate }              from '../../router.js';
import { toast }                 from '../components/toast.js';
import { renderRack }            from '../components/cup-rack.js';
import { subscribeGame }         from '../../realtime.js';
import {
  buildGameState, logThrow, doUndo,
  currentThrower, standingCups,
  selectBonusCup, confirmBonusRemoval,
} from '../../game-engine.js';

// ─── Module-level state ───────────────────────────────────────────────────
let _state         = null;
let _unsub         = null;
let _gameId        = null;
let _isParticipant = false;
let _throwing      = false;   // debounce double-tap
let _dodgeArmed    = false;   // dodge toggle state
let _rerackUsed    = { A: false, B: false }; // each team's one re-rack per game

// ─── Screen entry point ───────────────────────────────────────────────────

export default async function render($el, { id: gameId }) {
  if (!gameId) { navigate('#/'); return; }
  _gameId      = gameId;
  _dodgeArmed  = false;
  _throwing    = false;

  $el.innerHTML = `
    <div id="live-wrapper">

      <!-- Back + live badge -->
      <div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:0.75rem;">
        <button id="back-live" class="btn-secondary"
          style="width:auto; padding:0.4rem 0.75rem; font-size:0.8rem;">← Games</button>
        <span style="font-size:0.75rem; color:var(--green); font-weight:500;">● LIVE</span>
      </div>

      <!-- Score bar -->
      <div style="display:flex; justify-content:center; gap:2.5rem; margin-bottom:0.6rem;">
        <div style="text-align:center;">
          <div id="score-a"
            style="font-family:'Bebas Neue',sans-serif; font-size:2.75rem; color:var(--red); line-height:1;">–</div>
          <div id="name-a" style="font-size:0.75rem; color:var(--text-dim);">Team A</div>
        </div>
        <div style="align-self:center; color:var(--text-faint); font-size:0.85rem;">vs</div>
        <div style="text-align:center;">
          <div id="score-b"
            style="font-family:'Bebas Neue',sans-serif; font-size:2.75rem; color:var(--blue); line-height:1;">–</div>
          <div id="name-b" style="font-size:0.75rem; color:var(--text-dim);">Team B</div>
        </div>
      </div>

      <!-- Phase pill -->
      <div style="text-align:center; margin-bottom:0.75rem;">
        <span id="phase-pill"
          style="font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:0.5px;
                 text-transform:uppercase; color:var(--amber); background:rgba(242,169,59,0.12);
                 padding:5px 12px; border-radius:99px;"></span>
      </div>

      <!-- Ball-1 recap (shown during throw2) -->
      <div id="ball1-recap" style="display:none; background:var(--surface-2); border:1px solid var(--line);
        border-radius:10px; padding:9px 12px; font-size:12.5px; color:var(--text-dim);
        margin-bottom:0.6rem; align-items:center; gap:8px;">
      </div>

      <!-- Bonus banner (shown during bonus phase) -->
      <div id="bonus-banner" style="display:none; text-align:center; padding:10px 12px;
        border-radius:10px; margin-bottom:0.6rem; background:var(--green-dim);
        border:1px solid rgba(116,182,135,0.4); font-size:13px; color:var(--green); font-weight:600;">
      </div>

      <!-- Target rack -->
      <div class="card" style="margin-bottom:0.75rem; text-align:center; padding:0.75rem 0.75rem 1rem;">
        <div id="target-label"
          style="font-size:0.7rem; color:var(--text-faint); text-transform:uppercase;
                 letter-spacing:0.06em; margin-bottom:0.6rem;">Target rack</div>
        <div id="rack-target" style="display:inline-block;"></div>
      </div>

      <!-- Spectator note -->
      <div id="spectator-note"
        style="display:none; text-align:center; color:var(--text-faint);
               font-size:0.8rem; margin-bottom:0.5rem;">
        👁️ Spectating — view only
      </div>

      <!-- Controls (throw phase) -->
      <div id="controls-throw" style="display:none;">

        <!-- Re-rack button (throw1 only, once per team) -->
        <div id="rerack-area" style="display:none; margin-bottom:0.5rem;">
          <button id="rerack-btn" class="btn-secondary"
            style="width:100%; font-size:0.85rem; border:1px dashed var(--line);">
            ↕ Re-rack — use 1× this game
          </button>
        </div>

        <!-- Thrower chips -->
        <div style="margin-bottom:0.6rem;">
          <div style="font-family:'JetBrains Mono',monospace; font-size:10px; letter-spacing:1px;
               text-transform:uppercase; color:var(--text-faint); text-align:center; margin-bottom:0.4rem;">
            who threw this ball
          </div>
          <div id="thrower-chips" style="display:flex; flex-wrap:wrap; gap:7px; justify-content:center;"></div>
          <div id="thrower-hint"
            style="display:none; text-align:center; font-size:11px; color:var(--text-faint); margin-top:4px;">
          </div>
        </div>

        <!-- Dodge toggle -->
        <div style="display:flex; justify-content:center; margin-bottom:0.5rem;">
          <button id="dodge-toggle"
            style="display:flex; align-items:center; gap:7px; padding:8px 16px; border-radius:99px;
                   border:1.5px dashed var(--line); background:var(--surface);
                   color:var(--text-dim); font-size:12.5px; font-weight:600; cursor:pointer;">
            🛡️ Dodge: off
          </button>
        </div>

        <!-- Miss / Airball -->
        <div style="display:flex; gap:8px;">
          <button class="miss-btn" data-outcome="airball"
            style="flex:1; background:var(--surface); border:1.5px dashed var(--line);
                   color:var(--text-dim); border-radius:10px; padding:12px;
                   font-weight:600; font-size:13px; cursor:pointer;">Airball</button>
          <button class="miss-btn" data-outcome="miss"
            style="flex:1; background:var(--surface); border:1.5px dashed var(--line);
                   color:var(--text-dim); border-radius:10px; padding:12px;
                   font-weight:600; font-size:13px; cursor:pointer;">Miss</button>
        </div>

      </div>

      <!-- Controls (bonus phase) -->
      <div id="controls-bonus" style="display:none; margin-bottom:0.5rem;">
        <div id="bonus-count"
          style="text-align:center; font-family:'JetBrains Mono',monospace;
                 font-size:12px; color:var(--text-dim); margin-bottom:0.5rem;"></div>
        <button id="bonus-confirm" class="btn-primary" disabled>Confirm removal</button>
      </div>

      <!-- Undo -->
      <div style="display:flex; gap:8px; margin-top:0.5rem; margin-bottom:0.75rem;">
        <button id="undo-btn" class="btn-secondary"
          style="width:auto; padding:0.4rem 0.75rem; font-size:0.8rem;" disabled>↩ Undo</button>
        <button id="cancel-game-btn" class="btn-danger-ghost"
          style="width:auto; padding:0.4rem 0.75rem; font-size:0.8rem;
                 background:transparent; color:#E8897C;
                 border:1px solid rgba(226,64,45,0.35); border-radius:11px; cursor:pointer;">
          Cancel game
        </button>
      </div>

      <!-- Throw log -->
      <div class="card">
        <span class="label">Event log</span>
        <div id="throw-log"
          style="max-height:160px; overflow-y:auto; font-size:0.8rem;
                 font-family:'JetBrains Mono',monospace; color:var(--text-dim);">
          <p style="color:var(--text-faint);">No throws yet</p>
        </div>
      </div>

    </div>`;

  document.getElementById('back-live').addEventListener('click', () => navigate('#/'));

  document.getElementById('cancel-game-btn').addEventListener('click', () => {
    if (confirm('Cancel this game? It won\'t count toward stats.')) {
      supabase.from('games')
        .update({ status: 'cancelled' })
        .eq('id', gameId)
        .then(() => navigate('#/'));
    }
  });

  // ─── Load game ─────────────────────────────────────────────────────────
  const { gameRow, cups, participants, throws, reRacks, error } = await loadGameData(gameId);
  if (error) {
    toast('Failed to load game', 'error');
    $el.innerHTML = `<div class="empty-state"><p style="color:var(--red);">${error}</p></div>`;
    return;
  }

  _state = buildGameState(gameRow, cups, participants, throws);
  _isParticipant = participants.some(p => p.user_id === currentUser?.id);

  // Re-rack: team A used theirs if B's cups were re-racked (A attacks B)
  _rerackUsed = {
    A: reRacks.some(r => r.team === 'B'),
    B: reRacks.some(r => r.team === 'A'),
  };

  if (!_isParticipant) {
    document.getElementById('spectator-note').style.display = 'block';
  }

  // ─── Realtime subscription ──────────────────────────────────────────────
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
  attachStaticHandlers();

  return () => {
    _unsub?.();
    _state     = null;
    _throwing  = false;
    _dodgeArmed = false;
  };
}

// ─── UI ────────────────────────────────────────────────────────────────────

function updateUI() {
  if (!_state) return;
  const g         = _state;
  const defending = g.throwingTeam === 'A' ? 'B' : 'A';
  const atkColor  = g.throwingTeam === 'A' ? 'var(--red)' : 'var(--blue)';
  const defColor  = defending === 'A' ? 'var(--red)' : 'var(--blue)';

  // ── Scores ──────────────────────────────────────────────────────────────
  document.getElementById('score-a').textContent = standingCups(g, 'A');
  document.getElementById('score-b').textContent = standingCups(g, 'B');
  const namesA = g.participants.A.map(p => p.profiles?.display_name ?? '?').join(' & ');
  const namesB = g.participants.B.map(p => p.profiles?.display_name ?? '?').join(' & ');
  document.getElementById('name-a').textContent = namesA || 'Team A';
  document.getElementById('name-b').textContent = namesB || 'Team B';

  // ── Phase pill ──────────────────────────────────────────────────────────
  const phasePill = document.getElementById('phase-pill');
  if (phasePill) {
    const labels = { throw1: 'Ball 1 of 2', throw2: 'Ball 2 of 2', bonus: 'Bonus removal' };
    phasePill.textContent = labels[g.phase] ?? '';
  }

  // ── Ball-1 recap (throw2 phase) ─────────────────────────────────────────
  const ball1El = document.getElementById('ball1-recap');
  if (ball1El) {
    if (g.phase === 'throw2' && g.pendingPair.throws.length > 0) {
      const t1 = g.pendingPair.throws[0];
      const name = _participantName(t1.thrower_user_id);
      const summary = t1.outcome === 'hit'
        ? (t1.isDodge ? 'dodge hit 🛡️' : 'hit 🎯')
        : t1.outcome;
      ball1El.innerHTML = `🏀 <b>Ball 1:</b> ${name} — ${summary}`;
      ball1El.style.display = 'flex';
    } else {
      ball1El.style.display = 'none';
    }
  }

  // ── Bonus banner ────────────────────────────────────────────────────────
  const bonusBanner = document.getElementById('bonus-banner');
  if (bonusBanner) {
    if (g.phase === 'bonus') {
      let reason = '';
      if (g.dodgeCount > 0 && g.sameCupHit)
        reason = `🛡️💥 ${g.dodgeCount} dodge + same cup`;
      else if (g.dodgeCount > 0)
        reason = `🛡️ ${g.dodgeCount} dodge${g.dodgeCount > 1 ? 's' : ''} called`;
      else if (g.sameCupHit)
        reason = '💥 Same cup hit twice';
      bonusBanner.textContent =
        `${reason} — pick ${g.bonusRequired} cup${g.bonusRequired !== 1 ? 's' : ''} to remove`;
      bonusBanner.style.display = 'block';
    } else {
      bonusBanner.style.display = 'none';
    }
  }

  // ── Target label ────────────────────────────────────────────────────────
  const targetLabel = document.getElementById('target-label');
  if (targetLabel) {
    const hint = !_isParticipant ? '' :
      g.phase === 'bonus' ? ' — tap to select for removal' : ' — tap to hit';
    targetLabel.innerHTML =
      `Team <span style="color:${defColor};">${defending}</span>'s cups${hint}`;
  }

  // ── Defending rack ──────────────────────────────────────────────────────
  const $target = document.getElementById('rack-target');
  if ($target) {
    $target.innerHTML = renderRack(
      g.cups[defending],
      { interactive: _isParticipant, cupCount: g.cupCount }
    );

    if (_isParticipant) {
      if (g.phase === 'throw1' || g.phase === 'throw2') {
        // Cup tap = hit (with optional dodge)
        $target.querySelectorAll('[data-cup-id]').forEach(el => {
          el.addEventListener('click', () => {
            if (_throwing) return;
            persistThrow('hit', el.dataset.cupId);
          });
        });
      } else if (g.phase === 'bonus') {
        // Cup tap = select / deselect for bonus removal
        $target.querySelectorAll('[data-cup-id]').forEach(el => {
          el.addEventListener('click', () => {
            const ok = selectBonusCup(g, el.dataset.cupId);
            if (!ok) toast(`Pick exactly ${g.bonusRequired} cup${g.bonusRequired !== 1 ? 's' : ''}`);
            refreshBonusVisuals();
          });
        });
        refreshBonusVisuals();
      }
    }
  }

  // ── Controls visibility ─────────────────────────────────────────────────
  const throwCtrl  = document.getElementById('controls-throw');
  const bonusCtrl  = document.getElementById('controls-bonus');
  const inThrow    = g.phase === 'throw1' || g.phase === 'throw2';

  if (throwCtrl)  throwCtrl.style.display  = inThrow  && _isParticipant ? 'block' : 'none';
  if (bonusCtrl)  bonusCtrl.style.display  = g.phase === 'bonus' && _isParticipant ? 'block' : 'none';

  // ── Thrower chips ───────────────────────────────────────────────────────
  if (inThrow && _isParticipant) {
    const chipsEl   = document.getElementById('thrower-chips');
    const hintEl    = document.getElementById('thrower-hint');
    const teamParts = g.participants[g.throwingTeam];
    const activeIdx = g.currentThrowerIdx[g.throwingTeam];

    if (chipsEl) {
      chipsEl.innerHTML = teamParts.map((p, i) => {
        const name = p.profiles?.display_name ?? '?';
        const active = i === activeIdx;
        return `<div class="thrower-chip" data-idx="${i}"
          style="padding:8px 14px; border-radius:99px; font-size:13px; font-weight:600;
                 cursor:pointer; border:1.5px solid ${active ? atkColor : 'var(--line)'};
                 background:${active ? `rgba(${g.throwingTeam === 'A' ? '226,64,45' : '61,134,198'},0.15)` : 'var(--surface)'};
                 color:${active ? atkColor : 'var(--text-dim)'};">
          ${name}
        </div>`;
      }).join('');

      // If suggested, show hint
      if (hintEl && teamParts.length > 1) {
        hintEl.textContent = `💡 Suggested: ${teamParts[activeIdx]?.profiles?.display_name ?? '?'} — tap to change`;
        hintEl.style.display = 'block';
      }

      // Wire thrower chip clicks
      chipsEl.querySelectorAll('.thrower-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          _state.currentThrowerIdx[_state.throwingTeam] = Number(chip.dataset.idx);
          updateUI();
        });
      });
    }
  }

  // ── Re-rack button ──────────────────────────────────────────────────────
  const rerackArea = document.getElementById('rerack-area');
  if (rerackArea) {
    const canRerack = _isParticipant &&
      g.phase === 'throw1' &&
      g.pendingPair.throws.length === 0 &&
      !_rerackUsed[g.throwingTeam];
    rerackArea.style.display = canRerack ? 'block' : 'none';
  }

  // ── Dodge toggle visual ─────────────────────────────────────────────────
  const dodgeBtn = document.getElementById('dodge-toggle');
  if (dodgeBtn) {
    dodgeBtn.textContent    = `🛡️ Dodge: ${_dodgeArmed ? 'ON' : 'off'}`;
    dodgeBtn.style.background   = _dodgeArmed ? 'var(--red-dim)' : 'var(--surface)';
    dodgeBtn.style.color        = _dodgeArmed ? '#E8897C' : 'var(--text-dim)';
    dodgeBtn.style.border       = _dodgeArmed
      ? '1.5px solid rgba(226,64,45,0.55)'
      : '1.5px dashed var(--line)';
  }

  // ── Bonus count + confirm ───────────────────────────────────────────────
  if (g.phase === 'bonus') {
    const countEl   = document.getElementById('bonus-count');
    const confirmEl = document.getElementById('bonus-confirm');
    if (countEl) countEl.textContent = `${g.bonusSelected.length} of ${g.bonusRequired} selected`;
    if (confirmEl) confirmEl.disabled = g.bonusSelected.length !== g.bonusRequired;
  }

  // ── Undo button ─────────────────────────────────────────────────────────
  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) undoBtn.disabled = g.undoStack.length === 0;

  renderThrowLog();
}

// Refresh only the bonus-cup fill colours without re-rendering the whole rack
function refreshBonusVisuals() {
  if (!_state) return;
  const $target = document.getElementById('rack-target');
  if (!$target) return;

  $target.querySelectorAll('circle[data-cup-id]').forEach(circle => {
    const selected = _state.bonusSelected.includes(circle.dataset.cupId);
    circle.setAttribute('fill',   selected ? 'var(--green)' : 'var(--blue)');
    circle.setAttribute('stroke', selected ? 'rgba(116,182,135,0.5)' : 'rgba(255,255,255,0.15)');
    circle.setAttribute('stroke-width', selected ? '3' : '2');
  });

  const confirmEl = document.getElementById('bonus-confirm');
  if (confirmEl) {
    const ready = _state.bonusSelected.length === _state.bonusRequired;
    confirmEl.disabled   = !ready;
    confirmEl.textContent = ready
      ? `Confirm removal (${_state.bonusSelected.length})`
      : `Confirm removal (${_state.bonusSelected.length}/${_state.bonusRequired})`;
  }

  const countEl = document.getElementById('bonus-count');
  if (countEl)
    countEl.textContent = `${_state.bonusSelected.length} of ${_state.bonusRequired} selected`;
}

function renderThrowLog() {
  const $log = document.getElementById('throw-log');
  if (!$log || !_state) return;
  const entries = [...(_state.allThrows ?? [])].reverse().slice(0, 30);
  if (!entries.length) {
    $log.innerHTML = '<p style="color:var(--text-faint);">No throws yet</p>';
    return;
  }
  const icons = { hit: '🎯', miss: '○', airball: '💨' };
  $log.innerHTML = entries.map(t => {
    const name    = _participantName(t.thrower_user_id);
    const icon    = t.isDodge ? '🛡️' : (icons[t.outcome] ?? '·');
    const summary = t.outcome === 'hit'
      ? (t.isDodge ? 'dodge hit' : 'hit')
      : t.outcome;
    return `<div style="padding:0.2rem 0; border-bottom:1px solid var(--surface-2);">
      <span style="color:var(--text-faint);">#${t.sequence_no}</span>
      ${icon}
      <span style="color:var(--text);">${name}</span>
      <span style="color:var(--text-faint); font-size:0.7rem;"> ${summary}</span>
    </div>`;
  }).join('');
}

function _participantName(userId) {
  if (!_state || !userId) return '?';
  const all = [...(_state.participants.A ?? []), ...(_state.participants.B ?? [])];
  return all.find(p => p.user_id === userId)?.profiles?.display_name ?? '?';
}

// ─── Static (once-per-render) event handlers ─────────────────────────────

function attachStaticHandlers() {
  // Dodge toggle
  document.getElementById('dodge-toggle')?.addEventListener('click', () => {
    _dodgeArmed = !_dodgeArmed;
    updateUI();
  });

  // Miss / Airball
  document.querySelectorAll('.miss-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (_throwing) return;
      persistThrow(btn.dataset.outcome, null);
    });
  });

  // Bonus confirm
  document.getElementById('bonus-confirm')?.addEventListener('click', async () => {
    if (_throwing) return;
    _throwing = true;

    const removedIds = confirmBonusRemoval(_state);
    if (!removedIds) { _throwing = false; return; }

    updateUI();

    // Persist bonus cup removals to DB
    for (const cupId of removedIds) {
      await supabase
        .from('cups')
        .update({ status: 'hit' })
        .eq('id', cupId)
        .eq('status', 'standing');
    }

    _throwing = false;

    if (_state.status === 'complete') {
      await finalizeGame(_gameId, _state.winner);
      navigate(`#/game/${_gameId}/complete`);
    }
  });

  // Undo
  document.getElementById('undo-btn')?.addEventListener('click', () => {
    _state = doUndo(_state);
    _dodgeArmed = false;
    updateUI();
  });

  // Re-rack
  document.getElementById('rerack-btn')?.addEventListener('click', () => {
    if (!_state) return;
    const defending = _state.throwingTeam === 'A' ? 'B' : 'A';
    navigate(`#/game/${_gameId}/rerack?team=${defending}`);
  });
}

// ─── Throw persistence ────────────────────────────────────────────────────

async function persistThrow(outcome, cupId) {
  if (!_state || _throwing) return;
  _throwing = true;

  const throwerId = currentThrower(_state)?.user_id ?? currentUser?.id;
  const isDodge   = outcome === 'hit' ? _dodgeArmed : false;
  _dodgeArmed     = false;  // reset after every throw

  try {
    logThrow(_state, outcome, cupId, throwerId, isDodge);
  } catch (err) {
    toast(err.message, 'error');
    _throwing = false;
    return;
  }

  updateUI();

  // Persist to DB — always before any navigation
  const { error } = await writeThrow(outcome, cupId, throwerId);
  if (error) toast(`Sync error: ${error}`, 'error');

  _throwing = false;

  if (_state.status === 'complete') {
    await finalizeGame(_gameId, _state.winner);
    navigate(`#/game/${_gameId}/complete`);
  }
}

// ─── Supabase writes ────────────────────────────────────────────────────────

async function writeThrow(outcome, cupId, throwerId) {
  if (!_state) return { error: 'No game state' };
  const seqNo = _state.allThrows.length;

  const throwRow = {
    game_id:         _gameId,
    sequence_no:     seqNo,
    thrower_type:    'user',
    thrower_user_id: throwerId,
    throwing_team:   _state.throwingTeam,
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
      if (throwErr.code === '23505' && attempt === 0) continue;
      return { error: throwErr.message };
    }

    if (outcome === 'hit' && cupId) {
      const { error: cupErr } = await supabase
        .from('cups')
        .update({ status: 'hit' })
        .eq('id', cupId)
        .eq('status', 'standing');
      if (cupErr) return { error: cupErr.message };

      await supabase
        .from('throw_cups')
        .insert({ throw_id: throwData.id, cup_id: cupId });
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
  const [gameRes, cupsRes, participantsRes, throwsRes, reRacksRes] = await Promise.all([
    supabase.from('games').select('*').eq('id', gameId).single(),
    supabase.from('cups').select('*').eq('game_id', gameId),
    supabase.from('game_participants')
      .select('*, profiles(display_name)')
      .eq('game_id', gameId),
    supabase.from('throws').select('*').eq('game_id', gameId).order('sequence_no'),
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
