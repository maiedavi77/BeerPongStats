/**
 * src/ui/screens/trichter.js
 *
 * Drink timer (Trichter = German for funnel, the drinking device).
 * Start → running ms timer → Stop → assign player → Save.
 * Shows history of recorded trichters, newest first.
 */

import { supabase, currentUser } from '../../supabase.js';
import { toast } from '../components/toast.js';

// Timer state (module-level so it survives re-renders within the same session)
let _timerInterval = null;
let _startTime = null;
let _elapsed = 0;

export default async function render($el) {
  $el.innerHTML = `
    <div>
      <h1 style="font-size:2.5rem; color:var(--purple); margin-bottom:1.5rem;">TRICHTER</h1>

      <!-- Timer display -->
      <div class="card" style="text-align:center; margin-bottom:1rem; padding:2rem 1rem;">
        <div id="timer-display" style="
          font-family:'Bebas Neue',sans-serif;
          font-size:4rem;
          color:var(--text);
          letter-spacing:0.05em;
          line-height:1;
          margin-bottom:1rem;
        ">0:00.0</div>
        <button id="start-stop-btn" class="btn-primary" style="font-size:1.1rem; padding:0.75rem 2rem;">
          Start
        </button>
      </div>

      <!-- Save form (shown after stopping) -->
      <div id="save-form" style="display:none;">
        <div class="card" style="margin-bottom:1rem; border:1px solid var(--amber);">
          <p style="color:var(--text-dim); font-size:0.875rem; margin-bottom:1rem;">
            Record this as a Trichter for:
          </p>
          <div class="field">
            <label class="label" for="player-search">Player</label>
            <input type="text" id="player-search" placeholder="Select a player or type a name…" autocomplete="off" />
            <div id="player-results" style="margin-top:0.3rem; max-height:220px; overflow-y:auto;"></div>
            <input type="hidden" id="selected-user-id" value="" />
            <div id="selected-player-display" style="display:none; font-size:0.8rem; color:var(--green); margin-top:0.4rem;"></div>
          </div>
          <div id="save-error" class="error-msg" style="display:none; margin-bottom:0.75rem;"></div>
          <div style="display:flex; gap:0.5rem;">
            <button id="save-btn" class="btn-primary" style="flex:1; background:var(--amber); color:#000;">
              Save
            </button>
            <button id="discard-btn" class="btn-secondary" style="flex:1;">Discard</button>
          </div>
        </div>
      </div>

      <!-- History -->
      <div>
        <span class="label">Recent Trichters</span>
        <div id="trichter-history">
          <div class="empty-state"><p style="color:var(--text-faint);">Loading…</p></div>
        </div>
      </div>
    </div>`;

  // Restore timer display if already running (navigated away and back)
  if (_timerInterval) {
    _elapsed = Date.now() - _startTime;
    updateDisplay();
    document.getElementById('start-stop-btn').textContent = 'Stop';
    document.getElementById('start-stop-btn').style.background = 'var(--red)';
    _timerInterval = setInterval(tick, 100);
  }

  // Load all active players once — the picker shows the full list on focus
  // and filters locally (same combo-box pattern as the new-game screen).
  const { data: playerData } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('is_active', true)
    .order('display_name');

  attachTimerHandlers();
  const removePickerListener = attachSaveHandlers(playerData ?? []);
  await loadHistory();

  // Teardown: clear interval if navigating away while running
  return () => {
    if (_timerInterval) {
      clearInterval(_timerInterval);
      _timerInterval = null;
    }
    removePickerListener?.();
  };
}

// ── Timer logic ──────────────────────────────────────────────────────────

function tick() {
  _elapsed = Date.now() - _startTime;
  updateDisplay();
}

function updateDisplay() {
  const el = document.getElementById('timer-display');
  if (!el) return;
  el.textContent = formatDuration(_elapsed);
}

function attachTimerHandlers() {
  const btn = document.getElementById('start-stop-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (_timerInterval) {
      // Stop
      clearInterval(_timerInterval);
      _timerInterval = null;
      _elapsed = Date.now() - _startTime;
      updateDisplay();
      btn.textContent = 'Start';
      btn.style.background = '';

      // Show save form
      document.getElementById('save-form').style.display = 'block';
    } else {
      // Start
      _startTime = Date.now() - _elapsed; // resume from current elapsed
      _timerInterval = setInterval(tick, 100);
      btn.textContent = 'Stop';
      btn.style.background = 'var(--red)';

      // Hide save form if showing
      document.getElementById('save-form').style.display = 'none';
    }
  });
}

// ── Save form ─────────────────────────────────────────────────────────────

