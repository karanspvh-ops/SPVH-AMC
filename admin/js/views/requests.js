import { state, isAdmin, canViewAll, allTasks, admins } from '../store.js';
import { esc, icon, byDue, firstName } from '../util.js';
import { taskRow, bindRows, emptyState } from '../rows.js';

let tab = 'open';

export function renderRequests(root, ctx) {
  const me = state.me;
  const q = ctx.query.toLowerCase();
  const requests = allTasks().filter((t) => t.kind === 'request' && (!q || t.title.toLowerCase().includes(q)));
  const visible = canViewAll() ? requests : requests.filter((t) => t.created_by === me.id || t.assignees.includes(me.id));
  const open = visible.filter((t) => t.status !== 'done').sort(byDue);
  const resolved = visible.filter((t) => t.status === 'done').sort((a, b) => (b.completed_at || 0) - (a.completed_at || 0));
  const list = tab === 'open' ? open : resolved.slice(0, 50);

  let body;
  if (!list.length) {
    body = q
      ? emptyState('magnifying-glass', 'No matches', `No requests match “${ctx.query}”.`)
      : tab === 'open'
        ? emptyState('tray', 'No open requests', isAdmin()
          ? 'When the team needs your sign-off or input, their requests land here.'
          : 'Need Sujay or Karan to review, approve or join something? Send them a request.',
          `<button class="btn btn-secondary" data-new-request type="button">${icon('paper-plane-tilt', { weight: 'bold' })}New request</button>`)
        : emptyState('archive', 'Nothing resolved yet', 'Requests marked as done move here.');
  } else if (canViewAll()) {
    const owners = admins();
    const mineFirst = isAdmin() ? [me, ...owners.filter((o) => o.id !== me.id)] : owners;
    const sections = mineFirst.map((o) => [o, list.filter((t) => t.assignees.includes(o.id))]).filter(([, l]) => l.length);
    const unassigned = list.filter((t) => !t.assignees.some((id) => owners.some((o) => o.id === id)));
    body = `<div class="list">${sections.map(([o, l]) => `<div class="list-group-label">${o.id === me.id ? 'For you' : `For ${esc(firstName(o))}`}<span class="hint">${l.length}</span></div>${l.map((t) => taskRow(t, { requester: true })).join('')}`).join('')}
      ${unassigned.length ? `<div class="list-group-label">Other<span class="hint">${unassigned.length}</span></div>${unassigned.map((t) => taskRow(t, { requester: true })).join('')}` : ''}</div>`;
  } else {
    body = `<div class="list">${list.map((t) => taskRow(t)).join('')}</div>`;
  }

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">Requests</h1>
          <p class="page-sub">${isAdmin() ? 'Where the team needs you or the other owner to step in.' : 'Things you’ve asked Sujay or Karan to help with.'}</p>
        </div>
        <div class="filters">
          <div class="seg" role="tablist">
            <button type="button" role="tab" data-tab="open" class="${tab === 'open' ? 'is-active' : ''}" aria-selected="${tab === 'open'}">Open <span class="n">${open.length}</span></button>
            <button type="button" role="tab" data-tab="resolved" class="${tab === 'resolved' ? 'is-active' : ''}" aria-selected="${tab === 'resolved'}">Resolved <span class="n">${resolved.length}</span></button>
          </div>
          <button class="btn btn-primary desktop-only" data-new-request type="button">${icon('paper-plane-tilt', { weight: 'bold' })}New request</button>
        </div>
      </div>
      ${body}
    </div>`;

  bindRows(root, ctx.openTask);
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; ctx.rerender(); }));
  root.querySelectorAll('[data-new-request]').forEach((b) => b.addEventListener('click', () => ctx.newTask({ kind: 'request' })));
}
