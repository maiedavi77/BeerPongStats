/**
 * src/ui/screens/events.js
 *
 * Root Events tab: lists the events the user participates in (admins see
 * all). Admins can create events with a name and a multi-select member
 * picker (full list, filterable — same combo pattern as the player picker).
 */

import { supabase, currentUser } from '../../supabase.js';
import { navigate } from '../../router.js';
import { toast } from '../components/toast.js';
import { myEvents, createEvent, redeemOneTimeEvent, myUnusedCredits, eventExpired, TIER_LABEL } from '../../events-data.js';
import { myFriends, findUserByEmail } from '../../friends-data.js';
import { avatarHtml } from '../../photos.js';
import { esc, shortDate } from '../../format.js';

export default async function render($el, params) {
  const archived = (params?._path === '/past');

  $el.innerHTML = `
    <div>
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;">
        <h1 style="font-size:2.5rem; color:var(--purple);">${archived ? 'PAST EVENTS' : 'EVENTS'}</h1>
        ${!archived
          ? '<button id="new-event-btn" class="btn btn-primary" style="padding:0.5rem 1rem;">+ New event</button>'
          : ''}
      </div>
      <div id="events-list">
        <div class="empty-state"><p style="color:var(--text-faint);">Loading…</p></div>
      </div>
    </div>`;

  document.getElementById('new-event-btn')?.addEventListener('click', openCreateSheet);

  await loadList(archived);
}

async function loadList(archived) {
  const $list = document.getElementById('events-list');
  if (!$list) return;

  // Both buckets are fetched by archive flag; expired one-time events
  // additionally move to Past without needing manual archiving.
  const [activeRes, archivedRes] = await Promise.all([
    myEvents({ archived: false }),
    archived ? myEvents({ archived: true }) : Promise.resolve({ events: [] }),
  ]);
  if (activeRes.error) { toast(`Could not load events: ${activeRes.error}`, 'error'); return; }

  const events = archived
    ? [...(archivedRes.events ?? []), ...activeRes.events.filter(e => e.event_type === 'one_time' && eventExpired(e))]
    : activeRes.events.filter(e => !(e.event_type === 'one_time' && eventExpired(e)));

  if (!events.length) {
    $list.innerHTML = `<div class="empty-state">
      <h2>${archived ? 'No past events' : 'No events yet'}</h2>
      <p style="color:var(--text-faint);">${archived
        ? 'Archived events will show up here.'
        : (currentUser?.is_admin
          ? 'Create the first event to get the party started.'
          : 'Ask an admin to invite you to an event.')}</p>
    </div>`;
    return;
  }

  $list.innerHTML = events.map(e => `
    <div class="card" data-eid="${e.id}" style="margin-bottom:0.6rem; cursor:pointer;"
      onmouseenter="this.style.background='var(--surface-2)'"
      onmouseleave="this.style.background='var(--surface)'">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="min-width:0;">
          <div style="font-family:'Bebas Neue',sans-serif; font-size:1.4rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${esc(e.name)}${e.event_type === 'one_time' ? ' <span style="font-size:0.7rem; color:var(--amber); vertical-align:middle;">⚡ 24h</span>' : ''}
          </div>
          <div style="font-size:0.72rem; color:var(--text-faint);">
            ${e.event_participants?.length ?? 0} member${(e.event_participants?.length ?? 0) === 1 ? '' : 's'}
            · ${e.starts_at ? `${shortDate(e.starts_at)}${e.ends_at ? ' – ' + shortDate(e.ends_at) : ''}` : shortDate(e.created_at)}
          </div>
        </div>
        <span style="color:var(--text-faint); font-size:1.2rem;">›</span>
      </div>
    </div>`).join('');

  $list.querySelectorAll('[data-eid]').forEach(el => {
    el.addEventListener('click', () => navigate(`#/event/${el.dataset.eid}`));
  });
}

// ─── Admin: create event sheet ──────────────────────────────────────────────

