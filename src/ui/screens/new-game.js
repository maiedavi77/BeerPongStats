/**
 * src/ui/screens/new-game.js
 *
 * Game creation form:
 *   1. Select cup count (6 or 10)
 *   2. Enter team names
 *   3. Search and add players to each team (1–4 per side)
 *   4. Select who throws first
 *   5. Submit → INSERT games + cups + game_participants → navigate to live game
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';

export default async function render($el) {
  $el.innerHTML = `
    <div>
      <div style="display:flex; align-items:center; gap:1rem; margin-bottom:1.5rem;">
        <button id="back-btn" class="btn-secondary" style="width:auto; padding:0.4rem 0.8rem;">← Back</button>
        <h1 style="font-size:2rem; color:var(--purple);">NEW GAME</h1>
      </div>

      <!-- Cup count -->
      <div class="card" style="margin-bottom:1rem;">
        <span class="label">Cups per team</span>
        <div style="display:flex; gap:0.75rem;">
          <button class="cup-btn btn-primary" data-cups="6" style="flex:1;">6 Cups</button>
          <button class="cup-btn btn-secondary" data-cups="10" style="flex:1;">10 Cups</button>
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
          <input type="text" id="search-a" placeholder="Search players…" autocomplete="off" />
          <button id="add-me-a" class="btn-secondary" style="width:auto; white-space:nowrap; padding:0.5rem 0.75rem; font-size:0.8rem;">+ Me</button>
        </div>
        <div id="results-a" style="margin-top:0.4rem;"></div>
      </div>

      <!-- Team B -->
      <div class="card" style="margin-bottom:1rem;">
        <div class="field">
          <label class="label" for="team-b-name">Team B name</label>
          <input type="text" id="team-b-name" value="Team B" maxlength="30" />
        </div>
        <span class="label">Players (1–4)</span>
        <div id="team-b-players" style="min-height:2rem; margin-bottom:0.5rem;"></div>
        <input type="text" id="search-b" placeholder="Search players…" autocomplete="off" />
        <div id="results-b" style="margin-top:0.4rem;"></div>
      </div>

      <!-- First throw -->
      <div class="card" style="margin-bottom:1.5rem;">
        <span class="label">Who throws first?</span>
        <div style="display:flex; gap:0.75rem;">
          <button class="first-btn btn-primary" data-team="A" style="flex:1;">Team A</button>
          <button class="first-btn btn-secondary" data-team="B" style="flex:1;">Team B</button>
        </div>
      </div>

      <div id="form-error" class="error-msg" style="display:none; margin-bottom:0.75rem;"></div>
      <button id="start-btn" class="btn-primary">Start Game</button>
    </div>`;

  document.getElementById('back-btn').addEventListener('click', () => navigate('#/'));

  // ─── State ────────────────────────────────────────────────────────────
  let cupCount = 6;
  let firstTeam = 'A';
  const teams = { A: [], B: [] };
  let searchDebounce = {};

  // ─── Cup count toggle ─────────────────────────────────────────────────
  document.querySelectorAll('.cup-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      cupCount = parseInt(btn.dataset.cups);
      document.querySelectorAll('.cup-btn').forEach(b => {
        b.className = b.dataset.cups === btn.dataset.cups ? 'cup-btn btn-primary' : 'cup-btn btn-secondary';
        b.style.flex = '1';
      });
    });
  });

  // ─── First team toggle ────────────────────────────────────────────────
  document.querySelectorAll('.first-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      firstTeam = btn.dataset.team;
      document.querySelectorAll('.first-btn').forEach(b => {
        b.className = b.dataset.team === firstTeam ? 'first-btn btn-primary' : 'first-btn btn-secondary';
        b.style.flex = '1';
      });
    });
  });

  // ─── Add me button ────────────────────────────────────────────────────
  document.getElementById('add-me-a').addEventListener('click', () => {
    if (currentUser) addPlayer('A', { id: currentUser.id, display_name: currentUser.display_name });
  });

  // ─── Player search ────────────────────────────────────────────────────
  ['A', 'B'].forEach(team => {
    const input = document.getElementById(`search-${team.toLowerCase()}`);
    input.addEventListener('input', () => {
      clearTimeout(searchDebounce[team]);
      searchDebounce[team] = setTimeout(() => searchPlayers(team, input.value.trim()), 250);
    });
  });

  async function searchPlayers(team, query) {
    const $results = document.getElementById(`results-${team.toLowerCase()}`);
    if (!$results) return;
    if (query.length < 1) { $results.innerHTML = ''; return; }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name')
      .eq('is_active', true)
      .ilike('display_name', `%${query}%`)
      .limit(5);

    if (error || !data?.length) { $results.innerHTML = ''; return; }

    // Exclude players already on either team
    const allIds = new Set([...teams.A.map(p => p.id), ...teams.B.map(p => p.id)]);
    const filtered = data.filter(p => !allIds.has(p.id));

    $results.innerHTML = filtered.map(p => `
      <div data-pid="${p.id}" data-name="${p.display_name.replace(/"/g,'&quot;')}" data-team="${team}"
        style="padding:0.5rem 0.75rem; background:var(--surface-2); border-radius:8px;
               margin-bottom:0.3rem; cursor:pointer; font-size:0.875rem;"
        onmouseenter="this.style.background='var(--surface-3)'"
        onmouseleave="this.style.background='var(--surface-2)'"
      >${p.display_name}</div>`).join('');

    $results.querySelectorAll('[data-pid]').forEach(el => {
      el.addEventListener('click', () => {
        addPlayer(el.dataset.team, { id: el.dataset.pid, display_name: el.dataset.name });
        document.getElementById(`search-${team.toLowerCase()}`).value = '';
        $results.innerHTML = '';
      });
    });
  }

  function addPlayer(team, player) {
    if (teams[team].length >= 4) { toast('Max 4 players per team', 'error'); return; }
    if (teams.A.find(p => p.id === player.id) || teams.B.find(p => p.id === player.id)) {
      toast('Player already in a team', 'error'); return;
    }
    teams[team].push(player);
    renderPlayers(team);
  }

  function removePlayer(team, playerId) {
    teams[team] = teams[team].filter(p => p.id !== playerId);
    renderPlayers(team);
  }

  function renderPlayers(team) {
    const $el = document.getElementById(`team-${team.toLowerCase()}-players`);
    if (!$el) return;
    $el.innerHTML = teams[team].map(p => `
      <div style="display:flex; align-items:center; justify-content:space-between;
                  background:var(--surface-2); border-radius:8px; padding:0.4rem 0.75rem;
                  margin-bottom:0.3rem; font-size:0.875rem;">
        <span>${p.display_name}</span>
        <button data-pid="${p.id}" data-team="${team}"
          style="background:none; color:var(--text-faint); padding:0; font-size:1rem; border-radius:50%; width:1.5rem; height:1.5rem;">✕</button>
      </div>`).join('');
    $el.querySelectorAll('[data-pid]').forEach(btn => {
      btn.addEventListener('click', () => removePlayer(btn.dataset.team, btn.dataset.pid));
    });
  }

  // ─── Submit ───────────────────────────────────────────────────────────
  document.getElementById('start-btn').addEventListener('click', async () => {
    const errorEl = document.getElementById('form-error');
    errorEl.style.display = 'none';

    const teamAName = document.getElementById('team-a-name').value.trim() || 'Team A';
    const teamBName = document.getElementById('team-b-name').value.trim() || 'Team B';

    if (teams.A.length === 0 || teams.B.length === 0) {
      errorEl.textContent = 'Each team needs at least 1 player.';
      errorEl.style.display = 'block';
      return;
    }

    const startBtn = document.getElementById('start-btn');
    startBtn.disabled = true;
    startBtn.textContent = 'Starting…';

    const { gameId, error } = await createGame({ cupCount, firstTeam, teams, teamAName, teamBName });

    if (error) {
      startBtn.disabled = false;
      startBtn.textContent = 'Start Game';
      errorEl.textContent = error;
      errorEl.style.display = 'block';
      return;
    }

    navigate(`#/game/${gameId}`);
  });
}

// ─── Game creation transaction ────────────────────────────────────────────

async function createGame({ cupCount, firstTeam, teams, teamAName, teamBName }) {
  const userId = currentUser?.id;
  if (!userId) return { error: 'Not logged in' };

  // 1. Insert the game row
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .insert({
      cup_count: cupCount,
      status: 'active',
      started_by: userId,
    })
    .select('id')
    .single();

  if (gameErr) return { error: gameErr.message };

  const gameId = game.id;

  // 2. Bulk insert cups — one row per cup position per team
  const cupRows = [];
  for (const team of ['A', 'B']) {
    for (let pos = 0; pos < cupCount; pos++) {
      cupRows.push({ game_id: gameId, team, rack_position: pos, status: 'standing' });
    }
  }
  const { error: cupsErr } = await supabase.from('cups').insert(cupRows);
  if (cupsErr) return { error: cupsErr.message };

  // 3. Bulk insert game_participants with throw_order
  const participantRows = [];
  for (const team of ['A', 'B']) {
    teams[team].forEach((player, idx) => {
      participantRows.push({
        game_id: gameId,
        team,
        participant_type: 'user',
        user_id: player.id,
        throw_order: idx,
      });
    });
  }
  const { error: partErr } = await supabase.from('game_participants').insert(participantRows);
  if (partErr) return { error: partErr.message };

  return { gameId };
}
