import { state, isAdmin, allTasks, userById, loadActivity } from '../store.js';
import { esc, icon, avatar, statusIcon, greeting, longToday, daysUntil, byDue, isOverdue, firstName, ago } from '../util.js';
import { taskRow, bindRows, emptyState } from '../rows.js';
import { describe, activityIcon } from '../activity.js';

let activityRequested = 0;

export function renderOverview(root, ctx) {
  const me = state.me;
  const tasks = allTasks();
  const open = tasks.filter((t) => t.status !== 'done');
  const mine = open.filter((t) => t.assignees.includes(me.id) && t.kind === 'task').sort(byDue);
  const dueThisWeek = mine.filter((t) => t.due_date && daysUntil(t.due_date) <= 7).length;

  const needsMe = isAdmin()
    ? open.filter((t) => t.kind === 'request' && t.assignees.includes(me.id)).sort(byDue)
    : open.filter((t) => t.kind === 'request' && t.created_by === me.id).sort(byDue);

  const groups = [
    ['Overdue', mine.filter((t) => isOverdue(t)), true],
    ['Due this week', mine.filter((t) => t.due_date && daysUntil(t.due_date) >= 0 && daysUntil(t.due_date) <= 7), false],
    ['Later', mine.filter((t) => t.due_date && daysUntil(t.due_date) > 7), false],
    ['No due date', mine.filter((t) => !t.due_date), false],
  ].filter(([, list]) => list.length);

  let shown = 0;
  const myTasksHtml = groups.map(([label, list, danger]) => {
    const take = list.slice(0, Math.max(0, 8 - shown));
    shown += take.length;
    if (!take.length) return '';
    return `<div class="list-group-label${danger ? ' is-danger' : ''}">${label}</div>${take.map((t) => taskRow(t)).join('')}`;
  }).join('');

  const subline = dueThisWeek
    ? `${longToday()} · ${dueThisWeek} ${dueThisWeek === 1 ? 'task' : 'tasks'} due this week`
    : longToday();

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">${esc(greeting())}, ${esc(firstName(me))}</h1>
          <p class="page-sub">${esc(subline)}</p>
        </div>
        <button class="btn btn-primary desktop-only" data-new type="button">${icon('plus')}New task</button>
      </div>
      <div class="ov-grid">
        <div class="ov-main">
          ${isAdmin() || needsMe.length ? `<section>
            <div class="section-head"><h2>${isAdmin() ? 'Needs your input' : 'Your requests to Sujay and Karan'}<span class="count">${needsMe.length || ''}</span></h2>
              <a href="#/requests">All requests</a></div>
            <div class="list">${needsMe.length
              ? needsMe.slice(0, 6).map((t) => taskRow(t, { requester: isAdmin() })).join('')
              : emptyState('hand-pointing', 'Nothing is waiting on you', 'When someone needs your sign-off or input, it shows up here.')}</div>
          </section>` : ''}

          <section>
            <div class="section-head"><h2>Your tasks<span class="count">${mine.length || ''}</span></h2><a href="#/my">My work</a></div>
            <div class="list">${mine.length ? myTasksHtml : emptyState('check-circle', 'You’re all clear', isAdmin() ? 'Nothing is assigned to you right now.' : 'Nothing is assigned to you right now. New work from Sujay or Karan will appear here.')}</div>
          </section>

          <section>
            <div class="section-head"><h2>Who’s on what</h2><a href="#/team">Team</a></div>
            <div class="list people">${people(open)}</div>
          </section>
        </div>

        <aside class="aside-panel">
          <div class="section-head"><h2>Recent activity</h2></div>
          <div class="feed">${feed()}</div>
        </aside>
      </div>
    </div>`;

  bindRows(root, ctx.openTask);
  root.querySelector('[data-new]')?.addEventListener('click', () => ctx.newTask());
  root.querySelectorAll('[data-chip]').forEach((c) => c.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.openTask(Number(c.dataset.chip));
  }));

  if (Date.now() - activityRequested > 30000) {
    activityRequested = Date.now();
    loadActivity().catch(() => {});
  }
}

function people(open) {
  if (!state.users.length) return '';
  return state.users.map((u) => {
    const theirs = open.filter((t) => t.assignees.includes(u.id));
    const active = theirs.filter((t) => t.status === 'doing' || t.status === 'review');
    const focus = (active.length ? active : theirs).slice(0, 3);
    const overdue = theirs.filter(isOverdue).length;
    const chips = focus.map((t) => `<button type="button" class="work-chip" data-chip="${t.id}" title="${esc(t.title)}">${statusIcon(t.status)}<span>${esc(t.title)}</span></button>`).join('');
    const more = (active.length || theirs.length) > 3 ? `<span class="work-idle">+${(active.length || theirs.length) - 3} more</span>` : '';
    return `<div class="person">
      <div class="person-id">${avatar(u, 'av-md')}<div style="min-width:0"><strong>${esc(u.name)}${u.id === state.me.id ? ' <span class="hint">(you)</span>' : ''}</strong><span>${esc(u.title || (u.role === 'admin' ? 'Owner' : 'Team member'))}</span></div></div>
      <div class="person-work">${chips || '<span class="work-idle">No open work</span>'}${more}</div>
      <div class="person-stats"><span><b>${theirs.length}</b> open</span><span><b>${active.length}</b> active</span>${overdue ? `<span class="is-danger"><b>${overdue}</b> overdue</span>` : ''}</div>
    </div>`;
  }).join('');
}

function feed() {
  if (state.activityLoaded && !state.activity.length) {
    return emptyState('clock-counter-clockwise', 'No activity yet', 'Changes to tasks and requests will show up here.');
  }
  if (!state.activity.length) {
    return `<div class="skel" style="height:14px;width:80%;margin:10px 4px"></div><div class="skel" style="height:14px;width:65%;margin:18px 4px"></div><div class="skel" style="height:14px;width:72%;margin:18px 4px"></div>`;
  }
  return state.activity.slice(0, 18).map((a) => {
    const u = userById(a.user_id);
    const who = u ? (u.id === state.me.id ? 'You' : u.name) : 'Someone';
    const exists = a.task_id && state.tasks.has(a.task_id);
    const taskHtml = exists
      ? `<a class="task-link" href="#/?t=${a.task_id}">${esc(a.task_title || state.tasks.get(a.task_id).title)}</a>`
      : `“${esc(a.task_title || 'a task')}”`;
    return `<div class="feed-item">${u ? avatar(u) : `<span class="av">${activityIcon(a)}</span>`}<div><b>${esc(who)}</b> ${describe(a, taskHtml)}<time>${esc(ago(a.created_at))}</time></div></div>`;
  }).join('');
}
