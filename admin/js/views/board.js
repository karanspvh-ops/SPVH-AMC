import { api } from '../api.js';
import { state, isAdmin, canViewAll, allTasks, boardById, canEdit, patchTask, createTask, emit, userById } from '../store.js';
import {
  esc, icon, statusIcon, prioIcon, dueBadge, avatarStack, avatar, swatch, taskRef, sortTasks, firstName, assignerOf,
  STATUS, STATUS_ORDER, BOARD_COLORS,
} from '../util.js';
import { attachBoardDnd } from '../dnd.js';
import { openMenu, openSheet, toast, toastError, setBusy } from '../ui.js';
import { emptyState } from '../rows.js';

const filters = { people: new Set(), requests: false };
let quickAdd = null; // { key, status, text }

function fromLine(t) {
  const meId = state.me.id;
  if (t.kind === 'request') {
    const c = userById(t.created_by);
    if (!c) return '';
    return `<div class="card-from">${avatar(c, 'av-xs')}<span>From ${esc(c.id === meId ? 'you' : firstName(c))}</span></div>`;
  }
  const by = userById(assignerOf(t, meId));
  if (!by) return '';
  return `<div class="card-from">${avatar(by, 'av-xs')}<span>Assigned by ${esc(by.id === meId ? 'you' : firstName(by))}</span></div>`;
}

export function cardHtml(t) {
  const can = canEdit(t);
  const ck = t.checklist || { total: 0, done: 0 };
  const meta = [
    dueBadge(t),
    ck.total ? `<span class="meta${ck.done === ck.total ? ' is-complete' : ''}">${icon('check-square', { weight: 'bold' })}${ck.done}/${ck.total}</span>` : '',
    t.comments ? `<span class="meta">${icon('chat-circle', { weight: 'bold' })}${t.comments}</span>` : '',
    t.has_body ? `<span class="meta" title="Has notes">${icon('note', { weight: 'bold' })}</span>` : '',
  ].join('');
  return `<div class="card${can ? ' can-drag' : ''}${t.status === 'done' ? ' is-done' : ''}" role="button" tabindex="0" data-id="${t.id}"
      aria-label="${esc(t.title)}, ${STATUS[t.status].label}">
    <div class="card-top"><span class="card-id">${taskRef(t)}</span>${t.kind === 'request' ? `<span class="tag tag-request">${icon('paper-plane-tilt', { weight: 'bold' })}Request</span>` : ''}${t.priority !== 'normal' ? prioIcon(t.priority) : ''}</div>
    <div class="card-title">${esc(t.title)}</div>
    ${fromLine(t)}
    <div class="card-meta">${meta}${avatarStack(t.assignees, 3, 'av-sm')}</div>
  </div>`;
}

/**
 * Renders four status columns into `host` and wires drag and drop.
 * opts.key identifies this kanban for quick-add state; opts.newTask(status, title) creates a task.
 */
