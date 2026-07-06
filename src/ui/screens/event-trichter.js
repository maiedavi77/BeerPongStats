/**
 * src/ui/screens/event-trichter.js
 *
 * Event sub-view: the drink timer, scoped to the event.
 * Start → running ms timer → Stop → assign person → Save (with event_id).
 * The person picker is a combo box over the EVENT's members; free-text
 * names remain allowed for guests. Each trichter can carry one photo.
 */

import { supabase, currentUser } from '../../supabase.js';
import { toast } from '../components/toast.js';
import { eventMembers, eventGuests, createGuest } from '../../events-data.js';
import { formatDuration, esc } from '../../format.js';
import { uploadTrichterPhoto, photoUrl, avatarHtml } from '../../photos.js';

let _timerInterval = null;
let _startTime = null;
let _elapsed = 0;
let _eventId = null;

export default async function render($el, ctx) {
  _eventId = ctx.eventId;
  const { isParticipant } = ctx;

  $el.innerHTML = `
    <div>
      <div class="card" style="text-align:center; margin-bottom:1rem; padding:2rem 1rem;">
        <div id="timer-display" style="
          font-family:'Bebas Neue',sans-serif; font-size:4rem; color:var(--text);
          letter-spacing:0.05em; line-height:1; margin-bottom:1rem;">0:00.0</div>
        ${isParticipant && ctx.open
          ? '<button id="start-stop-btn" class="btn-primary" style="font-size:1.1rem; padding:0.75rem 2rem;">Start</button>'
          : `<p style="color:var(--text-faint); font-size:0.8rem;">${!isParticipant
              ? 'Only event members can record trichters.'
              : ctx.closedReason + ' — no new trichters can be recorded.'}</p>`}
      </div>

      <div id="save-form" style="display:none;">
        <div class="card" style="margin-bottom:1rem; border:1px solid var(--amber);">
          <p style="color:var(--text-dim); font-size:0.875rem; margin-bottom:1rem;">Record this Trichter for:</p>
          <div class="field">
            <label class="label" for="player-search">Person</label>
            <input type="text" id="player-search" placeholder="Select a member or guest, or add a new guest…" autocomplete="off" />
            <div id="player-results" style="margin-top:0.3rem; max-height:220px; overflow-y:auto;"></div>
            <input type="hidden" id="selected-user-id" value="" />
            <div id="selected-player-display" style="display:none; font-size:0.8rem; color:var(--green); margin-top:0.4rem;"></div>
          </div>
          <div class="field">
            <label class="label">Photo (optional, one per trichter)</label>
            <div id="tp-photo-empty">
              <button id="tp-attach-btn" class="btn btn-ghost btn-block" style="font-size:0.85rem;">📷 Attach photo</button>
            </div>
            <div id="tp-photo-preview" style="display:none; align-items:center; gap:0.6rem;">
              <img id="tp-photo-thumb" alt="" style="width:52px; height:52px; object-fit:cover; border-radius:10px; border:1px solid var(--line);" />
              <span id="tp-photo-name" style="flex:1; font-size:0.75rem; color:var(--text-dim); min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></span>
              <button id="tp-photo-remove" style="background:none; color:var(--text-faint); font-size:1rem;">✕</button>
            </div>
          </div>
          <div id="save-error" class="error-msg" style="display:none; margin-bottom:0.75rem;"></div>
          <div style="display:flex; gap:0.5rem;">
            <button id="save-btn" class="btn-primary" style="flex:1; background:var(--amber); color:#000;">Save</button>
            <button id="discard-btn" class="btn-secondary" style="flex:1;">Discard</button>
          </div>
        </div>
      </div>

      <div>
        <span class="label">Recent Trichters</span>
        <div id="trichter-history">
          <div class="empty-state"><p style="color:var(--text-faint);">Loading…</p></div>
        </div>
      </div>
    </div>`;

  if (_timerInterval) {
    _elapsed = Date.now() - _startTime;
    updateDisplay();
    const btn = document.getElementById('start-stop-btn');
    if (btn) { btn.textContent = 'Stop'; btn.style.background = 'var(--red)'; }
    _timerInterval = setInterval(tick, 100);
  }

  // Person picker options: event members + event guests — the same combo
  // box as the new-game player picker.
  const [{ members }, guestsRes] = await Promise.all([
    eventMembers(ctx.eventId),
    eventGuests(ctx.eventId),
  ]);
  const memberOptions = [
    ...members
      .filter(m => m.profiles?.is_active)
      .map(m => ({ type: 'user', id: m.user_id, display_name: m.profiles.display_name, avatar: m.profiles.avatar_path ?? null })),
    ...(guestsRes.guests ?? [])
      .map(g => ({ type: 'temp', id: g.id, display_name: g.display_name, avatar: null })),
  ].sort((a, b) => a.display_name.localeCompare(b.display_name));

  attachTimerHandlers();
  const removePickerListener = (isParticipant && ctx.open) ? attachSaveHandlers(memberOptions, ctx.eventId) : null;
  await loadHistory(ctx);

  return () => {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    removePickerListener?.();
  };
}

