import { state, allTasks } from '../store.js';
import { icon, daysUntil, byDue, isOverdue } from '../util.js';
import { taskRow, bindRows, emptyState } from '../rows.js';

let tab = 'assigned';
let showDone = false;

export function renderMyWork(root, ctx) {
  const me = state.me;
  const q = ctx.query.toLowerCase();
  const all = allTasks().filter((t) => !q || t.title.toLowerCase().includes(q));
  const assigned = all.filter((t) => t.assignees.includes(me.id));
  const created = all.filter((t) => t.created_by === me.id);
  const list = tab === 'assigned' ? assigned : created;
  const open = list.filter((t) => t.status !== 'done').sort(byDue);
  const done = list.filter((t) => t.status === 'done').sort((a, b) => (b.completed_at || 0) - (a.completed_at || 0));

  const groups = [
    ['Overdue', open.filter(isOverdue), true],
    ['Today', open.filter((t) => t.due_date && daysUntil(t.due_date) === 0)],
    ['This week', open.filter((t) => t.due_date && daysUntil(t.due_date) > 0 && daysUntil(t.due_date) <= 7)],
    ['Later', open.filter((t) => t.due_date && daysUntil(t.due_date) > 7)],
    ['No due date', open.filter((t) => !t.due_date)],
  ].filter(([, l]) => l.length);

  const openCount = (l) => l.filter((t) => t.status !== 'done').length;

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1 class="page-title">My work</h1><p class="page-sub">Everything on your plate, ordered by when it’s due.</p></div>
        <div class="seg" role="tablist">
          <button type="button" role="tab" data-tab="assigned" class="${tab === 'assigned' ? 'is-active' : ''}" aria-selected="${tab === 'assigned'}">Assigned to me <span class="n">${openCount(assigned)}</span></button>
          <button type="button" role="tab" data-tab="created" class="${tab === 'created' ? 'is-active' : ''}" aria-selected="${tab === 'created'}">Created by me <span class="n">${openCount(created)}</span></button>
        </div>
      </div>
      <div class="list">
        ${open.length
          ? groups.map(([label, l, danger]) => `<div class="list-group-label${danger ? ' is-danger' : ''}">${label}<span class="hint">${l.length}</span></div>${l.map((t) => taskRow(t, { requester: false })).join('')}`).join('')
          : q
            ? emptyState('magnifying-glass', 'No matches', `Nothing open matches “${ctx.query}”.`)
            : emptyState('check-circle', 'Nothing open', tab === 'assigned' ? 'Tasks assigned to you will appear here.' : 'Tasks and requests you create will appear here.', `<button class="btn btn-secondary" data-new type="button">${icon('plus')}New task</button>`)}
      </div>
      ${done.length ? `
        <div class="section-head" style="margin-top:24px">
          <button type="button" class="link" data-toggle-done aria-expanded="${showDone}">${icon(showDone ? 'caret-down' : 'caret-right')} Completed (${done.length})</button>
        </div>
        ${showDone ? `<div class="list">${done.slice(0, 30).map((t) => taskRow(t)).join('')}</div>` : ''}` : ''}
    </div>`;

  bindRows(root, ctx.openTask);
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; ctx.rerender(); }));
  root.querySelector('[data-toggle-done]')?.addEventListener('click', () => { showDone = !showDone; ctx.rerender(); });
  root.querySelector('[data-new]')?.addEventListener('click', () => ctx.newTask());
}