export function renderKanban(host, ctx, { tasks, key, newTask, embedded = false }) {
  const columns = STATUS_ORDER.map((s) => {
    const list = sortTasks(tasks.filter((t) => t.status === s));
    const adding = quickAdd && quickAdd.key === key && quickAdd.status === s;
    return `<section class="col" data-col="${s}" aria-label="${STATUS[s].label}">
      <header class="col-head">${statusIcon(s)}<h3>${STATUS[s].label}</h3><span class="n">${list.length}</span>
        <button class="icon-btn" type="button" data-add="${s}" aria-label="Add a task to ${STATUS[s].label}">${icon('plus')}</button></header>
      <div class="col-list" data-status="${s}">
        ${list.map(cardHtml).join('')}
        ${list.length ? '' : `<div class="col-empty">${s === 'done' ? 'Finished work lands here' : 'No tasks'}</div>`}
      </div>
      ${adding ? `<div class="quick-add"><form data-quick="${s}">
          <textarea rows="2" maxlength="200" placeholder="What needs doing?" aria-label="New task title">${esc(quickAdd.text || '')}</textarea>
          <div class="qa-foot"><span class="hint">Enter to add, Esc to close</span><button class="btn btn-primary" type="submit">Add</button></div>
        </form></div>`
        : `<button class="add-card-btn" type="button" data-add="${s}">${icon('plus')}Add task</button>`}
    </section>`;
  }).join('');
  host.innerHTML = `<div class="board${embedded ? ' is-embedded' : ''}" data-board>${columns}</div>`;

  const boardEl = host.querySelector('[data-board]');
  attachBoardDnd(boardEl, {
    canDrag: (id) => canEdit(state.tasks.get(id)),
    onOpen: ctx.openTask,
    onDrop: async (id, status, prevId, nextId) => {
      const prev = prevId ? state.tasks.get(prevId) : null;
      const next = nextId ? state.tasks.get(nextId) : null;
      let position;
      if (prev && next) position = (prev.position + next.position) / 2;
      else if (prev) position = prev.position + 1024;
      else if (next) position = next.position - 1024;
      else position = 1024;
      const changedStatus = state.tasks.get(id).status !== status;
      try {
        await patchTask(id, { status, position });
        if (changedStatus) toast(`Moved to ${STATUS[status].label}`, { type: 'success', duration: 1800 });
      } catch (err) { toastError(err); }
    },
  });

  host.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    quickAdd = { key, status: b.dataset.add, text: '' };
    ctx.rerender();
  }));

  const qa = host.querySelector('[data-quick]');
  if (!qa) return;
  const ta = qa.querySelector('textarea');
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(ta.value.length, ta.value.length);
  qa.closest('.col').querySelector('.col-list').scrollTop = 1e6;
  ta.addEventListener('input', () => { quickAdd.text = ta.value; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); qa.requestSubmit(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); quickAdd = null; ctx.rerender(); }
  });
  ta.addEventListener('blur', () => {
    setTimeout(() => {
      if (quickAdd && !qa.contains(document.activeElement) && !ta.value.trim()) { quickAdd = null; ctx.rerender(); }
    }, 120);
  });
  qa.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = ta.value.trim();
    if (!title) return;
    const btn = qa.querySelector('button[type="submit"]');
    setBusy(btn, true);
    try {
      await newTask(qa.dataset.quick, title);
      quickAdd = { key, status: qa.dataset.quick, text: '' };
      emit();
    } catch (err) {
      setBusy(btn, false);
      toastError(err);
    }
  });
}

export function renderBoard(root, ctx, boardId) {
  const board = boardById(boardId);
  if (!board) {
    root.innerHTML = `<div class="page">${emptyState('kanban', 'Board not found', 'It may have been archived.', '<a class="btn btn-secondary" href="#/boards">All boards</a>')}</div>`;
    return;
  }
  if (filters.boardId !== boardId) { filters.people.clear(); filters.requests = false; filters.boardId = boardId; }
  const q = ctx.query.toLowerCase();
  const onBoard = allTasks().filter((t) => t.board_id === boardId);
  const tasks = onBoard.filter((t) =>
    (!q || t.title.toLowerCase().includes(q)) &&
    (!filters.requests || t.kind === 'request') &&
    (!filters.people.size || t.assignees.some((id) => filters.people.has(id))));
  const involved = state.users.filter((u) => onBoard.some((t) => t.assignees.includes(u.id)));
  const showPeople = canViewAll() && involved.length > 1;

  root.innerHTML = `
    <div class="page board-page">
      <div class="board-head">
        <div style="min-width:0">
          <h1 class="page-title">${swatch(board)}${esc(board.name)}</h1>
          <p class="page-sub">${esc(board.description || '')}${canViewAll() ? '' : `${board.description ? ' ' : ''}Showing only tasks you’re part of.`}</p>
        </div>
        <div class="filters">
          ${showPeople ? `<div class="filter-people${filters.people.size ? ' has-filter' : ''}" role="group" aria-label="Filter by person">
            ${involved.map((u) => `<button type="button" class="${filters.people.has(u.id) ? 'is-on' : ''}" data-person="${u.id}" aria-pressed="${filters.people.has(u.id)}" aria-label="Show ${esc(u.name)}’s tasks">${avatar(u, 'av-md')}</button>`).join('')}
          </div>` : ''}
          <button type="button" class="toggle-chip${filters.requests ? ' is-on' : ''}" data-requests aria-pressed="${filters.requests}">${icon('paper-plane-tilt', { weight: 'bold' })}Requests</button>
          ${isAdmin() ? `<button class="icon-btn" type="button" data-board-menu aria-label="Board options" aria-haspopup="menu">${icon('dots-three', { weight: 'bold' })}</button>` : ''}
          <button class="btn btn-primary desktop-only" type="button" data-new>${icon('plus', { weight: 'bold' })}New task</button>
        </div>
      </div>
      <div class="board-host" data-kanban></div>
    </div>`;

  renderKanban(root.querySelector('[data-kanban]'), ctx, {
    tasks,
    key: `board-${boardId}`,
    newTask: (status, title) => createTask({ board_id: boardId, status, title, assignees: canViewAll() ? [] : [state.me.id] }),
  });

  root.querySelectorAll('[data-person]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.person);
    if (filters.people.has(id)) filters.people.delete(id); else filters.people.add(id);
    ctx.rerender();
  }));
  root.querySelector('[data-requests]').addEventListener('click', () => { filters.requests = !filters.requests; ctx.rerender(); });
  root.querySelector('[data-new]')?.addEventListener('click', () => ctx.newTask({ board_id: boardId }));
  root.querySelector('[data-board-menu]')?.addEventListener('click', (e) => boardMenu(e.currentTarget, board, ctx));
}