async function openCreateSheet() {
  const credits = await myUnusedCredits();

  // Client-side precheck for the Free limit (the DB enforces it too):
  // 1 active event as creator; archiving frees the slot. One-time credits
  // bypass this — the sheet still opens so the credit can be redeemed.
  if (credits === 0 && (currentUser?.tier ?? 'free') === 'free') {
    const { count } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', currentUser.id)
      .is('archived_at', null);
    if ((count ?? 0) >= 1) {
      toast('Free tier allows 1 active event — archive it to create a new one', 'error');
      return;
    }
  }

  // GDPR: the member picker offers FRIENDS only; strangers can be added
  // by their exact email address below.
  const { friends, error } = await myFriends();
  if (error) { toast('Could not load friends', 'error'); return; }
  const allUsers = friends.map(f => ({ id: f.id, display_name: f.display_name, avatar_path: f.avatar_path }));

  const selected = new Set([currentUser.id]); // creator is always a member

  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <h2>New event</h2>
      <div class="field">
        <label class="label" for="ev-name">Event name</label>
        <input type="text" id="ev-name" maxlength="60" placeholder="e.g. Summer Bash 2026" />
      </div>
      ${credits > 0 ? `
      <div class="field">
        <span class="label">Type</span>
        <div class="pill-row">
          <div class="pill sel" id="ev-type-standard">Standard</div>
          <div class="pill" id="ev-type-onetime">⚡ One-time (24h)</div>
        </div>
        <p style="font-size:0.68rem; color:var(--text-faint); margin-top:0.4rem;">
          You have ${credits} unused one-time credit${credits === 1 ? '' : 's'}.
          A one-time event starts immediately, runs exactly 24 hours
          (+15 min grace) and becomes read-only afterwards. Members can be
          added after creation on the Info page.
        </p>
      </div>` : ''}
      <div style="display:flex; gap:0.6rem;">
        <div class="field" style="flex:1;">
          <label class="label" for="ev-start">Starts</label>
          <input type="datetime-local" id="ev-start" />
        </div>
        <div class="field" style="flex:1;">
          <label class="label" for="ev-end">Ends</label>
          <input type="datetime-local" id="ev-end" />
        </div>
      </div>
      <p style="font-size:0.68rem; color:var(--text-faint); margin:-0.4rem 0 0.8rem;">
        Games, trichters and photos can only be added within this timeframe.
        Leave empty for no restriction.
      </p>
      ${(currentUser?.tier === 'team') ? `
      <div class="field" style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem;">
        <label class="label" for="ev-tournament" style="margin:0;">🏆 Tournament</label>
        <input type="checkbox" id="ev-tournament" style="width:20px; height:20px; accent-color:var(--purple);" />
      </div>
      <div class="field" id="ev-tracking-field">
        <label class="label" for="ev-tracking">Throw tracking</label>
        <select id="ev-tracking" style="width:100%;">
          <option value="open" selected>Open — any participant, any team</option>
          <option value="game_players">Game players only — only players in the current game</option>
          <option value="own_team">Own team only — players log only their own team</option>
          <option value="hosts">Hosts only — creator/co-creators/game-hosts</option>
        </select>
      </div>
      <p style="font-size:0.68rem; color:var(--text-faint); margin:-0.4rem 0 0.8rem;">
        Tournaments run as single-elimination brackets between teams
        (set up on the Teams tab) and have no trichter.
      </p>` : ''}
      <div class="field" style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem;">
        <label class="label" for="ev-trichter" style="margin:0;">Trichter enabled</label>
        <input type="checkbox" id="ev-trichter" checked style="width:20px; height:20px; accent-color:var(--amber);" />
      </div>
      <p style="font-size:0.68rem; color:var(--text-faint); margin:-0.4rem 0 0.8rem;">
        When off, the Trichter tab is hidden for this event.
        This event will run on your <b>${TIER_LABEL[currentUser?.tier ?? 'free']}</b> tier.
      </p>
      <div class="field">
        <label class="label">Members (your friends)</label>
        <input type="text" id="ev-member-filter" placeholder="Filter friends…" autocomplete="off" />
        <div id="ev-member-list" style="max-height:230px; overflow-y:auto; margin-top:0.4rem;"></div>
        <div id="ev-member-count" style="font-size:0.72rem; color:var(--text-faint); margin-top:0.3rem;"></div>
      </div>
      <div class="field">
        <label class="label">Add by email</label>
        <div style="display:flex; gap:0.5rem;">
          <input type="email" id="ev-email-add" placeholder="exact@email.address" autocomplete="off" style="flex:1;" />
          <button id="ev-email-btn" class="btn btn-ghost" style="width:auto; padding:0.5rem 0.9rem;">Add</button>
        </div>
        <p style="font-size:0.68rem; color:var(--text-faint); margin-top:0.3rem;">
          People who aren't your friends can be invited by their exact email address.
        </p>
      </div>
      <button class="btn btn-primary btn-block" id="ev-create">Create event</button>
      <button class="btn btn-ghost btn-block" style="margin-top:8px;" id="ev-cancel">Cancel</button>
    </div>`;
  document.body.appendChild(bd);

  // One-time toggle: hides the timeframe (fixed 24 h) — members are added
  // afterwards via the Info page (the RPC only creates the creator row).
  let oneTime = false;
  const $std = bd.querySelector('#ev-type-standard');
  const $ot = bd.querySelector('#ev-type-onetime');
  const applyType = () => {
    if ($std) $std.classList.toggle('sel', !oneTime);
    if ($ot) $ot.classList.toggle('sel', oneTime);
    bd.querySelectorAll('#ev-start, #ev-end').forEach(el =>
      el.closest('.field').style.display = oneTime ? 'none' : 'block');
  };
  $std?.addEventListener('click', () => { oneTime = false; applyType(); });
  $ot?.addEventListener('click', () => { oneTime = true; applyType(); });

  // Tournament (Team tier): forces trichter off
  const $tournament = bd.querySelector('#ev-tournament');
  const $trichterCb = bd.querySelector('#ev-trichter');
  $tournament?.addEventListener('change', () => {
    if ($tournament.checked) {
      $trichterCb.checked = false;
      $trichterCb.disabled = true;
    } else {
      $trichterCb.disabled = false;
    }
  });

  bd.querySelector('#ev-email-btn').addEventListener('click', async () => {
    const email = bd.querySelector('#ev-email-add').value.trim();
    if (!email) return;
    const { user, error: e2 } = await findUserByEmail(email);
    if (e2) { toast(e2, 'error'); return; }
    if (!user) { toast('No player with this email address', 'error'); return; }
    if (!allUsers.some(u => u.id === user.id)) {
      allUsers.push({ id: user.id, display_name: user.display_name, avatar_path: user.avatar_path });
      allUsers.sort((a, b) => a.display_name.localeCompare(b.display_name));
    }
    selected.add(user.id);
    bd.querySelector('#ev-email-add').value = '';
    toast(`${user.display_name} added`, 'success');
    renderMembers(bd.querySelector('#ev-member-filter').value.trim());
  });

  const renderMembers = (filter = '') => {
    const q = filter.toLowerCase();
    const $list = bd.querySelector('#ev-member-list');
    $list.innerHTML = allUsers
      .filter(u => q === '' || u.display_name.toLowerCase().includes(q))
      .map(u => {
        const isSelf = u.id === currentUser.id;
        const sel = selected.has(u.id);
        return `
          <div data-uid="${u.id}" style="
            display:flex; align-items:center; justify-content:space-between;
            padding:0.5rem 0.75rem; background:${sel ? 'var(--purple-dim)' : 'var(--surface-2)'};
            border:1px solid ${sel ? 'var(--purple)' : 'transparent'};
            border-radius:8px; margin-bottom:0.3rem; font-size:0.875rem;
            cursor:${isSelf ? 'default' : 'pointer'}; ${isSelf ? 'opacity:0.7;' : ''}">
            <span style="display:inline-flex; align-items:center; gap:0.45rem;" class="picker-row-avatar">${avatarHtml(u.display_name, u.avatar_path)}<span>${esc(u.display_name)}${isSelf ? ' <span style="font-size:0.65rem; color:var(--text-faint);">(you)</span>' : ''}</span></span>
            <span style="color:${sel ? 'var(--purple)' : 'var(--text-faint)'};">${sel ? '✓' : '+'}</span>
          </div>`;
      }).join('');

    $list.querySelectorAll('[data-uid]').forEach(row => {
      row.addEventListener('click', () => {
        const uid = row.dataset.uid;
        if (uid === currentUser.id) return; // creator can't be removed
        if (selected.has(uid)) selected.delete(uid);
        else selected.add(uid);
        renderMembers(bd.querySelector('#ev-member-filter').value.trim());
      });
    });

    bd.querySelector('#ev-member-count').textContent =
      `${selected.size} member${selected.size === 1 ? '' : 's'} selected (including you)`;
  };
  renderMembers();

  bd.querySelector('#ev-member-filter').addEventListener('input', e =>
    renderMembers(e.target.value.trim()));

  const close = () => bd.remove();
  bd.querySelector('#ev-cancel').addEventListener('click', close);
  bd.addEventListener('click', e => { if (e.target === bd) close(); });

  bd.querySelector('#ev-create').addEventListener('click', async () => {
    const name = bd.querySelector('#ev-name').value.trim();
    if (!name) { toast('Give the event a name', 'error'); return; }

    const startRaw = bd.querySelector('#ev-start').value;
    const endRaw = bd.querySelector('#ev-end').value;
    const startsAt = startRaw ? new Date(startRaw).toISOString() : null;
    const endsAt = endRaw ? new Date(endRaw).toISOString() : null;
    if (!oneTime && startsAt && endsAt && startsAt >= endsAt) {
      toast('The end must be after the start', 'error');
      return;
    }

    const btn = bd.querySelector('#ev-create');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    const trichterEnabled = bd.querySelector('#ev-trichter').checked;
    const isTournament = !!bd.querySelector('#ev-tournament')?.checked;
    const trackingMode = bd.querySelector('#ev-tracking')?.value ?? 'open';
    const { eventId, error } = oneTime
      ? await redeemOneTimeEvent(name, trichterEnabled)
      : await createEvent(name, [...selected], { startsAt, endsAt, trichterEnabled, isTournament, trackingMode });
    if (error) {
      toast(`Could not create event: ${error}`, 'error');
      btn.disabled = false;
      btn.textContent = 'Create event';
      return;
    }
    close();
    toast('Event created 🎉', 'success');
    navigate(`#/event/${eventId}`);
  });
}
