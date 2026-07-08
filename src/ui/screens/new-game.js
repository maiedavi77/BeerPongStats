/**
 * src/ui/screens/new-game.js
 *
 * New game inside an event (route: /event/:eventId/game/new).
 * The player picker offers this event's MEMBERS and GUESTS (combo box: full
 * list on focus, local filter). Typing an unknown name offers "Add guest",
 * which creates an event_temp_users row on the spot.
 *
 * Team entries are { type: 'user'|'temp', id, name }.
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
import { rememberFirstTeam } from '../../game-sync.js';
import { eventMembers, eventGuests, createGuest, amParticipant, getEvent, eventOpen, eventClosedReason } from '../../events-data.js';
import { esc } from '../../format.js';
import { avatarHtml } from '../../photos.js';

export default async function render($el, params) {
  const eventId = params.eventId;
  if (!eventId) { navigate('#/'); return; }

  if (!(await amParticipant(eventId))) {
    $el.innerHTML = `<div class="empty-state"><h2>Members only</h2>
      <p style="color:var(--text-faint);">Only event members can start games.</p></div>`;
    return;
  }

  const { event } = await getEvent(eventId);
  if (event?.is_tournament) {
    $el.innerHTML = `<div class="empty-state"><h2>Tournament event</h2>
      <p style="color:var(--text-faint);">Games are started from the bracket, not manually.</p>
      <a class="btn btn-ghost" href="#/event/${eventId}/bracket">🏆 Open bracket</a></div>`;
    return;
  }
  if (!eventOpen(event)) {
    $el.innerHTML = `<div class="empty-state"><h2>Event closed</h2>
      <p style="color:var(--text-faint);">${eventClosedReason(event)} — no new games can be started.</p>
      <a class="btn btn-ghost" href="#/event/${eventId}">‹ Back to event</a></div>`;
    return;
  }

  $el.innerHTML = `
    <div class="screen-narrow">
      <div style="display:flex; align-items:center; gap:1rem; margin-bottom:1.5rem;">
        <button id="back-btn" class="btn-secondary" style="width:auto; padding:0.4rem 0.8rem;">← Back</button>
        <h1 style="font-size:2rem; color:var(--purple);">NEW GAME</h1>
      </div>

      <!-- Cup count -->
      <div class="card" style="margin-bottom:1rem;">
        <span class="label">Cups per team</span>
        <div style="display:flex; gap:0.75rem;">
          <button class="cup-btn btn-primary" data-cups="10" style="flex:1;">10 Cups</button>
          <button class="cup-btn btn-secondary" data-cups="6" style="flex:1;">6 Cups</button>
        </div>
      </div>

      <!-- Team A -->
      <div class="card" style="margin-bottom:1rem;">
        <div class="field">
          <label class="label" for="team-a-name">Team A name</label>
          <input type="text" id="team-a-name" value="Team A" maxlength="30" />
        </div>
        <span class="label">Players (1–4)</span>
        <div id="team-a-players" style="min-height:2rem; margin-bottom:0.5rem;"></div>
        <div style="display:flex; gap:0.5rem;">
          <input type="text" id="search-a" placeholder="Select members, guests, or type a new guest…" autocomplete="off" />
          <button id="add-me-a" class="btn-secondary" style="width:auto; white-space:nowrap; padding:0.5rem 0.75rem; font-size:0.8rem;">+ Me</button>
        </div>
        <div id="results-a" style="margin-top:0.4rem; max-height:220px; overflow-y:auto;"></div>
      </div>

      <!-- Team B -->
      <div class="card" style="margin-bottom:1rem;">
        <div class="field">
          <label class="label" for="team-b-name">Team B name</label>
          <input type="text" id="team-b-name" value="Team B" maxlength="30" />
        </div>
        <span class="label">Players (1–4)</span>
        <div id="team-b-players" style="min-height:2rem; margin-bottom:0.5rem;"></div>
        <input type="text" id="search-b" placeholder="Select members, guests, or type a new guest…" autocomplete="off" />
        <div id="results-b" style="margin-top:0.4rem; max-height:220px; overflow-y:auto;"></div>
      </div>

      <!-- First throw -->
      <div class="card" style="margin-bottom:1.5rem;">
        <span class="label">Who throws first?</span>
        <div style="display:flex; gap:0.75rem;">
          <button class="first-btn btn-primary" data-team="A" style="flex:1;">Team A</button>
          <button class="first-btn btn-secondary" data-team="B" style="flex:1;">Team B</button>
        </div>
        <p style="font-size:0.7rem; color:var(--text-faint); margin-top:0.5rem;">
          Remembered on this device so a reload keeps the right side on the ball.
        </p>
      </div>

      <div id="form-error" class="error-msg" style="display:none; margin-bottom:0.75rem;"></div>
      <button id="start-btn" class="btn-primary">Start Game</button>
    </div>`;

  document.getElementById('back-btn').addEventListener('click', () => navigate(`#/event/${eventId}`));

  // Keep "who throws first" labels synced with team names
  const syncFirstLabels = () => {
    const a = document.getElementById('team-a-name').value.trim() || 'Team A';
    const b = document.getElementById('team-b-name').value.trim() || 'Team B';
    document.querySelector('.first-btn[data-team="A"]').textContent = a;
    document.querySelector('.first-btn[data-team="B"]').textContent = b;
  };
  document.getElementById('team-a-name').addEventListener('input', syncFirstLabels);
  document.getElementById('team-b-name').addEventListener('input', syncFirstLabels);

  // ─── State ────────────────────────────────────────────────────────────
  let cupCount = 10;
  let firstTeam = 'A';
  const teams = { A: [], B: [] }; // entries: { type:'user'|'temp', id, name }
  const entryKey = e => `${e.type}:${e.id}`;

  // ─── Cup count / first team toggles ───────────────────────────────────
  document.querySelectorAll('.cup-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      cupCount = parseInt(btn.dataset.cups);
      document.querySelectorAll('.cup-btn').forEach(b => {
        b.className = b.dataset.cups === btn.dataset.cups ? 'cup-btn btn-primary' : 'cup-btn btn-secondary';
        b.style.flex = '1';
      });
    });
  });

  document.querySelectorAll('.first-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      firstTeam = btn.dataset.team;
      document.querySelectorAll('.first-btn').forEach(b => {
        b.className = b.dataset.team === firstTeam ? 'first-btn btn-primary' : 'first-btn btn-secondary';
        b.style.flex = '1';
      });
    });
  });

  document.getElementById('add-me-a').addEventListener('click', () => {
    if (currentUser) addPlayer('A', { type: 'user', id: currentUser.id, name: currentUser.display_name, avatar: currentUser.avatar_path ?? null });
  });

  // ─── Picker options: event members + guests ───────────────────────────
  const [{ members }, guestsRes] = await Promise.all([eventMembers(eventId), eventGuests(eventId)]);
  const options = [
    ...members
      .filter(m => m.profiles?.is_active)
      .map(m => ({ type: 'user', id: m.user_id, name: m.profiles.display_name, avatar: m.profiles.avatar_path ?? null })),
    ...(guestsRes.guests ?? [])
      .map(g => ({ type: 'temp', id: g.id, name: g.display_name })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  ['A', 'B'].forEach(team => {
    const input = document.getElementById(`search-${team.toLowerCase()}`);
    input.addEventListener('focus', () => renderPlayerOptions(team, input.value.trim()));
    input.addEventListener('click', () => renderPlayerOptions(team, input.value.trim()));
    input.addEventListener('input', () => renderPlayerOptions(team, input.value.trim()));
  });

  const onDocClick = e => {
    ['a', 'b'].forEach(t => {
      const input = document.getElementById(`search-${t}`);
      const results = document.getElementById(`results-${t}`);
      if (input && results && !input.contains(e.target) && !results.contains(e.target)) {
        results.innerHTML = '';
      }
    });
  };
  document.addEventListener('click', onDocClick);

  function renderPlayerOptions(team, query) {
    const $results = document.getElementById(`results-${team.toLowerCase()}`);
    if (!$results) return;

    const takenKeys = new Set([...teams.A, ...teams.B].map(entryKey));
    const q = query.toLowerCase();
    const visible = options.filter(o =>
      !takenKeys.has(entryKey(o)) &&
      (q === '' || o.name.toLowerCase().includes(q)));

    const exactMatch = options.some(o => o.name.toLowerCase() === q);
    const addGuestRow = query && !exactMatch
      ? `<div id="add-guest-${team}" style="padding:0.5rem 0.75rem; background:var(--amber-dim);
           border:1px dashed var(--amber); border-radius:8px; margin-bottom:0.3rem;
           cursor:pointer; font-size:0.875rem; color:var(--amber);">
           ➕ Add guest "${esc(query)}"</div>`
      : '';

    $results.innerHTML = addGuestRow + visible.map(o => `
      <div class="picker-row-avatar" data-ptype="${o.type}" data-pid="${o.id}" data-name="${esc(o.name)}" data-team="${team}"
        style="display:flex; align-items:center; gap:0.5rem; padding:0.45rem 0.75rem;
               background:var(--surface-2); border-radius:8px;
               margin-bottom:0.3rem; cursor:pointer; font-size:0.875rem;"
        onmouseenter="this.style.background='var(--surface-3)'"
        onmouseleave="this.style.background='var(--surface-2)'">
        ${avatarHtml(o.name, o.avatar)}
        <span>${esc(o.name)}${o.type === 'temp' ? ' <span style="font-size:0.65rem; color:var(--text-faint);">(guest)</span>' : ''}</span>
      </div>`).join('');

    if (!visible.length && !addGuestRow) {
      $results.innerHTML = `<div style="padding:0.5rem 0.75rem; color:var(--text-faint); font-size:0.8rem;">
        ${options.length ? 'No matching players' : 'No members in this event'}</div>`;
    }

    $results.querySelectorAll('[data-pid]').forEach(el => {
      el.addEventListener('click', () => {
        const opt = options.find(o => o.type === el.dataset.ptype && String(o.id) === el.dataset.pid);
        addPlayer(el.dataset.team, { type: el.dataset.ptype, id: el.dataset.pid, name: el.dataset.name, avatar: opt?.avatar ?? null });
        document.getElementById(`search-${team.toLowerCase()}`).value = '';
        renderPlayerOptions(team, '');
      });
    });

    // Create a brand-new guest and add them to the team
    $results.querySelector(`#add-guest-${team}`)?.addEventListener('click', async () => {
      const { guest, error } = await createGuest(eventId, query);
      if (error) { toast(`Could not add guest: ${error}`, 'error'); return; }
      options.push({ type: 'temp', id: guest.id, name: guest.display_name });
      options.sort((a, b) => a.name.localeCompare(b.name));
      addPlayer(team, { type: 'temp', id: guest.id, name: guest.display_name });
      document.getElementById(`search-${team.toLowerCase()}`).value = '';
      renderPlayerOptions(team, '');
    });
  }

  function addPlayer(team, entry) {
    if (teams[team].length >= 4) { toast('Max 4 players per team', 'error'); return; }
    const key = entryKey(entry);
    if ([...teams.A, ...teams.B].some(e => entryKey(e) === key)) {
      toast('Player already in a team', 'error'); return;
    }
    teams[team].push(entry);
    renderPlayers(team);
  }

  function removePlayer(team, key) {
    teams[team] = teams[team].filter(e => entryKey(e) !== key);
    renderPlayers(team);
    ['a', 'b'].forEach(t => {
      const results = document.getElementById(`results-${t}`);
      if (results && results.innerHTML !== '') {
        renderPlayerOptions(t.toUpperCase(), document.getElementById(`search-${t}`)?.value.trim() ?? '');
      }
    });
  }

  function renderPlayers(team) {
    const $box = document.getElementById(`team-${team.toLowerCase()}-players`);
    if (!$box) return;
    $box.innerHTML = teams[team].map(e => `
      <div class="picker-row-avatar" style="display:flex; align-items:center; justify-content:space-between;
                  background:var(--surface-2); border-radius:8px; padding:0.4rem 0.75rem;
                  margin-bottom:0.3rem; font-size:0.875rem;">
        <span style="display:inline-flex; align-items:center; gap:0.5rem;">${avatarHtml(e.name, e.avatar)}
          <span>${esc(e.name)}${e.type === 'temp' ? ' <span style="font-size:0.65rem; color:var(--text-faint);">(guest)</span>' : ''}</span>
        </span>
        <button data-key="${entryKey(e)}" data-team="${team}"
          style="background:none; color:var(--text-faint); padding:0; font-size:1rem; border-radius:50%; width:1.5rem; height:1.5rem;">✕</button>
      </div>`).join('');
    $box.querySelectorAll('[data-key]').forEach(btn => {
      btn.addEventListener('click', () => removePlayer(btn.dataset.team, btn.dataset.key));
    });
  }

  // ─── Submit ───────────────────────────────────────────────────────────
  document.getElementById('start-btn').addEventListener('click', async () => {
    const errorEl = document.getElementById('form-error');
    errorEl.style.display = 'none';

    if (teams.A.length === 0 || teams.B.length === 0) {
      errorEl.textContent = 'Each team needs at least 1 player.';
      errorEl.style.display = 'block';
      return;
    }

    const startBtn = document.getElementById('start-btn');
    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';

    const { gameId, error } = await createGame({ eventId, cupCount, teams });

    if (error) {
      startBtn.disabled = false;
      startBtn.textContent = 'Start Game';
      errorEl.textContent = error;
      errorEl.style.display = 'block';
      return;
    }

    rememberFirstTeam(gameId, firstTeam);
    navigate(`#/game/${gameId}`);
  });

  return () => document.removeEventListener('click', onDocClick);
}

// ─── Game creation ──────────────────────────────────────────────────────────

async function createGame({ eventId, cupCount, teams }) {
  const userId = currentUser?.id;
  if (!userId) return { error: 'Not logged in' };

  // 1. Game row (scoped to the event)
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .insert({ event_id: eventId, cup_count: cupCount, status: 'active', started_by: userId })
    .select('id')
    .single();
  if (gameErr) return { error: gameErr.message };
  const gameId = game.id;

  // 2. Participants first (cups RLS checks participation)
  const participantRows = [];
  for (const team of ['A', 'B']) {
    teams[team].forEach((e, idx) => {
      participantRows.push({
        game_id: gameId,
        team,
        participant_type: e.type,
        user_id: e.type === 'user' ? e.id : null,
        temp_user_id: e.type === 'temp' ? e.id : null,
        throw_order: idx,
      });
    });
  }
  const { error: partErr } = await supabase.from('game_participants').insert(participantRows);
  if (partErr) return { error: partErr.message };

  // 3. Cups
  const cupRows = [];
  for (const team of ['A', 'B']) {
    for (let pos = 0; pos < cupCount; pos++) {
      cupRows.push({ game_id: gameId, team, rack_position: pos, status: 'standing' });
    }
  }
  const { error: cupsErr } = await supabase.from('cups').insert(cupRows);
  if (cupsErr) return { error: cupsErr.message };

  return { gameId };
}