/** One person's board across every project. Only owners and managers can open someone else's. */
export function renderPersonBoard(root, ctx, userId) {
  const person = userById(userId);
  const isMe = userId === state.me.id;
  if (!person || (!isMe && !canViewAll())) {
    root.innerHTML = `<div class="page">${emptyState('lock-simple', 'You can’t view this board', 'Only Sujay, Karan and managers can see other people’s work.', '<a class="btn btn-secondary" href="#/">Back to overview</a>')}</div>`;
    return;
  }
  const q = ctx.query.toLowerCase();
  const tasks = allTasks().filter((t) => t.assignees.includes(userId) && (!q || t.title.toLowerCase().includes(q)));
  const open = tasks.filter((t) => t.status !== 'done');
  root.innerHTML = `
    <div class="page board-page">
      <div class="board-head">
        <div class="person-head">${avatar(person, 'av-xl')}<div style="min-width:0">
          <h1 class="page-title">${isMe ? 'Your board' : `${esc(firstName(person))}’s board`}</h1>
          <p class="page-sub">${esc(person.title || (person.role === 'admin' ? 'Owner' : 'Team member'))} · ${open.length} open ${open.length === 1 ? 'task' : 'tasks'}</p>
        </div></div>
        <div class="filters"><button class="btn btn-primary desktop-only" type="button" data-new>${icon('plus', { weight: 'bold' })}${isMe ? 'New task' : `Assign to ${esc(firstName(person))}`}</button></div>
      </div>
      <div class="board-host" data-kanban></div>
    </div>`;
  renderKanban(root.querySelector('[data-kanban]'), ctx, {
    tasks,
    key: `person-${userId}`,
    newTask: (status, title) => createTask({ board_id: state.boards[0]?.id, status, title, assignees: [userId] }),
  });
  root.querySelector('[data-new]').addEventListener('click', () => ctx.newTask({ assignees: [userId] }));
}

function boardMenu(anchor, board, ctx) {
  openMenu(anchor, {
    align: 'end',
    items: () => [
      { id: 'edit', label: 'Edit board', iconHtml: icon('pencil-simple') },
      { type: 'sep' },
      { id: 'archive', label: 'Archive board', iconHtml: icon('archive'), danger: true },
    ],
    onSelect: (id) => {
      if (id === 'edit') openBoardSheet(board, ctx);
      if (id === 'archive') archiveBoard(board, ctx);
    },
  });
}

