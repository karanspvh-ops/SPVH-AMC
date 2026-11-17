import { api } from '../api.js';
import {
  state, isAdmin, canViewAll, allTasks, boardById, canEdit, patchTask, createTask, emit, userById, isOpenInPool, transfersFor, loadAll,
  isTeamBoard, canViewBoard, canAddToBoard, canManageBoard, teamBoards, myBoards, boardsOf, defaultBoardId,
} from '../store.js';
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
    t.comments ? `<span class="meta">${icon('chat-circle', { weight: 'bold' })}${t.comments}</span>` : '',
    t.has_body ? `<span class="meta" title="Has notes">${icon('note', { weight: 'bold' })}</span>` : '',
  ].join('');
  return `<div class="card${can ? ' can-drag' : ''}${t.status === 'done' ? ' is-done' : ''}" role="button" tabindex="0" data-id="${t.id}"
      aria-label="${esc(t.title)}, ${STATUS[t.status].label}">
    <div class="card-top"><span class="card-id">${taskRef(t)}</span>${t.kind === 'request' ? `<span class="tag tag-request">${icon('paper-plane-tilt', { weight: 'bold' })}Request</span>` : ''}${isOpenInPool(t) ? `<span class="tag tag-pool">${icon('stack', { weight: 'bold' })}In pool</span>` : ''}${transfersFor(t.id).some((x) => x.kind === 'handover') ? `<span class="tag tag-handover">${icon('user-switch', { weight: 'bold' })}Handover</span>` : ''}${t.priority !== 'normal' ? prioIcon(t.priority) : ''}</div>
    <div class="card-title">${esc(t.title)}</div>
    ${isOpenInPool(t) ? '' : fromLine(t)}
    ${ck.total ? `<div class="progress-line is-card${ck.done === ck.total ? ' is-complete' : ''}"><span class="pbar"><i style="transform:scaleX(${ck.done / ck.total})"></i></span><span>${ck.done}/${ck.total}</span></div>` : ''}
    <div class="card-meta">${meta}${avatarStack(t.assignees, 3, 'av-sm')}</div>
  </div>`;
}

/**
 * Renders four status columns into `host` and wires drag and drop.
 * opts.key identifies this kanban for quick-add state; opts.newTask(status, title) creates a task.
 */
