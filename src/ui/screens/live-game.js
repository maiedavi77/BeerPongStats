/**
 * src/ui/screens/live-game.js
 *
 * Live game scoring screen — v1.052 layout and flow on the Supabase backend.
 *
 * Layout (top → bottom):
 *   live-header (back + step pill) · result banner · score-big (cups TAKEN)
 *   ball-1 recap · bonus banner · re-rack button (defending rack, when
 *   eligible) · pyramid zone (target rack) · attached controls (thrower
 *   chips, dodge toggle, airball/miss) OR bonus confirm · undo/cancel ·
 *   event feed.
 *
 * Rules & persistence: see SPEC.md. Throws persist per pair; undo only
 * rewinds un-persisted actions (the engine clears its stack at every
 * persistence boundary).
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate }              from '../../router.js';
import { toast }                 from '../components/toast.js';
import { renderRack }            from '../components/cup-rack.js';
import { openRerackSheet, hasFormations } from '../components/rerack-sheet.js';
import { subscribeGame }         from '../../realtime.js';
import {
  buildGameState, setThrower, logThrow, doUndo, canUndo,
  toggleBonusCup, confirmBonus, pendingHitCupIds,
  standingCups, cupsTaken, rerackEligible, applyRerack, participantName,
} from '../../game-engine.js';
import {
  loadGameData, recallFirstTeam,
  writePair, writeBonus, writeRerack, writeGameStatus,
} from '../../game-sync.js';

// ─── Module state ────────────────────────────────────────────────────────────
let _g             = null;
let _gameId        = null;
let _unsub         = null;
let _isParticipant = false;
let _busy          = false;
let _dodgeArmed    = false;
let _feed          = [];   // { text, ts } newest first
let _teamNames     = { A: 'Team A', B: 'Team B' };

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const timeShort = ts => {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const teamLabel = team => _teamNames[team] ?? `Team ${team}`;
const feed = text => { _feed.unshift({ text, ts: Date.now() }); };

// ─── Screen entry point ──────────────────────────────────────────────────────

export default async function render($el, { id: gameId }) {
  if (!gameId) { navigate('#/'); return; }
  _gameId = gameId;
  _busy = false;
  _dodgeArmed = false;
  _feed = [];

  $el.innerHTML = `<div class="empty"><span class="big">Loading game…</span></div>`;

  const ok = await rebuildState();
  if (!ok) {
    $el.innerHTML = `<div class="empty"><span class="big">Could not load game</span>Try again from the Play tab.</div>`;
    return;
  }

  _unsub = subscribeGame(gameId, {
    onCupChange: payload => {
      if (!_g || _busy) return;
      // Never clobber a locally in-flight pair or bonus selection.
      if (_g.phase !== 'throw1' || _g.pendingPair.throws.length > 0) return;
      const c = payload.new;
      if (!c) return;
      const cup = [..._g.cups.A, ..._g.cups.B].find(x => x.id === c.id);
      if (cup) { cup.status = c.status; cup.rack_position = c.rack_position; }
      _g.cups.A.sort((a, b) => a.rack_position - b.rack_position);
      _g.cups.B.sort((a, b) => a.rack_position - b.rack_position);
      renderGameView($el);
    },
    onThrowChange: async payload => {
      // Another device is scoring — the DB is the source of truth.
      if (!_g || _busy) return;
      if (payload.new?.logged_by && payload.new.logged_by === currentUser?.id) return;
      await rebuildState();
      renderGameView($el);
    },
    onGameChange: payload => {
      if (payload.new?.status === 'complete') navigate(`#/game/${gameId}/complete`);
      if (payload.new?.status === 'cancelled' && _g) {
        _g.status = 'cancelled'; _g.phase = 'cancelled';
        renderGameView($el);
      }
    },
  });

  renderGameView($el);

  return () => {
    _unsub?.();
    _unsub = null;
    _g = null;
    _busy = false;
    _dodgeArmed = false;
  };
}

async function rebuildState() {
  const { gameRow, cups, participants, throws, reRacks, error } = await loadGameData(_gameId);
  if (error || !gameRow) { toast(error ?? 'Game not found', 'error'); return false; }

  _g = buildGameState(gameRow, cups, participants, throws, reRacks, {
    firstTeam: recallFirstTeam(_gameId),
  });
  _isParticipant = participants.some(p => p.user_id === currentUser?.id);

  // Rebuild the feed from throw history (newest first)
  _feed = [..._g.allThrows].reverse().map(t => ({
    text: `🏐 ${participantName(_g, t.thrower_user_id)} — ${throwText(t)}`,
    ts: Date.now(),
  }));
  return true;
}

// ─── Text helpers ────────────────────────────────────────────────────────────

function stepLabel(g) {
  if (g.phase === 'throw1') return 'ball 1 of 2';
  if (g.phase === 'throw2') return 'ball 2 of 2';
  if (g.phase === 'bonus')  return 'bonus removal';
  return '';
}

function throwText(t) {
  if (t.outcome === 'miss')    return 'miss';
  if (t.outcome === 'airball') return 'airball';
  return t.isDodge ? 'dodge hit 🛡️' : 'hit 🎯';
}

function bonusReasonText(g) {
  const dc = g.bonus.dodgeCount;
  if (dc && g.bonus.sameCup) return `🛡️💥 ${dc} dodge${dc > 1 ? 's' : ''} + same-cup double`;
  if (dc)                    return `🛡️ ${dc} dodge${dc > 1 ? 's' : ''} called`;
  return '💥 Same cup hit twice';
}

// ─── View ────────────────────────────────────────────────────────────────────

function renderGameView($el) {
  const g = _g;
  if (!g) return;

  const tgt = g.throwingTeam === 'A' ? 'B' : 'A';
  const isActive = g.status === 'active';
  const canControl = isActive && _isParticipant;
  const inThrow = g.phase === 'throw1' || g.phase === 'throw2';
  const connected = canControl && (inThrow || g.phase === 'bonus');

  let html = `
    <div class="live-header">
      <button class="back-link" id="back-to-play">‹ All games</button>
      ${isActive ? `<span class="step-pill">${stepLabel(g)}</span>` : ''}
    </div>`;

  if (g.status === 'complete') {
    html += `<div class="result-banner">
      <div class="big">${esc(teamLabel(g.winner))} won it</div>
      <small>${cupsTaken(g, 'A')}–${cupsTaken(g, 'B')} final score</small>
    </div>`;
  }
  if (g.status === 'cancelled') {
    html += `<div class="result-banner" style="background:var(--red-dim); border-color:rgba(226,64,45,0.4);">
      <div class="big" style="color:#E8897C;">Game cancelled</div>
    </div>`;
  }

  html += `<div class="score-big">
    <span class="num A">${cupsTaken(g, 'A')}</span>
    <span class="dash">–</span>
    <span class="num B">${cupsTaken(g, 'B')}</span>
  </div>`;

  if (isActive && g.phase === 'throw2' && g.pendingPair.throws.length > 0) {
    const t1 = g.pendingPair.throws[0];
    html += `<div class="recap">🏐 <b>Ball 1:</b> ${esc(participantName(g, t1.thrower_user_id))} — ${throwText(t1)}</div>`;
  }

  if (isActive && g.phase === 'bonus') {
    html += `<div class="bonus-banner">${bonusReasonText(g)} — pick exactly
      ${g.bonus.required} cup${g.bonus.required === 1 ? '' : 's'} to remove</div>`;
  }

  // Re-rack — defending rack, start of turn only, count must have formations
  const showRerack = canControl &&
    rerackEligible(g, tgt) &&
    hasFormations(g.cupCount, standingCups(g, tgt));
  if (showRerack) {
    const rrCol = tgt === 'A' ? 'var(--red)' : 'var(--blue)';
    html += `<div class="rerack-row">
      <button class="rerack-btn" id="rerack-btn" style="border-color:${rrCol}; color:${rrCol};">
        🔄 Re-rack ${esc(teamLabel(tgt))} — 1× per game
      </button>
    </div>`;
  }

  // Target rack
  const spectatorHint = !_isParticipant && isActive ? ' · spectating' : '';
  html += `<div class="pyramid-zone${connected ? ' connected' : ''}">
    <div class="pz-label">${isActive ? '<b>target</b> — ' : ''}${esc(teamLabel(tgt))}'s cups${spectatorHint}</div>
    <div class="rack-holder" id="rack-target">
      ${renderRack(g.cups[tgt], {
        cupCount: g.cupCount,
        interactive: canControl && (inThrow || g.phase === 'bonus'),
        pendingCupIds: pendingHitCupIds(g),
        bonusSelected: g.bonus.selected,
      })}
    </div>
  </div>`;

  // Controls
  if (canControl && inThrow) {
    const roster = g.participants[g.throwingTeam];
    html += `<div class="controls">
      <div class="ctl-label">who threw this ball — ${esc(teamLabel(g.throwingTeam))}</div>
      <div class="chips">
        ${roster.map(p => `
          <div class="chip${g.selectedThrower === p.user_id ? ' active' : ''}" data-thrower="${esc(p.user_id)}">
            ${esc(p.profiles?.display_name ?? '?')}
          </div>`).join('')}
      </div>
      ${g.throwerIsSuggestion && g.selectedThrower
        ? `<div class="suggest-hint">💡 Suggested: ${esc(participantName(g, g.selectedThrower))} — tap to change</div>`
        : ''}
      <div class="dodge-row">
        <button class="dodge-toggle${_dodgeArmed ? ' armed' : ''}" id="dodge-toggle">
          🛡️ ${_dodgeArmed ? 'Next tap = dodge' : 'Mark as dodge'}
        </button>
      </div>
      <div class="action-row">
        <button class="miss-btn" id="airball-btn">Airball</button>
        <button class="miss-btn" id="miss-btn">Miss</button>
      </div>
    </div>`;
  } else if (canControl && g.phase === 'bonus') {
    const ready = g.bonus.selected.length === g.bonus.required;
    html += `<div class="controls">
      <div class="bonus-count">${g.bonus.selected.length} of ${g.bonus.required} selected</div>
      <button class="btn btn-primary btn-block" id="bonus-confirm" ${ready ? '' : 'disabled'}>Confirm removal</button>
    </div>`;
  }

  if (canControl) {
    html += `<div class="end-controls">
      <button class="btn btn-danger-ghost" id="cancel-game-btn">Cancel game</button>
      <button class="btn btn-ghost" id="undo-btn" ${canUndo(g) ? '' : 'disabled'}>Undo</button>
    </div>`;
  }

  html += `<div class="feed">
    <div class="section-title">Event feed</div>
    ${_feed.slice(0, 40).map(l =>
      `<div class="feed-line"><span>${esc(l.text)}</span><span class="t">${timeShort(l.ts)}</span></div>`).join('')}
    ${_feed.length === 0 ? '<div class="empty">No throws yet</div>' : ''}
  </div>`;

  $el.innerHTML = html;
  attachHandlers($el);
}

// ─── Handlers ────────────────────────────────────────────────────────────────

function attachHandlers($el) {
  const g = _g;

  $el.querySelector('#back-to-play')?.addEventListener('click', () => navigate('#/'));

  $el.querySelectorAll('.chip[data-thrower]').forEach(chip => {
    chip.addEventListener('click', () => {
      setThrower(g, chip.dataset.thrower);
      renderGameView($el);
    });
  });

  $el.querySelector('#dodge-toggle')?.addEventListener('click', () => {
    _dodgeArmed = !_dodgeArmed;
    renderGameView($el);
  });

  $el.querySelector('#airball-btn')?.addEventListener('click', () => handleThrow($el, 'airball', null));
  $el.querySelector('#miss-btn')?.addEventListener('click', () => handleThrow($el, 'miss', null));

  const inThrow = g.phase === 'throw1' || g.phase === 'throw2';
  $el.querySelectorAll('#rack-target [data-cup-id]').forEach(el => {
    el.addEventListener('click', () => {
      if (inThrow) handleThrow($el, 'hit', el.dataset.cupId);
      else if (g.phase === 'bonus') {
        const ok = toggleBonusCup(g, el.dataset.cupId);
        if (!ok) toast(`Only ${g.bonus.required} cup${g.bonus.required === 1 ? '' : 's'} to select`);
        renderGameView($el);
      }
    });
  });

  $el.querySelector('#bonus-confirm')?.addEventListener('click', () => handleBonusConfirm($el));

  $el.querySelector('#undo-btn')?.addEventListener('click', () => {
    if (!canUndo(g)) { toast('Nothing to undo'); return; }
    _g = doUndo(g);
    _dodgeArmed = false;
    if (_feed.length) _feed.shift();
    renderGameView($el);
  });

  $el.querySelector('#cancel-game-btn')?.addEventListener('click', () => {
    confirmSheet('Cancel this game? It won\u2019t count toward stats.', true, async () => {
      const { error } = await writeGameStatus(_gameId, 'cancelled');
      if (error) { toast(`Could not cancel: ${error}`, 'error'); return; }
      navigate('#/');
    });
  });

  $el.querySelector('#rerack-btn')?.addEventListener('click', () => {
    const tgt = g.throwingTeam === 'A' ? 'B' : 'A';
    openRerackSheet({
      team: tgt,
      teamLabel: teamLabel(tgt),
      cupCount: g.cupCount,
      standing: standingCups(g, tgt),
      onConfirm: async (formation, positions) => {
        const remaining = standingCups(g, tgt);
        const updates = applyRerack(g, tgt, positions);
        const { error } = await writeRerack(_gameId, tgt, updates, remaining);
        if (error) {
          toast(`Re-rack failed: ${error}`, 'error');
          await rebuildState();
          renderGameView($el);
          return false;
        }
        feed(`🔄 Re-rack — ${teamLabel(tgt)} → ${formation.name}`);
        renderGameView($el);
        return true;
      },
    });
  });
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function handleThrow($el, outcome, cupId) {
  const g = _g;
  if (!g || _busy) return;

  const isDodge = outcome === 'hit' ? _dodgeArmed : false;
  _dodgeArmed = false;

  let result;
  try {
    result = logThrow(g, outcome, cupId, isDodge);
  } catch (err) {
    toast(err.message, 'error');
    renderGameView($el);
    return;
  }

  const last = g.allThrows[g.allThrows.length - 1];
  feed(`🏐 ${participantName(g, last.thrower_user_id)} — ${throwText(last)}`);

  if (result.resolved) {
    const removed = result.persist.hitCupIds.length;
    if (removed) feed(`🎯 ${removed} cup${removed > 1 ? 's' : ''} removed`);
    if (g.phase === 'bonus') {
      feed(`${bonusReasonText(g)} — ${g.bonus.required} bonus cup${g.bonus.required === 1 ? '' : 's'} owed`);
    } else if (g.status === 'active') {
      feed(g.ballsBack
        ? `🔁 Balls back — ${teamLabel(g.throwingTeam)} throws again`
        : `↪️ Turn over — ${teamLabel(g.throwingTeam)} throws next`);
    }
  }

  renderGameView($el);

  if (!result.resolved) return;

  _busy = true;
  const { error } = await writePair(_gameId, result.persist);
  _busy = false;

  if (error) {
    toast(`Sync error: ${error} — reloading`, 'error');
    await rebuildState();
    renderGameView($el);
    return;
  }

  if (result.persist.complete) {
    feed(`🏆 ${teamLabel(g.winner)} wins!`);
    await writeGameStatus(_gameId, 'complete', g.winner);
    navigate(`#/game/${_gameId}/complete`);
  }
}

async function handleBonusConfirm($el) {
  const g = _g;
  if (!g || _busy) return;

  const res = confirmBonus(g);
  if (!res) return;

  feed(`💥 Bonus: ${res.removedCupIds.length} extra cup${res.removedCupIds.length > 1 ? 's' : ''} removed`);
  renderGameView($el);

  _busy = true;
  const { error } = await writeBonus(res.removedCupIds);
  _busy = false;

  if (error) {
    toast(`Sync error: ${error} — reloading`, 'error');
    await rebuildState();
    renderGameView($el);
    return;
  }

  if (res.complete) {
    feed(`🏆 ${teamLabel(g.winner)} wins!`);
    await writeGameStatus(_gameId, 'complete', g.winner);
    navigate(`#/game/${_gameId}/complete`);
  }
}

// ─── Confirm sheet (v1 confirmDialog) ────────────────────────────────────────

function confirmSheet(msg, danger, onYes) {
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <h2>Are you sure?</h2>
      <p class="confirm-msg">${esc(msg)}</p>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" id="cd-yes">${danger ? 'Yes, do it' : 'Confirm'}</button>
      <button class="btn btn-ghost btn-block" style="margin-top:8px;" id="cd-no">Cancel</button>
    </div>`;
  document.body.appendChild(bd);
  bd.querySelector('#cd-yes').addEventListener('click', () => { bd.remove(); onYes(); });
  bd.querySelector('#cd-no').addEventListener('click', () => bd.remove());
  bd.addEventListener('click', e => { if (e.target === bd) bd.remove(); });
}
