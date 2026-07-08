/**
 * src/ui/screens/event-teams.js
 *
 * Tournament sub-view: team rosters. Everyone sees the teams; event
 * managers (creator/co-creators, admins) create/delete teams, set seeds
 * (1 = strongest, used by the bracket), and add/remove members from the
 * event's members + guests. A person can be in only one team per event.
 */

import { toast } from '../components/toast.js';
import { esc } from '../../format.js';
import { avatarHtml } from '../../photos.js';
import { eventMembers, eventGuests } from '../../events-data.js';
import {
  eventTeams, createTeam, deleteTeam, setTeamSeed,
  addTeamMember, removeTeamMember, teamMemberName,
} from '../../tournament-data.js';

export default async function render($el, ctx) {
  const { eventId, canManage } = ctx;
  $el.innerHTML = `<div class="empty-state"><p style="color:var(--text-faint);">Loading teams…</p></div>`;

  const [{ teams, error }, { members }, guestsRes] = await Promise.all([
    eventTeams(eventId), eventMembers(eventId), eventGuests(eventId),
  ]);
  if (error) {
    $el.innerHTML = `<div class="empty-state"><p style="color:var(--red);">Could not load teams: ${esc(error)}</p></div>`;
    return;
  }

  // Everyone who could be placed in a team
  const people = [
    ...members.filter(m => m.profiles?.is_active)
      .map(m => ({ type: 'user', id: m.user_id, name: m.profiles.display_name, avatar: m.profiles.avatar_path ?? null })),
    ...(guestsRes.guests ?? []).map(g => ({ type: 'temp', id: g.id, name: g.display_name, avatar: null })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const takenKeys = new Set(teams.flatMap(t => (t.team_members ?? [])
    .map(m => m.user_id ? `user:${m.user_id}` : `temp:${m.temp_user_id}`)));

  const draw = () => {
    $el.innerHTML = `
      <div>
        ${canManage ? `
        <div class="card" style="margin-bottom:1rem; display:flex; gap:0.5rem;">
          <input type="text" id="new-team-name" maxlength="40" placeholder="New team name…" style="flex:1;" />
          <button id="new-team-btn" class="btn btn-primary" style="padding:0.5rem 1rem;">Add</button>
        </div>` : ''}
        <div id="teams-list">
          ${teams.length ? '' : `<div class="empty-state"><h2>No teams yet</h2>
            <p style="color:var(--text-faint);">${canManage ? 'Create teams, then generate the bracket.' : 'The organizers have not created teams yet.'}</p></div>`}
        </div>
      </div>`;

    const $list = $el.querySelector('#teams-list');
    for (const t of teams) $list.insertAdjacentHTML('beforeend', teamCard(t));

    // handlers
    $el.querySelector('#new-team-btn')?.addEventListener('click', async () => {
      const name = $el.querySelector('#new-team-name').value.trim();
      if (!name) return;
      const { error } = await createTeam(eventId, name);
      if (error) { toast(`Could not create team: ${error}`, 'error'); return; }
      reload();
    });

    $list.querySelectorAll('[data-del-team]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const { error } = await deleteTeam(btn.dataset.delTeam);
        if (error) { toast(`Could not delete: ${error}`, 'error'); return; }
        reload();
      }));

    $list.querySelectorAll('[data-seed]').forEach(inp =>
      inp.addEventListener('change', async () => {
        const seed = inp.value === '' ? null : Math.max(1, parseInt(inp.value) || 1);
        const { error } = await setTeamSeed(inp.dataset.seed, seed);
        if (error) toast(`Seed not saved: ${error}`, 'error');
        else toast('Seed saved', 'success');
      }));

    $list.querySelectorAll('[data-rm-member]').forEach(btn =>
      btn.addEventListener('click', async () => {
        const { error } = await removeTeamMember(btn.dataset.rmMember);
        if (error) { toast(`Could not remove: ${error}`, 'error'); return; }
        reload();
      }));

    // add-member pickers
    $list.querySelectorAll('[data-add-input]').forEach(input => {
      const teamId = input.dataset.addInput;
      const $results = $list.querySelector(`[data-add-results="${teamId}"]`);
      const renderOptions = q => {
        const query = q.toLowerCase();
        const options = people.filter(p =>
          !takenKeys.has(`${p.type}:${p.id}`) &&
          (query === '' || p.name.toLowerCase().includes(query)));
        $results.innerHTML = options.map((p, i) => `
          <div class="picker-row-avatar" data-opt="${i}" style="display:flex; align-items:center; gap:0.5rem;
               padding:0.4rem 0.7rem; background:var(--surface-2); border-radius:8px;
               margin-bottom:0.25rem; cursor:pointer; font-size:0.85rem;">
            ${avatarHtml(p.name, p.avatar)}<span>${esc(p.name)}${p.type === 'temp' ? ' <span style="font-size:0.62rem; color:var(--text-faint);">(guest)</span>' : ''}</span>
          </div>`).join('') ||
          `<div style="padding:0.4rem 0.7rem; color:var(--text-faint); font-size:0.78rem;">Nobody left to add</div>`;
        $results.querySelectorAll('[data-opt]').forEach(row =>
          row.addEventListener('click', async () => {
            const p = options[Number(row.dataset.opt)];
            const { error } = await addTeamMember(eventId, teamId, p);
            if (error) { toast(error, 'error'); return; }
            reload();
          }));
      };
      input.addEventListener('focus', () => renderOptions(input.value.trim()));
      input.addEventListener('input', () => renderOptions(input.value.trim()));
    });
  };

  const teamCard = t => `
    <div class="card" style="margin-bottom:0.75rem;">
      <div style="display:flex; align-items:center; gap:0.6rem; margin-bottom:0.5rem;">
        <span style="font-family:'Bebas Neue',sans-serif; font-size:1.25rem; flex:1; min-width:0;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(t.name)}</span>
        ${canManage
          ? `<input type="number" min="1" data-seed="${t.id}" value="${t.seed ?? ''}" placeholder="seed"
               title="Seed (1 = strongest)"
               style="width:64px; font-size:0.75rem; padding:0.3rem 0.4rem;" />
             <button data-del-team="${t.id}" style="background:none; color:var(--text-faint); font-size:1rem;">✕</button>`
          : (t.seed ? `<span style="font-size:0.68rem; color:var(--amber);">seed ${t.seed}</span>` : '')}
      </div>
      ${(t.team_members ?? []).map(m => `
        <div class="picker-row-avatar" style="display:flex; align-items:center; gap:0.55rem;
             background:var(--surface-2); border-radius:8px; padding:0.35rem 0.7rem;
             margin-bottom:0.25rem; font-size:0.85rem;">
          ${avatarHtml(teamMemberName(m), m.profiles?.avatar_path)}
          <span style="flex:1;">${esc(teamMemberName(m))}${m.temp_user_id ? ' <span style="font-size:0.62rem; color:var(--text-faint);">(guest)</span>' : ''}</span>
          ${canManage ? `<button data-rm-member="${m.id}" style="background:none; color:var(--text-faint);">✕</button>` : ''}
        </div>`).join('') || '<div style="font-size:0.75rem; color:var(--text-faint); padding:0.2rem 0;">No members yet</div>'}
      ${canManage ? `
      <input type="text" data-add-input="${t.id}" placeholder="Add member or guest…" autocomplete="off"
        style="margin-top:0.4rem; font-size:0.85rem;" />
      <div data-add-results="${t.id}" style="margin-top:0.3rem; max-height:180px; overflow-y:auto;"></div>` : ''}
    </div>`;

  const reload = async () => {
    const res = await eventTeams(eventId);
    teams.length = 0;
    teams.push(...(res.teams ?? []));
    takenKeys.clear();
    for (const t of teams) for (const m of t.team_members ?? []) {
      takenKeys.add(m.user_id ? `user:${m.user_id}` : `temp:${m.temp_user_id}`);
    }
    draw();
  };

  draw();
}