// ─── Timer ──────────────────────────────────────────────────────────────────

function tick() { _elapsed = Date.now() - _startTime; updateDisplay(); }

function updateDisplay() {
  const el = document.getElementById('timer-display');
  if (el) el.textContent = formatDuration(_elapsed);
}

function attachTimerHandlers() {
  const btn = document.getElementById('start-stop-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (_timerInterval) {
      clearInterval(_timerInterval);
      _timerInterval = null;
      _elapsed = Date.now() - _startTime;
      updateDisplay();
      btn.textContent = 'Start';
      btn.style.background = '';
      document.getElementById('save-form').style.display = 'block';
    } else {
      _startTime = Date.now() - _elapsed;
      _timerInterval = setInterval(tick, 100);
      btn.textContent = 'Stop';
      btn.style.background = 'var(--red)';
      document.getElementById('save-form').style.display = 'none';
    }
  });
}

// ─── Save form (combo box over event members + free text) ───────────────────

function attachSaveHandlers(memberOptions, eventId) {
  const searchInput = document.getElementById('player-search');
  if (!searchInput) return null;

  // Optional photo, chosen BEFORE saving — uploaded together with the save.
  let pendingPhoto = null;
  let pendingPhotoUrl = null;

  const setPendingPhoto = file => {
    if (pendingPhotoUrl) URL.revokeObjectURL(pendingPhotoUrl);
    pendingPhoto = file ?? null;
    pendingPhotoUrl = file ? URL.createObjectURL(file) : null;
    document.getElementById('tp-photo-empty').style.display = file ? 'none' : 'block';
    const $prev = document.getElementById('tp-photo-preview');
    $prev.style.display = file ? 'flex' : 'none';
    if (file) {
      document.getElementById('tp-photo-thumb').src = pendingPhotoUrl;
      document.getElementById('tp-photo-name').textContent = file.name;
    }
  };

  document.getElementById('tp-attach-btn')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => setPendingPhoto(input.files?.[0] ?? null));
    input.click();
  });
  document.getElementById('tp-photo-remove')?.addEventListener('click', () => setPendingPhoto(null));

  const pick = opt => {
    // Registered member → link the trichter to their account;
    // guest → free name only (trichters have no temp-user column).
    document.getElementById('selected-user-id').value = opt.type === 'user' ? opt.id : '';
    searchInput.value = opt.display_name;
    document.getElementById('player-results').innerHTML = '';
    const display = document.getElementById('selected-player-display');
    display.textContent = `✓ ${opt.display_name}${opt.type === 'temp' ? ' (guest)' : ''}`;
    display.style.display = 'block';
  };

  const renderOptions = query => {
    const $results = document.getElementById('player-results');
    if (!$results) return;
    const q = query.toLowerCase();
    const options = memberOptions.filter(p => q === '' || p.display_name.toLowerCase().includes(q));

    const exactMatch = memberOptions.some(p => p.display_name.toLowerCase() === q);
    const addGuestRow = query && !exactMatch
      ? `<div id="tp-add-guest" style="padding:0.5rem 0.75rem; background:var(--amber-dim);
           border:1px dashed var(--amber); border-radius:8px; margin-bottom:0.25rem;
           cursor:pointer; font-size:0.875rem; color:var(--amber);">
           ➕ Add guest "${esc(query)}"</div>`
      : '';

    $results.innerHTML = addGuestRow + options.map((p, i) => `
      <div class="picker-row-avatar" data-idx="${i}"
        style="display:flex; align-items:center; gap:0.5rem; padding:0.45rem 0.75rem;
               background:var(--surface-2); border-radius:8px;
               margin-bottom:0.25rem; cursor:pointer; font-size:0.875rem;"
        onmouseenter="this.style.background='var(--surface-3)'"
        onmouseleave="this.style.background='var(--surface-2)'">
        ${avatarHtml(p.display_name, p.avatar)}
        <span>${esc(p.display_name)}${p.type === 'temp' ? ' <span style="font-size:0.65rem; color:var(--text-faint);">(guest)</span>' : ''}</span>
      </div>`).join('');

    if (!options.length && !addGuestRow) {
      $results.innerHTML = `<div style="padding:0.4rem 0.75rem; color:var(--text-faint); font-size:0.8rem;">
        ${memberOptions.length ? 'No matching people' : 'No members in this event'}</div>`;
    }

    $results.querySelectorAll('[data-idx]').forEach(el => {
      el.addEventListener('click', () => pick(options[Number(el.dataset.idx)]));
    });

    // Create a brand-new event guest, add to the list, select them
    $results.querySelector('#tp-add-guest')?.addEventListener('click', async () => {
      const { guest, error } = await createGuest(eventId, query);
      if (error) { toast(`Could not add guest: ${error}`, 'error'); return; }
      const opt = { type: 'temp', id: guest.id, display_name: guest.display_name, avatar: null };
      memberOptions.push(opt);
      memberOptions.sort((a, b) => a.display_name.localeCompare(b.display_name));
      pick(opt);
    });
  };

  searchInput.addEventListener('focus', () => renderOptions(searchInput.value.trim()));
  searchInput.addEventListener('click', () => renderOptions(searchInput.value.trim()));
  searchInput.addEventListener('input', () => {
    document.getElementById('selected-user-id').value = '';
    document.getElementById('selected-player-display').style.display = 'none';
    renderOptions(searchInput.value.trim());
  });

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
      errEl.textContent = 'Please select a member or enter a name.';
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

    const { data: inserted, error } = await supabase.from('trichters').insert({
      person_name: personName,
      person_user_id: personUserId,
      duration_ms: Math.round(_elapsed),
      logged_by: currentUser.id,
      event_id: _eventId,
    }).select('id').single();

    if (error) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      errEl.textContent = 'Failed to save. Please try again.';
      errEl.style.display = 'block';
      return;
    }

    // Upload the attached photo (if any) — the trichter itself is saved
    // either way; a failed upload only loses the picture.
    if (pendingPhoto) {
      saveBtn.textContent = 'Uploading photo…';
      const { error: pErr } = await uploadTrichterPhoto(inserted.id, pendingPhoto);
      if (pErr) toast(`Trichter saved, but the photo failed: ${pErr}`, 'error');
    }
    setPendingPhoto(null);

    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    resetForm();
    toast('Trichter saved! 🍻', 'success');
    await loadHistory({ eventId: _eventId, isParticipant: true });
  });

  document.getElementById('discard-btn').addEventListener('click', resetForm);

  return () => document.removeEventListener('click', onDocClick);
}