export function renderKanban(host, ctx, { tasks, key, newTask, embedded = false, canAdd = true }) {
  // Open pool tasks belong to everyone, so they live in the Task pool, never in anyone's columns.
  tasks = tasks.filter((t) => !isOpenInPool(t));
  const columns = STATUS_ORDER.map((s) => {
    const list = sortTasks(tasks.filter((t) => t.status === s));
    const adding = quickAdd && quickAdd.key === key && quickAdd.status === s;
    return `<section class="col" data-col="${s}" aria-label="${STATUS[s].label}">
      <header class="col-head">${statusIcon(s)}<h3>${STATUS[s].label}</h3><span class="n">${list.length}</span>
        ${canAdd ? `<button class="icon-btn" type="button" data-add="${s}" aria-label="Add a task to ${STATUS[s].label}">${icon('plus')}</button>` : ''}</header>
      <div class="col-list" data-status="${s}">
        ${list.map(cardHtml).join('')}
        ${list.length ? '' : `<div class="col-empty">${s === 'done' ? 'Finished work lands here' : 'No tasks'}</div>`}
      </div>
      ${adding ? `<div class="quick-add"><form data-quick="${s}">
          <textarea rows="2" maxlength="200" placeholder="What needs doing?" aria-label="New task title">${esc(quickAdd.text || '')}</textarea>
          <div class="qa-foot"><span class="hint">Enter to add, Esc to close</span><button class="btn btn-primary" type="submit">Add</button></div>
        </form></div>`
        : canAdd ? `<button class="add-card-btn" type="button" data-add="${s}">${icon('plus')}Add task</button>` : ''}
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
  const owner = board.owner_id ? userById(board.owner_id) : null;
  if (!canViewBoard(board)) {
    root.innerHTML = `<div class="page">${lockedBoard(board, owner)}</div>`;
    bindRequest(root);
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
  const showPeople = (canViewAll() || !isTeamBoard(board)) && involved.length > 1;
  const canAdd = canAddToBoard(board);
  const sub = isTeamBoard(board)
    ? `${esc(board.description || 'Team board')}${canViewAll() ? '' : ' · Showing only tasks you’re part of.'}`
    : `${owner ? `<span class="board-owner">${avatar(owner, 'av-xs')}${esc(owner.id === state.me.id ? 'Your board' : `${owner.name}’s board`)}</span>` : ''}${board.description ? ` · ${esc(board.description)}` : ''}`;

  root.innerHTML = `
    <div class="page board-page">
      <div class="board-head">
        <div style="min-width:0">
          <h1 class="page-title">${swatch(board)}${esc(board.name)}${visibilityTag(board)}</h1>
          <p class="page-sub">${sub}</p>
        </div>
        <div class="filters">
          ${showPeople ? `<div class="filter-people${filters.people.size ? ' has-filter' : ''}" role="group" aria-label="Filter by person">
            ${involved.map((u) => `<button type="button" class="${filters.people.has(u.id) ? 'is-on' : ''}" data-person="${u.id}" aria-pressed="${filters.people.has(u.id)}" aria-label="Show ${esc(u.name)}’s tasks">${avatar(u, 'av-md')}</button>`).join('')}
          </div>` : ''}
          <button type="button" class="toggle-chip${filters.requests ? ' is-on' : ''}" data-requests aria-pressed="${filters.requests}">${icon('paper-plane-tilt', { weight: 'bold' })}Requests</button>
          ${canManageBoard(board) ? `<button class="icon-btn" type="button" data-board-menu aria-label="Board options" aria-haspopup="menu">${icon('dots-three', { weight: 'bold' })}</button>` : ''}
          ${canAdd ? `<button class="btn btn-primary desktop-only" type="button" data-new>${icon('plus', { weight: 'bold' })}New task</button>` : `<span class="tag readonly-tag">${icon('eye', { weight: 'bold' })}View only</span>`}
        </div>
      </div>
      <div class="board-host" data-kanban></div>
    </div>`;

  renderKanban(root.querySelector('[data-kanban]'), ctx, {
    tasks,
    key: `board-${boardId}`,
    canAdd,
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

function visibilityTag(b) {
  if (isTeamBoard(b)) return '<span class="tag board-kind">Team</span>';
  if (b.access !== 'owner' && !isAdmin()) return '';
  return b.visibility === 'hidden'
    ? `<span class="tag board-kind is-hidden">${icon('eye-slash', { weight: 'bold' })}Hidden</span>`
    : `<span class="tag board-kind">${icon('eye', { weight: 'bold' })}Shown</span>`;
}

function lockedBoard(board, owner) {
  const pending = board.access === 'pending';
  return `<div class="locked-board">
    <div class="locked-icon">${icon('lock-simple', { weight: 'duotone' })}</div>
    <h1 class="page-title">${esc(board.name)}</h1>
    <p class="page-sub">${owner ? `${esc(owner.name)} keeps this board hidden.` : 'This board is hidden.'} ${pending ? 'Your request is waiting for their answer.' : 'Ask them to let you see it.'}</p>
    ${pending
      ? `<span class="tag tag-handover">${icon('hourglass-medium', { weight: 'bold' })}Request sent</span>`
      : `<button type="button" class="btn btn-primary" data-request-board="${board.id}">${icon('lock-key-open', { weight: 'bold' })}Request access</button>`}
  </div>`;
}

function bindRequest(root) {
  root.querySelectorAll('[data-request-board]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(b, true);
    try {
      await api(`boards/${b.dataset.requestBoard}/access`, { method: 'POST', body: {} });
      await loadAll();
      toast('Request sent. You’ll get access once they approve it.', { type: 'success' });
    } catch (err) { setBusy(b, false); toastError(err); }
  }));
}

/** A person's profile: their boards, plus (for Sujay, Karan and managers) everything assigned to them. */
export function renderPersonBoard(root, ctx, userId) {
  const person = userById(userId);
  if (!person) {
    root.innerHTML = `<div class="page">${emptyState('user-circle', 'Person not found', 'They may no longer have access.', '<a class="btn btn-secondary" href="#/team">Team</a>')}</div>`;
    return;
  }
  const isMe = userId === state.me.id;
  const boards = boardsOf(userId);
  const seeWork = isMe || canViewAll();
  const q = ctx.query.toLowerCase();
  const tasks = seeWork ? allTasks().filter((t) => t.assignees.includes(userId) && (!q || t.title.toLowerCase().includes(q))) : [];
  const open = tasks.filter((t) => t.status !== 'done');

  root.innerHTML = `
    <div class="page page-wide">
      <div class="page-head">
        <div class="person-head">${avatar(person, 'av-xl')}<div style="min-width:0">
          <h1 class="page-title">${isMe ? 'Your profile' : esc(person.name)}</h1>
          <p class="page-sub">${esc(person.title || (person.role === 'admin' ? 'Owner' : 'Team member'))}${seeWork ? ` · ${open.length} open ${open.length === 1 ? 'task' : 'tasks'}` : ''}</p>
        </div></div>
        ${isMe ? `<button class="btn btn-primary" type="button" data-new-board>${icon('plus', { weight: 'bold' })}New board</button>` : ''}
      </div>

      <section class="ov-section">
        <div class="section-head"><h2>${icon('kanban', { weight: 'duotone' })}${isMe ? 'Your boards' : `${esc(firstName(person))}’s boards`}<span class="count">${boards.length || ''}</span></h2></div>
        ${boards.length
          ? `<div class="boards-grid">${boards.map(boardTile).join('')}</div>`
          : `<div class="list">${emptyState('kanban', isMe ? 'No boards yet' : 'No boards yet', isMe ? 'Create a board for your own work. Show it to the team or keep it hidden and share it with the people you choose.' : `${firstName(person)} hasn’t created any boards.`)}</div>`}
      </section>

      ${seeWork ? `<section class="ov-section">
        <div class="section-head"><h2>${icon('list-checks', { weight: 'duotone' })}${isMe ? 'Everything assigned to you' : `Everything assigned to ${esc(firstName(person))}`}</h2>
          ${!isMe && canViewAll() ? `<button type="button" class="link" data-assign>Assign a task</button>` : ''}</div>
        <div data-kanban></div>
      </section>` : ''}
    </div>`;

  if (seeWork) {
    renderKanban(root.querySelector('[data-kanban]'), ctx, {
      tasks,
      key: `person-${userId}`,
      embedded: true,
      canAdd: isMe || canViewAll(),
      newTask: (status, title) => createTask({ board_id: defaultBoardId(), status, title, assignees: [userId] }),
    });
  }
  root.querySelector('[data-new-board]')?.addEventListener('click', () => openBoardSheet(null, ctx));
  root.querySelector('[data-assign]')?.addEventListener('click', () => ctx.newTask({ assignees: [userId] }));
  bindRequest(root);
}

function boardTile(b) {
  const tasks = allTasks().filter((t) => t.board_id === b.id);
  const open = tasks.filter((t) => t.status !== 'done');
  const people = [...new Set(open.flatMap((t) => t.assignees))];
  const owner = b.owner_id ? userById(b.owner_id) : null;
  const locked = !canViewBoard(b);
  const foot = locked
    ? (b.access === 'pending'
      ? `<span class="tag tag-handover">${icon('hourglass-medium', { weight: 'bold' })}Request sent</span>`
      : `<button type="button" class="btn btn-secondary btn-sm" data-request-board="${b.id}">${icon('lock-key-open', { weight: 'bold' })}Request access</button>`)
    : `<span>${open.length} open, ${tasks.length - open.length} done</span>${avatarStack(people, 4, 'av-sm')}`;
  return `<a class="board-tile${locked ? ' is-locked' : ''}" href="#/board/${b.id}">
    <h3>${locked ? icon('lock-simple', { weight: 'bold', cls: 'tile-lock' }) : swatch(b)}${esc(b.name)}${visibilityTag(b)}</h3>
    <p>${locked ? `Hidden by ${esc(owner ? firstName(owner) : 'its owner')}. Ask to see it.` : esc(b.description || (owner ? `${owner.id === state.me.id ? 'Your' : `${firstName(owner)}’s`} board` : 'Team board'))}</p>
    <div class="bt-foot">${foot}</div>
  </a>`;
}

function boardMenu(anchor, board, ctx) {
  const personal = !isTeamBoard(board);
  openMenu(anchor, {
    align: 'end',
    items: () => [
      { id: 'edit', label: 'Edit board', iconHtml: icon('pencil-simple') },
      ...(personal ? [
        { id: 'toggle', label: board.visibility === 'hidden' ? 'Show to everyone' : 'Hide from the team', iconHtml: icon(board.visibility === 'hidden' ? 'eye' : 'eye-slash') },
        { id: 'access', label: 'Who can see it', iconHtml: icon('users-three') },
      ] : []),
      { type: 'sep' },
      { id: 'archive', label: 'Archive board', iconHtml: icon('archive'), danger: true },
    ],
    onSelect: (id) => {
      if (id === 'edit') openBoardSheet(board, ctx);
      if (id === 'toggle') setVisibility(board, board.visibility === 'hidden' ? 'shown' : 'hidden');
      if (id === 'access') openAccessSheet(board);
      if (id === 'archive') archiveBoard(board, ctx);
    },
  });
}

async function setVisibility(board, visibility) {
  try {
    await api(`boards/${board.id}`, { method: 'PATCH', body: { visibility } });
    await loadAll();
    toast(visibility === 'hidden' ? 'Hidden. Others now need your approval to see it.' : 'Shown. The whole team can see this board.', { type: 'success' });
  } catch (err) { toastError(err); }
}

function openAccessSheet(board) {
  openSheet(`<h2>Who can see ${esc(board.name)}</h2>
    <p class="lede" data-access-lede></p>
    <div data-access-body><div class="skel" style="height:44px;margin-top:16px"></div></div>
    <div class="sheet-actions"><button class="btn btn-primary" type="button" data-close>Done</button></div>`, {
    label: 'Board access',
    onMount: (sheet) => {
      sheet.classList.add('sheet-wide');
      const load = async () => {
        const fresh = boardById(board.id) || board;
        sheet.querySelector('[data-access-lede]').textContent = fresh.visibility === 'hidden'
          ? 'This board is hidden. Only the people below, plus Sujay and Karan, can see it.'
          : 'This board is shown, so the whole team can see it. People you approve keep access if you hide it later.';
        let rows = [];
        try { rows = (await api(`boards/${board.id}/access`)).access; } catch (err) { toastError(err); }
        const byUser = new Map(rows.map((r) => [r.user_id, r]));
        const others = state.users.filter((u) => u.id !== fresh.owner_id && u.role !== 'admin');
        const row = (u) => {
          const r = byUser.get(u.id);
          const status = r?.status;
          const actions = status === 'pending'
            ? `<button class="btn btn-ghost btn-sm" data-do="decline" data-u="${u.id}">Decline</button><button class="btn btn-primary btn-sm" data-do="approve" data-u="${u.id}">Approve</button>`
            : status === 'approved'
              ? `<button class="btn btn-ghost btn-sm" data-do="revoke" data-u="${u.id}">Remove</button>`
              : `<button class="btn btn-secondary btn-sm" data-do="approve" data-u="${u.id}">Share</button>`;
          const label = status === 'pending' ? '<span class="tag tag-handover">Asked to see it</span>' : status === 'approved' ? '<span class="tag manager-tag">Can see it</span>' : status === 'declined' ? '<span class="tag">Declined</span>' : '';
          return `<div class="access-row">${avatar(u, 'av-md')}<div class="access-who"><strong>${esc(u.name)}</strong><span>${esc(u.title || 'Team member')}</span></div>${label}<div class="access-do">${actions}</div></div>`;
        };
        const sorted = others.sort((a, b) => {
          const rank = (u) => ({ pending: 0, approved: 1 }[byUser.get(u.id)?.status] ?? 2);
          return rank(a) - rank(b) || a.name.localeCompare(b.name);
        });
        sheet.querySelector('[data-access-body]').innerHTML = sorted.length
          ? `<div class="access-rows">${sorted.map(row).join('')}</div>`
          : '<p class="hint" style="margin-top:12px">No one else is in the workspace yet.</p>';
      };
      sheet.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-do]');
        if (!b) return;
        setBusy(b, true);
        try {
          await api(`boards/${board.id}/access/${b.dataset.u}/${b.dataset.do}`, { method: 'POST', body: {} });
          await loadAll();
          await load();
        } catch (err) { setBusy(b, false); toastError(err); }
      });
      load();
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
  let visibility = board?.visibility || 'shown';
  let team = board ? isTeamBoard(board) : false;
  const personalControls = () => `
    <div class="field" data-vis-field ${team ? 'hidden' : ''}><span class="label">Who can see it</span>
      <div class="seg" role="radiogroup" aria-label="Who can see it">
        <button type="button" role="radio" data-vis="shown" class="${visibility === 'shown' ? 'is-active' : ''}" aria-checked="${visibility === 'shown'}">${icon('eye', { weight: 'bold' })}Everyone</button>
        <button type="button" role="radio" data-vis="hidden" class="${visibility === 'hidden' ? 'is-active' : ''}" aria-checked="${visibility === 'hidden'}">${icon('eye-slash', { weight: 'bold' })}Only people I approve</button>
      </div>
      <span class="hint" data-vis-hint>${visibility === 'shown' ? 'The whole team can open it and see the work.' : 'It stays hidden. Others can ask you for access.'}</span></div>`;
  openSheet(`<h2>${board ? 'Edit board' : 'New board'}</h2>
    <p class="lede">${board ? 'Change the name, colour or who can see it.' : 'A board for your own stream of work, like research, a client or a project.'}</p>
    <form novalidate>
      <div class="field"><label class="label" for="bd-name">Name</label><input class="input" id="bd-name" name="name" maxlength="60" value="${esc(board?.name || '')}" required></div>
      <div class="field"><label class="label" for="bd-desc">Description <span class="opt">(optional)</span></label><input class="input" id="bd-desc" name="description" maxlength="240" value="${esc(board?.description || '')}"></div>
      <div class="field"><span class="label">Colour</span><div class="swatches" role="radiogroup" aria-label="Board colour">
        ${Object.entries(BOARD_COLORS).map(([k, v]) => `<button type="button" role="radio" aria-checked="${k === color}" aria-label="${k}" data-color="${k}" class="${k === color ? 'is-on' : ''}" style="background:${v}"></button>`).join('')}
      </div></div>
      ${!board && isAdmin() ? `<label class="switch-row"><input type="checkbox" data-team><span class="switch" aria-hidden="true"></span>Team board (shared by everyone, like General)</label>` : ''}
      ${board && isTeamBoard(board) ? '' : personalControls()}
      <div class="sheet-actions"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">${board ? 'Save' : 'Create board'}</button></div>
    </form>`, {
    label: board ? 'Edit board' : 'New board',
    onMount: (sheet, close) => {
      sheet.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
        color = b.dataset.color;
        sheet.querySelectorAll('[data-color]').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', x === b); });
      }));
      sheet.querySelectorAll('[data-vis]').forEach((b) => b.addEventListener('click', () => {
        visibility = b.dataset.vis;
        sheet.querySelectorAll('[data-vis]').forEach((x) => { x.classList.toggle('is-active', x === b); x.setAttribute('aria-checked', x === b); });
        sheet.querySelector('[data-vis-hint]').textContent = visibility === 'shown' ? 'The whole team can open it and see the work.' : 'It stays hidden. Others can ask you for access.';
      }));
      sheet.querySelector('[data-team]')?.addEventListener('change', (e) => {
        team = e.target.checked;
        sheet.querySelector('[data-vis-field]').hidden = team;
      });
      sheet.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = sheet.querySelector('[name="name"]').value.trim();
        const description = sheet.querySelector('[name="description"]').value.trim();
        if (!name) { sheet.querySelector('[name="name"]').focus(); return; }
        const btn = sheet.querySelector('button[type="submit"]');
        setBusy(btn, true);
        try {
          if (board) {
            await api(`boards/${board.id}`, { method: 'PATCH', body: { name, description, color, visibility } });
            await loadAll();
            close();
          } else {
            const res = await api('boards', { method: 'POST', body: { name, description, color, visibility, team } });
            await loadAll();
            close();
            ctx.go(`#/board/${res.board.id}`);
          }
        } catch (err) { setBusy(btn, false); toastError(err); }
      });
    },
  });
}

export function renderBoards(root, ctx) {
  const groups = [
    ['Team boards', teamBoards(), 'Shared by everyone.'],
    ['Your boards', myBoards(), ''],
    ...state.users.filter((u) => u.id !== state.me.id).map((u) => [`${u.name}’s boards`, boardsOf(u.id), '']),
  ].filter(([, list], i) => list.length || i === 1);
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1 class="page-title">Boards</h1><p class="page-sub">Team boards, your own boards, and the ones your colleagues share.</p></div>
        <button class="btn btn-primary" type="button" data-new-board>${icon('plus', { weight: 'bold' })}New board</button>
      </div>
      ${groups.map(([label, list]) => `<section class="ov-section">
        <div class="section-head"><h2>${esc(label)}<span class="count">${list.length || ''}</span></h2></div>
        ${list.length ? `<div class="boards-grid">${list.map(boardTile).join('')}</div>` : `<div class="list">${emptyState('kanban', 'No boards of your own yet', 'Create one for your own work. Show it to the team or keep it hidden and share it with the people you choose.')}</div>`}
      </section>`).join('')}
    </div>`;
  root.querySelector('[data-new-board]')?.addEventListener('click', () => openBoardSheet(null, ctx));
  bindRequest(root);
}
