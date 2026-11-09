import { state, isAdmin, canViewAll, allTasks, userById, loadActivity, createTask } from '../store.js';
import { esc, icon, avatar, statusIcon, greeting, longToday, daysUntil, byDue, isOverdue, firstName, ago } from '../util.js';
import { taskRow, bindRows, emptyState } from '../rows.js';
import { describe, activityIcon } from '../activity.js';
import { renderKanban } from './board.js';
import { renderCalendar, openEventSheet } from './calendar.js';
import { openMenu } from '../ui.js';

let activityRequested = 0;
let boardView = 'me'; // 'me' | 'all' | user id (owners and managers only)

function boardTasks() {
  const meId = state.me.id;
  const tasks = allTasks();
  if (!canViewAll() || boardView === 'me') {
    return tasks.filter((t) => t.assignees.includes(meId) || (t.created_by === meId && (t.kind === 'request' || !t.assignees.length)));
  }
  if (boardView === 'all') return tasks;
  return tasks.filter((t) => t.assignees.includes(boardView));
}

function boardLabel() {
  if (!canViewAll() || boardView === 'me') return 'Your board';
  if (boardView === 'all') return 'Everyone’s board';
  const u = userById(boardView);
  return u ? `${firstName(u)}’s board` : 'Your board';
}

export function renderOverview(root, ctx) {
  const me = state.me;
  if (boardView !== 'me' && boardView !== 'all' && (!canViewAll() || !userById(boardView))) boardView = 'me';
  const open = allTasks().filter((t) => t.status !== 'done');
  const mine = open.filter((t) => t.assignees.includes(me.id) && t.kind === 'task');
  const dueThisWeek = mine.filter((t) => t.due_date && daysUntil(t.due_date) <= 7).length;
  const overdue = mine.filter(isOverdue).length;
  const needsMe = isAdmin()
    ? open.filter((t) => t.kind === 'request' && t.assignees.includes(me.id)).sort(byDue)
    : [];

  const bits = [longToday()];
  if (overdue) bits.push(`${overdue} overdue`);
  else if (dueThisWeek) bits.push(`${dueThisWeek} due this week`);

  root.innerHTML = `
    <div class="page page-wide">
      <div class="page-head">
        <div>
          <h1 class="page-title">${esc(greeting())}, ${esc(firstName(me))}</h1>
          <p class="page-sub">${esc(bits.join(' · '))}</p>
        </div>
        <div class="filters desktop-only">
          <button class="btn btn-secondary" data-new-event type="button">${icon('calendar-plus', { weight: 'bold' })}Add event</button>
          <button class="btn btn-primary" data-new type="button">${icon('plus', { weight: 'bold' })}New task</button>
        </div>
      </div>

      ${needsMe.length ? `<section class="ov-section">
        <div class="section-head"><h2>${icon('tray', { weight: 'duotone' })}Needs your input<span class="count">${needsMe.length}</span></h2><a href="#/requests">All requests</a></div>
        <div class="list">${needsMe.slice(0, 4).map((t) => taskRow(t, { requester: true })).join('')}</div>
      </section>` : ''}

      <section class="ov-section">
        <div class="section-head">
          <h2>${icon('kanban', { weight: 'duotone' })}${esc(boardLabel())}</h2>
          <div class="section-tools">
            ${canViewAll() ? `<button type="button" class="view-switch" data-board-view aria-haspopup="menu">${boardViewChip()}${icon('caret-down', { weight: 'bold' })}</button>` : ''}
            <a href="#/boards">All boards</a>
          </div>
        </div>
        <div data-ov-board></div>
      </section>

      <section class="ov-section">
        <div class="section-head"><h2>${icon('calendar-dots', { weight: 'duotone' })}Calendar</h2><a href="#/calendar">Open calendar</a></div>
        <div data-ov-calendar></div>
      </section>

      <div class="ov-bottom${canViewAll() ? '' : ' is-single'}">
        ${canViewAll() ? `<section class="ov-section">
          <div class="section-head"><h2>${icon('users-three', { weight: 'duotone' })}Who’s on what</h2><a href="#/team">Team</a></div>
          <div class="list people">${people(open)}</div>
        </section>` : ''}
        <section class="ov-section">
          <div class="section-head"><h2>${icon('clock-counter-clockwise', { weight: 'duotone' })}Recent activity</h2></div>
          <div class="feed">${feed()}</div>
        </section>
      </div>
    </div>`;

  bindRows(root, ctx.openTask);
  root.querySelector('[data-new]')?.addEventListener('click', () => ctx.newTask(boardView !== 'me' && boardView !== 'all' ? { assignees: [boardView] } : {}));
  root.querySelector('[data-new-event]')?.addEventListener('click', () => openEventSheet({}));
  root.querySelector('[data-board-view]')?.addEventListener('click', (e) => switchMenu(e.currentTarget, ctx));
  root.querySelectorAll('[data-chip]').forEach((c) => c.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.openTask(Number(c.dataset.chip));
  }));
  root.querySelectorAll('[data-person-board]').forEach((p) => p.addEventListener('click', () => ctx.go(`#/people/${p.dataset.personBoard}`)));

  const assignTo = boardView === 'all' ? [] : boardView === 'me' || !canViewAll() ? [me.id] : [boardView];
  renderKanban(root.querySelector('[data-ov-board]'), ctx, {
    tasks: boardTasks(),
    key: `overview-${boardView}`,
    embedded: true,
    newTask: (status, title) => createTask({ board_id: state.boards[0]?.id, status, title, assignees: assignTo }),
  });
  renderCalendar(root.querySelector('[data-ov-calendar]'), ctx, { compact: true });

  if (Date.now() - activityRequested > 30000) {
    activityRequested = Date.now();
    loadActivity().catch(() => {});
  }
}