function archiveBoard(board, ctx) {
  const open = allTasks().filter((t) => t.board_id === board.id && t.status !== 'done').length;
  openSheet(`<h2>Archive ${esc(board.name)}?</h2>
    <p class="lede">${open ? `It still has ${open} open ${open === 1 ? 'task' : 'tasks'}. ` : ''}The board will be hidden for everyone. Its tasks stay in people’s lists.</p>
    <div class="sheet-actions"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-danger" type="button" data-confirm>Archive</button></div>`, {
    label: 'Archive board',
    onMount: (sheet, close) => {
      sheet.querySelector('[data-confirm]').addEventListener('click', async (e) => {
        setBusy(e.currentTarget, true);
        try {
          await api(`boards/${board.id}`, { method: 'PATCH', body: { archived: true } });
          state.boards = state.boards.filter((b) => b.id !== board.id);
          close();
          toast('Board archived', { type: 'success' });
          ctx.go('#/boards');
          emit();
        } catch (err) { setBusy(e.currentTarget, false); toastError(err); }
      });
    },
  });
}

export function openBoardSheet(board, ctx) {
  let color = board?.color || 'blue';
  openSheet(`<h2>${board ? 'Edit board' : 'New board'}</h2>
    <p class="lede">Boards group related work, like a client mandate, a fund launch or a team.</p>
    <form novalidate>
      <div class="field"><label class="label" for="bd-name">Name</label><input class="input" id="bd-name" name="name" maxlength="60" value="${esc(board?.name || '')}" required></div>
      <div class="field"><label class="label" for="bd-desc">Description <span class="opt">(optional)</span></label><input class="input" id="bd-desc" name="description" maxlength="240" value="${esc(board?.description || '')}"></div>
      <div class="field"><span class="label">Colour</span><div class="swatches" role="radiogroup" aria-label="Board colour">
        ${Object.entries(BOARD_COLORS).map(([k, v]) => `<button type="button" role="radio" aria-checked="${k === color}" aria-label="${k}" data-color="${k}" class="${k === color ? 'is-on' : ''}" style="background:${v}"></button>`).join('')}
      </div></div>
      <div class="sheet-actions"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">${board ? 'Save' : 'Create board'}</button></div>
    </form>`, {
    label: board ? 'Edit board' : 'New board',
    onMount: (sheet, close) => {
      sheet.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
        color = b.dataset.color;
        sheet.querySelectorAll('[data-color]').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', x === b); });
      }));
      sheet.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = sheet.querySelector('[name="name"]').value.trim();
        const description = sheet.querySelector('[name="description"]').value.trim();
        if (!name) { sheet.querySelector('[name="name"]').focus(); return; }
        const btn = sheet.querySelector('button[type="submit"]');
        setBusy(btn, true);
        try {
          if (board) {
            const res = await api(`boards/${board.id}`, { method: 'PATCH', body: { name, description, color } });
            Object.assign(board, res.board);
            close();
            emit();
          } else {
            const res = await api('boards', { method: 'POST', body: { name, description, color } });
            state.boards.push(res.board);
            close();
            ctx.go(`#/board/${res.board.id}`);
            emit();
          }
        } catch (err) { setBusy(btn, false); toastError(err); }
      });
    },
  });
}

export function renderBoards(root, ctx) {
  const tasks = allTasks();
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1 class="page-title">Boards</h1><p class="page-sub">${canViewAll() ? 'Every stream of work across the firm.' : 'The streams of work you’re part of.'}</p></div>
        ${isAdmin() ? `<button class="btn btn-primary" type="button" data-new-board>${icon('plus', { weight: 'bold' })}New board</button>` : ''}
      </div>
      <div class="boards-grid">
        ${state.boards.map((b) => {
          const list = tasks.filter((t) => t.board_id === b.id);
          const open = list.filter((t) => t.status !== 'done');
          const people = [...new Set(open.flatMap((t) => t.assignees))];
          return `<a class="board-tile" href="#/board/${b.id}">
            <h3>${swatch(b)}${esc(b.name)}</h3>
            <p>${esc(b.description || 'No description yet.')}</p>
            <div class="bt-foot"><span>${open.length} open, ${list.length - open.length} done</span>${avatarStack(people, 4, 'av-sm')}</div>
          </a>`;
        }).join('')}
      </div>
    </div>`;
  root.querySelector('[data-new-board]')?.addEventListener('click', () => openBoardSheet(null, ctx));
}