function attachSaveHandlers(allPlayers) {
  let selectedUser = null;

  const searchInput = document.getElementById('player-search');
  if (!searchInput) return null;

  const renderOptions = query => {
    const $results = document.getElementById('player-results');
    if (!$results) return;

    const q = query.toLowerCase();
    const options = allPlayers.filter(p =>
      q === '' || p.display_name.toLowerCase().includes(q));

    if (!options.length) {
      // No match — the typed text can still be saved as a free name.
      $results.innerHTML = query
        ? `<div style="padding:0.4rem 0.75rem; color:var(--text-faint); font-size:0.8rem;">
             No registered player — "${query.replace(/</g,'&lt;')}" will be saved as a name</div>`
        : '';
      return;
    }

    $results.innerHTML = options.map(p => `
      <div data-uid="${p.id}" data-name="${p.display_name.replace(/"/g,'&quot;')}"
        style="padding:0.4rem 0.75rem; background:var(--surface-2); border-radius:8px;
               margin-bottom:0.25rem; cursor:pointer; font-size:0.875rem;"
        onmouseenter="this.style.background='var(--surface-3)'"
        onmouseleave="this.style.background='var(--surface-2)'"
      >${p.display_name}</div>`).join('');

    $results.querySelectorAll('[data-uid]').forEach(el => {
      el.addEventListener('click', () => {
        selectedUser = { id: el.dataset.uid, name: el.dataset.name };
        document.getElementById('selected-user-id').value = el.dataset.uid;
        searchInput.value = el.dataset.name;
        $results.innerHTML = '';
        const display = document.getElementById('selected-player-display');
        display.textContent = `✓ ${el.dataset.name}`;
        display.style.display = 'block';
      });
    });
  };

  // Full list on focus/tap; local filter while typing. Typing clears any
  // previous selection (the text may be a free name for someone unregistered).
  searchInput.addEventListener('focus', () => renderOptions(searchInput.value.trim()));
  searchInput.addEventListener('click', () => renderOptions(searchInput.value.trim()));
  searchInput.addEventListener('input', () => {
    selectedUser = null;
    document.getElementById('selected-user-id').value = '';
    document.getElementById('selected-player-display').style.display = 'none';
    renderOptions(searchInput.value.trim());
  });

  // Close the dropdown when tapping outside the picker
  const onDocClick = e => {
    const $results = document.getElementById('player-results');
    if ($results && !searchInput.contains(e.target) && !$results.contains(e.target)) {
      $results.innerHTML = '';
    }
  };
  document.addEventListener('click', onDocClick);

  document.getElementById('save-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('save-error');
    errEl.style.display = 'none';

    const personName = document.getElementById('player-search').value.trim();
    const personUserId = document.getElementById('selected-user-id').value || null;

    if (!personName) {
      errEl.textContent = 'Please enter or select a player name.';
      errEl.style.display = 'block';
      return;
    }

    if (_elapsed < 100) {
      errEl.textContent = 'Duration too short — start the timer first.';
      errEl.style.display = 'block';
      return;
    }

    const saveBtn = document.getElementById('save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    const { error } = await supabase.from('trichters').insert({
      person_name: personName,
      person_user_id: personUserId,
      duration_ms: Math.round(_elapsed),
      logged_by: currentUser.id,
      event_id: null,
    });

    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';

    if (error) {
      errEl.textContent = 'Failed to save. Please try again.';
      errEl.style.display = 'block';
      return;
    }

    // Reset everything
    _elapsed = 0;
    _startTime = null;
    updateDisplay();
    document.getElementById('save-form').style.display = 'none';
    document.getElementById('player-search').value = '';
    document.getElementById('selected-user-id').value = '';
    document.getElementById('selected-player-display').style.display = 'none';
    document.getElementById('start-stop-btn').textContent = 'Start';

    toast('Trichter saved! 🍻', 'success');
    await loadHistory();
  });

  document.getElementById('discard-btn').addEventListener('click', () => {
    _elapsed = 0;
    _startTime = null;
    updateDisplay();
    document.getElementById('save-form').style.display = 'none';
    document.getElementById('player-search').value = '';
    document.getElementById('selected-user-id').value = '';
    document.getElementById('selected-player-display').style.display = 'none';
  });

  return () => document.removeEventListener('click', onDocClick);
}

// ── History ──────────────────────────────────────────────────────────────

async function loadHistory() {
  const $history = document.getElementById('trichter-history');
  if (!$history) return;

  const { data, error } = await supabase
    .from('trichters')
    .select('id, person_name, duration_ms, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !data?.length) {
    $history.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">No trichters recorded yet.</p></div>`;
    return;
  }

  $history.innerHTML = data.map(t => `
    <div class="card" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.4rem;">
      <span style="font-weight:500;">${t.person_name}</span>
      <span style="
        font-family:'Bebas Neue',sans-serif;
        font-size:1.4rem;
        color:var(--amber);
        letter-spacing:0.04em;
      ">${formatDuration(t.duration_ms)}</span>
    </div>`).join('');
}

// ── Formatting ────────────────────────────────────────────────────────────

/**
 * Format milliseconds as M:SS.d
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}