function boardViewChip() {
  if (boardView === 'me') return `${avatar(state.me, 'av-xs')}<span>Me</span>`;
  if (boardView === 'all') return `${icon('users-three', { weight: 'bold' })}<span>Everyone</span>`;
  const u = userById(boardView);
  return `${avatar(u, 'av-xs')}<span>${esc(firstName(u))}</span>`;
}

function switchMenu(anchor, ctx) {
  openMenu(anchor, {
    align: 'end',
    search: state.users.length > 7,
    placeholder: 'Find a person…',
    items: () => [
      { id: 'me', label: 'My tasks', iconHtml: avatar(state.me, 'av-sm'), checked: boardView === 'me' },
      { id: 'all', label: 'Everyone', iconHtml: icon('users-three'), checked: boardView === 'all' },
      { type: 'label', label: 'People' },
      ...state.users.filter((u) => u.id !== state.me.id).map((u) => ({
        id: String(u.id), label: u.name, sub: u.title, iconHtml: avatar(u, 'av-sm'), checked: boardView === u.id,
      })),
    ],
    onSelect: (id) => {
      boardView = id === 'me' || id === 'all' ? id : Number(id);
      ctx.rerender();
    },
  });
}

function people(open) {
  return state.users.map((u) => {
    const theirs = open.filter((t) => t.assignees.includes(u.id));
    const active = theirs.filter((t) => t.status === 'doing' || t.status === 'review');
    const focus = (active.length ? active : theirs).slice(0, 3);
    const overdue = theirs.filter(isOverdue).length;
    const chips = focus.map((t) => `<button type="button" class="work-chip" data-chip="${t.id}" title="${esc(t.title)}">${statusIcon(t.status)}<span>${esc(t.title)}</span></button>`).join('');
    const more = (active.length || theirs.length) > 3 ? `<span class="work-idle">+${(active.length || theirs.length) - 3} more</span>` : '';
    return `<div class="person">
      <button type="button" class="person-id person-link" data-person-board="${u.id}" aria-label="Open ${esc(u.name)}’s board">${avatar(u, 'av-md')}<div style="min-width:0"><strong>${esc(u.name)}${u.id === state.me.id ? ' <span class="hint">(you)</span>' : ''}</strong><span>${esc(u.title || (u.role === 'admin' ? 'Owner' : 'Team member'))}</span></div></button>
      <div class="person-work">${chips || '<span class="work-idle">No open work</span>'}${more}</div>
      <div class="person-stats"><span><b>${theirs.length}</b> open</span><span><b>${active.length}</b> active</span>${overdue ? `<span class="is-danger"><b>${overdue}</b> overdue</span>` : ''}</div>
    </div>`;
  }).join('');
}

function feed() {
  if (state.activityLoaded && !state.activity.length) {
    return emptyState('clock-counter-clockwise', 'No activity yet', 'Changes to your tasks and requests will show up here.');
  }
  if (!state.activity.length) {
    return `<div class="skel" style="height:14px;width:80%;margin:10px 4px"></div><div class="skel" style="height:14px;width:65%;margin:18px 4px"></div><div class="skel" style="height:14px;width:72%;margin:18px 4px"></div>`;
  }
  return state.activity.slice(0, 12).map((a) => {
    const u = userById(a.user_id);
    const who = u ? (u.id === state.me.id ? 'You' : u.name) : 'Someone';
    const exists = a.task_id && state.tasks.has(a.task_id);
    const taskHtml = exists
      ? `<a class="task-link" href="#/?t=${a.task_id}">${esc(a.task_title || state.tasks.get(a.task_id).title)}</a>`
      : `“${esc(a.task_title || 'a task')}”`;
    return `<div class="feed-item">${u ? avatar(u) : `<span class="av">${activityIcon(a)}</span>`}<div><b>${esc(who)}</b> ${describe(a, taskHtml)}<time>${esc(ago(a.created_at))}</time></div></div>`;
  }).join('');
}
