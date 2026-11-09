import { api } from '../api.js';
import { state, isAdmin, canViewAll, isManager, allTasks, loadAll, emit } from '../store.js';
import { esc, icon, avatar, ago, isOverdue } from '../util.js';
import { openMenu, openSheet, toast, toastError, setBusy } from '../ui.js';
import { emptyState } from '../rows.js';

let tab = 'members';
let directory = null; // admin-only full user list incl. pending
let loading = false;

async function loadDirectory(ctx) {
  if (loading) return;
  loading = true;
  try {
    const { users } = await api('users');
    directory = users;
    state.pending = users.filter((u) => u.status === 'pending').length;
    ctx.rerender();
    emit();
  } catch (err) {
    toastError(err);
  } finally {
    loading = false;
  }
}

export function renderTeam(root, ctx) {
  const admin = isAdmin();
  if (admin && !directory) loadDirectory(ctx);
  if (!admin) tab = 'members';
  const pending = admin && directory ? directory.filter((u) => u.status === 'pending') : [];
  const off = admin && directory ? directory.filter((u) => u.status === 'rejected' || u.status === 'disabled') : [];
  const members = state.users;
  const ownerEmails = new Set((directory || []).filter((u) => u.owner).map((u) => u.email));

  let body;
  if (tab === 'members') body = membersList(members, ownerEmails, admin);
  else if (tab === 'requests') body = directory ? requestsList(pending) : skeleton();
  else body = directory ? offList(off) : skeleton();

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1 class="page-title">Team</h1><p class="page-sub">${admin ? 'Everyone with access, their clearance, and who is waiting for it.' : 'Everyone working in the SPVH workspace.'}</p></div>
        ${admin ? `<div class="seg" role="tablist">
          <button type="button" role="tab" data-tab="members" class="${tab === 'members' ? 'is-active' : ''}" aria-selected="${tab === 'members'}">Members <span class="n">${members.length}</span></button>
          <button type="button" role="tab" data-tab="requests" class="${tab === 'requests' ? 'is-active' : ''}" aria-selected="${tab === 'requests'}">Access requests <span class="n">${directory ? pending.length : state.pending}</span></button>
          <button type="button" role="tab" data-tab="off" class="${tab === 'off' ? 'is-active' : ''}" aria-selected="${tab === 'off'}">No access <span class="n">${directory ? off.length : ''}</span></button>
        </div>` : ''}
      </div>
      ${body}
    </div>`;

  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; ctx.rerender(); }));
  root.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', () => decide(b, ctx)));
  root.querySelectorAll('[data-member-menu]').forEach((b) => b.addEventListener('click', () => memberMenu(b, ctx)));
}

export function goToAccessRequests() { tab = 'requests'; }

function skeleton() {
  return `<div class="access-list">${[1, 2].map(() => '<div class="skel" style="height:120px;border-radius:10px"></div>').join('')}</div>`;
}

function membersList(members, ownerEmails, admin) {
  const open = allTasks().filter((t) => t.status !== 'done');
  const seeWork = canViewAll();
  return `<div class="list">${members.map((u) => {
    const theirs = open.filter((t) => t.assignees.includes(u.id));
    const active = theirs.filter((t) => t.status === 'doing' || t.status === 'review').length;
    const overdue = theirs.filter(isOverdue).length;
    const isOwner = u.role === 'admin';
    const tag = isOwner
      ? `<span class="tag role-tag">${icon('crown-simple', { weight: 'fill' })}Owner</span>`
      : isManager(u) ? `<span class="tag manager-tag">${icon('shield-star', { weight: 'fill' })}Manager</span>` : '';
    const actions = [
      seeWork ? `<a class="icon-btn" href="#/people/${u.id}" aria-label="Open ${esc(u.name)}’s board" title="Open board">${icon('kanban', { weight: 'bold' })}</a>` : '',
      admin && !isOwner && !ownerEmails.has(u.email) ? `<button class="icon-btn" type="button" data-member-menu="${u.id}" aria-label="Options for ${esc(u.name)}" aria-haspopup="menu">${icon('dots-three', { weight: 'bold' })}</button>` : '',
    ].join('');
    return `<div class="person member-row${seeWork ? '' : ' is-directory'}">
      <div class="person-id">${avatar(u, 'av-lg')}<div style="min-width:0"><strong>${esc(u.name)}${u.id === state.me.id ? ' <span class="hint">(you)</span>' : ''}</strong><span>${esc(u.title || 'Team member')}</span></div></div>
      <div class="member-contact"><a href="mailto:${esc(u.email)}">${esc(u.email)}</a>${u.phone ? `<a href="tel:${esc(u.phone)}">${esc(u.phone)}</a>` : ''}</div>
      ${seeWork ? `<div class="person-stats"><span><b>${theirs.length}</b> open</span><span><b>${active}</b> active</span>${overdue ? `<span class="is-danger"><b>${overdue}</b> overdue</span>` : ''}</div>` : ''}
      <div class="member-end">${tag}${actions}</div>
    </div>`;
  }).join('')}</div>`;
}

function requestsList(pending) {
  if (!pending.length) return `<div class="list">${emptyState('shield-check', 'No one is waiting', 'New sign-ups appear here for you or the other owner to approve.')}</div>`;
  return `<div class="access-list">${pending.map((u) => `
    <article class="access-card">
      ${avatar(u, 'av-lg')}
      <div style="min-width:0">
        <h3>${esc(u.name)}</h3>
        <div class="meta-line">
          <span>${icon('envelope-simple')}${esc(u.email)}</span>
          ${u.title ? `<span>${icon('briefcase')}${esc(u.title)}</span>` : ''}
          ${u.phone ? `<span>${icon('phone')}${esc(u.phone)}</span>` : ''}
          <span>${icon('clock')}Requested ${esc(ago(u.created_at))}</span>
        </div>
        ${u.note ? `<blockquote>${esc(u.note)}</blockquote>` : ''}
      </div>
      <div class="access-actions">
        <button class="btn btn-secondary" type="button" data-decide="rejected" data-user="${u.id}">Decline</button>
        <button class="btn btn-primary" type="button" data-decide="approved" data-user="${u.id}">${icon('check')}Approve</button>
      </div>
    </article>`).join('')}</div>`;
}

function offList(off) {
  if (!off.length) return `<div class="list">${emptyState('user-circle-minus', 'No one here', 'Declined requests and people whose access you turn off are listed here.')}</div>`;
  return `<div class="list">${off.map((u) => `
    <div class="person member-row">
      <div class="person-id">${avatar(u, 'av-lg')}<div style="min-width:0"><strong>${esc(u.name)}</strong><span>${esc(u.email)}</span></div></div>
      <div class="member-contact"><span>${esc(u.title || '')}</span></div>
      <span class="tag status-tag is-off">${u.status === 'rejected' ? 'Declined' : 'Access off'}</span>
      <button class="btn btn-secondary" type="button" data-decide="approved" data-user="${u.id}">Restore access</button>
    </div>`).join('')}</div>`;
}

async function decide(btn, ctx) {
  const id = Number(btn.dataset.user);
  const status = btn.dataset.decide;
  const user = directory?.find((u) => u.id === id);
  setBusy(btn, true);
  try {
    await api(`users/${id}`, { method: 'PATCH', body: { status } });
    if (user) user.status = status;
    toast(status === 'approved' ? `${user?.name || 'They'} can now sign in` : `Declined ${user?.name || 'the request'}`, { type: 'success' });
    await loadAll();
    state.pending = directory.filter((u) => u.status === 'pending').length;
    ctx.rerender();
  } catch (err) {
    setBusy(btn, false);
    toastError(err);
  }
}

function memberMenu(btn, ctx) {
  const id = Number(btn.dataset.memberMenu);
  const user = state.users.find((u) => u.id === id);
  const manager = isManager(user);
  openMenu(btn, {
    align: 'end',
    items: () => [
      manager
        ? { id: 'demote', label: 'Remove manager clearance', iconHtml: icon('shield-slash') }
        : { id: 'promote', label: 'Give manager clearance', iconHtml: icon('shield-star') },
      { type: 'note', label: manager ? 'They will only see their own tasks again.' : 'Managers can see everyone’s boards and assign work to anyone.' },
      { type: 'sep' },
      { id: 'off', label: 'Turn off access', iconHtml: icon('prohibit'), danger: true },
    ],
    onSelect: (choice) => {
      if (choice === 'promote' || choice === 'demote') {
        setClearance(user, choice === 'promote' ? 'manager' : 'member', ctx);
        return;
      }
      openSheet(`<h2>Turn off access for ${esc(user.name)}?</h2>
        <p class="lede">They’ll be signed out on every device straight away. Their tasks and comments stay. You can restore access later.</p>
        <div class="sheet-actions"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-danger" type="button" data-confirm>Turn off access</button></div>`, {
        label: 'Turn off access',
        onMount: (sheet, close) => {
          sheet.querySelector('[data-confirm]').addEventListener('click', async (e) => {
            setBusy(e.currentTarget, true);
            try {
              await api(`users/${id}`, { method: 'PATCH', body: { status: 'disabled' } });
              const d = directory?.find((u) => u.id === id);
              if (d) d.status = 'disabled';
              close();
              toast(`${user.name} no longer has access`, { type: 'success' });
              await loadAll();
              ctx.rerender();
            } catch (err) { setBusy(e.currentTarget, false); toastError(err); }
          });
        },
      });
    },
  });
}

async function setClearance(user, clearance, ctx) {
  try {
    await api(`users/${user.id}`, { method: 'PATCH', body: { clearance } });
    toast(clearance === 'manager' ? `${user.name} is now a manager` : `${user.name} is back to seeing only their own work`, { type: 'success' });
    await loadAll();
    ctx.rerender();
  } catch (err) { toastError(err); }
}

export function resetTeamCache() { directory = null; }