function resetForm() {
  _elapsed = 0;
  _startTime = null;
  updateDisplay();
  document.getElementById('save-form').style.display = 'none';
  document.getElementById('player-search').value = '';
  document.getElementById('selected-user-id').value = '';
  document.getElementById('selected-player-display').style.display = 'none';
  const btn = document.getElementById('start-stop-btn');
  if (btn) btn.textContent = 'Start';
}

// ─── History (with per-trichter photo) ──────────────────────────────────────

async function loadHistory(ctx) {
  const $history = document.getElementById('trichter-history');
  if (!$history) return;

  const { data, error } = await supabase
    .from('trichters')
    .select('id, person_name, duration_ms, created_at, trichter_photos(id, storage_path)')
    .eq('event_id', ctx.eventId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !data?.length) {
    $history.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">No trichters in this event yet.</p></div>`;
    return;
  }

  $history.innerHTML = data.map(t => {
    const hasPhoto = (t.trichter_photos ?? []).length > 0;
    return `
      <div class="card" style="display:flex; align-items:center; gap:0.75rem; margin-bottom:0.4rem;">
        <span style="flex:1; font-weight:500; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(t.person_name)}</span>
        <span style="font-family:'Bebas Neue',sans-serif; font-size:1.4rem; color:var(--amber); letter-spacing:0.04em;">${formatDuration(t.duration_ms)}</span>
        ${hasPhoto
          ? `<button data-view-photo="${t.trichter_photos[0].storage_path}" title="View photo"
               style="background:none; font-size:1.1rem; padding:0.2rem;">🖼️</button>`
          : ''}
      </div>`;
  }).join('');

  // View photo
  $history.querySelectorAll('[data-view-photo]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = await photoUrl(btn.dataset.viewPhoto);
      if (url) openPhotoViewer(url);
      else toast('Could not load photo', 'error');
    });
  });

}

export function openPhotoViewer(url) {
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.style.alignItems = 'center';
  bd.innerHTML = `
    <img src="${url}" alt="photo" style="max-width:94vw; max-height:86vh; border-radius:14px;
      border:1px solid var(--line); object-fit:contain;" />`;
  bd.addEventListener('click', () => bd.remove());
  document.body.appendChild(bd);
}
