import { api } from './api.js';
import {
  state, subscribe, userById, boardById, admins, isAdmin, canViewAll, canEdit, canDelete,
  assignableUsers, patchTask, createTask, removeTask, upsertTask,
} from './store.js';
import {
  esc, icon, statusIcon, prioIcon, swatch, avatar, avatarStack, STATUS, STATUS_ORDER, PRIORITY, PRIORITY_ORDER,
  dueLabel, daysUntil, taskRef, autosize, debounce, ago, firstName, fullDate,
} from './util.js';
import { openMenu, closeMenu, openSheet, toast, toastError, setBusy } from './ui.js';
import { describe, activityIcon } from './activity.js';

let ds = null; // drawer state
let navigate = { open: () => {}, close: () => {} };
export function setDrawerNavigation(fns) { navigate = fns; }

const root = () => document.getElementById('drawer-root');

subscribe(() => {
  if (!ds || ds.mode !== 'view') return;
  const task = state.tasks.get(ds.id);
  if (!task) { closeDrawer(); return; }
  renderProps();
  renderKind();
  renderLinked();
  applyPermissions();
});

// ---------- open / close ----------

export function openTask(id) {
  const task = state.tasks.get(id);
  if (!task) { toast('That task no longer exists.', { type: 'error' }); navigate.close(); return; }
  if (ds?.mode === 'view' && ds.id === id) return;
  mount({ mode: 'view', id, detail: null, asking: false });
  loadDetail(id);
}

export function openNewTask(defaults = {}) {
  const me = state.me;
  const kind = defaults.kind === 'request' ? 'request' : 'task';
  const draft = {
    title: '',
    body: '',
    kind,
    board_id: defaults.board_id || state.boards[0]?.id,
    status: defaults.status || 'todo',
    priority: 'normal',
    due_date: null,
    assignees: defaults.assignees || (kind === 'request' ? [] : isAdmin() ? [] : [me.id]),
    parent_id: defaults.parent_id || null,
    checklist: [],
  };
  mount({ mode: 'new', draft });
}

export function closeDrawer({ fromRoute = false } = {}) {
  if (!ds) return;
  const { el, back, mode, prevFocus } = ds;
  flushSaves();
  ds = null;
  closeMenu();
  document.removeEventListener('keydown', onKey, true);
  el.classList.remove('is-open');
  back.classList.remove('is-open');
  setTimeout(() => { el.remove(); back.remove(); }, 320);
  if (!fromRoute && mode === 'view') navigate.close();
  if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
}

export const drawerOpenFor = () => (ds?.mode === 'view' ? ds.id : null);

function onKey(e) {
  if (e.key === 'Escape' && !document.querySelector('.menu.is-open') && !document.querySelector('.sheet')) {
    e.preventDefault();
    closeDrawer();
  }
}

function mount(next) {
  const wasOpen = !!ds;
  const prevFocus = ds ? ds.prevFocus : document.activeElement;
  if (ds) {
    flushSaves();
    closeMenu();
    ds.el.remove();
    ds.back.remove();
    document.removeEventListener('keydown', onKey, true);
  }
  const back = document.createElement('div');
  back.className = 'drawer-backdrop';
  const el = document.createElement('aside');
  el.className = 'drawer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'doc-title');
  root().append(back, el);
  ds = { ...next, el, back, saving: 0, prevFocus };
  renderShell();
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('click', () => closeDrawer());
  if (wasOpen) { el.classList.add('is-open'); back.classList.add('is-open'); }
  else requestAnimationFrame(() => { el.classList.add('is-open'); back.classList.add('is-open'); });
  if (next.mode === 'new') setTimeout(() => el.querySelector('#doc-title')?.focus(), 60);
}

async function loadDetail(id) {
  try {
    const { task } = await api(`tasks/${id}`);
    if (!ds || ds.id !== id) return;
    ds.detail = task;
    upsertTask(stripDetail(task));
    const body = ds.el.querySelector('#doc-body');
    if (body && document.activeElement !== body) { body.value = task.body; autosize(body); }
    renderChecklist();
    renderTimeline();
  } catch (err) {
    if (err.status === 404) { removeTask(id); closeDrawer(); }
    toastError(err);
  }
}

const stripDetail = (t) => {
  const { body, checklist_items, comment_list, activity, children, ...rest } = t;
  return { ...rest, has_body: !!body };
};

// ---------- data access ----------

const current = () => (ds.mode === 'view' ? state.tasks.get(ds.id) : ds.draft);
const editable = () => (ds.mode === 'new' ? true : canEdit(current()));

async function setField(patch) {
  if (ds.mode === 'new') {
    Object.assign(ds.draft, patch);
    renderProps();
    renderKind();
    renderFoot();
    return;
  }
  try {
    markSaving(1);
    await patchTask(ds.id, patch);
  } catch (err) {
    toastError(err);
  } finally {
    markSaving(-1);
  }
}

function markSaving(delta) {
  if (!ds) return;
  ds.saving = Math.max(0, ds.saving + delta);
  const s = ds.el.querySelector('[data-save-state]');
  if (s) s.textContent = ds.saving ? 'Saving…' : 'Saved';
}

const saveTitle = debounce(async (id, title) => {
  if (!title.trim()) return;
  try { markSaving(1); await patchTask(id, { title: title.trim() }); } catch (err) { toastError(err); } finally { markSaving(-1); }
}, 700);

const saveBody = debounce(async (id, body) => {
  try {
    markSaving(1);
    const { task } = await api(`tasks/${id}`, { method: 'PATCH', body: { body } });
    upsertTask(task);
    if (ds?.detail && ds.id === id) ds.detail.body = body;
  } catch (err) { toastError(err); } finally { markSaving(-1); }
}, 900);

function flushSaves() {
  if (!ds || ds.mode !== 'view') return;
  const title = ds.el.querySelector('#doc-title');
  const body = ds.el.querySelector('#doc-body');
  const task = state.tasks.get(ds.id);
  if (title && task && title.value.trim() && title.value.trim() !== task.title) saveTitle.flush(ds.id, title.value);
  if (body && ds.detail && body.value !== ds.detail.body) saveBody.flush(ds.id, body.value);
}

// ---------- rendering ----------

function renderShell() {
  const t = current();
  const isNew = ds.mode === 'new';
  const b = boardById(t.board_id);
  const isRequest = t.kind === 'request';
  ds.el.innerHTML = `
    <header class="drawer-bar">
      <div class="crumbs">${swatch(b)}<span>${esc(b?.name || 'Board')}</span>${icon('caret-right')}<strong>${isNew ? (isRequest ? 'New request' : 'New task') : taskRef(t)}</strong></div>
      <div class="actions">
        ${isNew ? '' : '<span class="hint" data-save-state aria-live="polite"></span>'}
        ${isNew ? '' : `<button class="icon-btn" data-act="more" aria-label="More actions" aria-haspopup="menu">${icon('dots-three')}</button>`}
        <button class="icon-btn" data-act="close" aria-label="Close">${icon('x')}</button>
      </div>
    </header>
    <div class="drawer-scroll">
      <article class="doc">
        <div class="doc-kind" data-region="kind"></div>
        <textarea id="doc-title" class="doc-title" rows="1" maxlength="200" placeholder="${isRequest ? 'What do you need from Sujay or Karan?' : 'Task title'}" aria-label="Title">${esc(t.title)}</textarea>
        <div class="stepper" data-region="stepper" role="radiogroup" aria-label="Status"></div>
        <dl class="props" data-region="props"></dl>
        <div data-region="readonly"></div>
        <section class="doc-section">
          <h3>${icon('text-align-left')}Notes</h3>
          <textarea id="doc-body" class="doc-body" placeholder="Add context, decisions, links…" aria-label="Notes">${isNew ? esc(t.body) : ''}</textarea>
        </section>
        <section class="doc-section" data-region="checklist"></section>
        <section class="doc-section" data-region="linked"></section>
        ${isNew ? '' : '<div class="divider"></div><section class="doc-section" data-region="timeline"></section>'}
      </article>
    </div>
    ${isNew ? '<footer class="drawer-foot" data-region="foot"></footer>' : ''}`;

  const title = ds.el.querySelector('#doc-title');
  const body = ds.el.querySelector('#doc-body');
  requestAnimationFrame(() => { autosize(title); autosize(body); });

  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); body.focus(); } });
  title.addEventListener('input', () => {
    autosize(title);
    if (ds.mode === 'new') { ds.draft.title = title.value; renderFoot(); }
    else saveTitle(ds.id, title.value);
  });
  title.addEventListener('blur', () => {
    if (ds?.mode === 'view' && !title.value.trim()) {
      title.value = state.tasks.get(ds.id)?.title || '';
      autosize(title);
    }
  });
  body.addEventListener('input', () => {
    autosize(body);
    if (ds.mode === 'new') ds.draft.body = body.value;
    else if (ds.detail) saveBody(ds.id, body.value);
  });

  ds.el.addEventListener('click', onClick);
  renderKind();
  renderProps();
  renderChecklist();
  renderLinked();
  if (ds.mode === 'view') renderTimeline();
  else renderFoot();
  applyPermissions();
}

function renderKind() {
  const region = ds.el.querySelector('[data-region="kind"]');
  if (!region) return;
  const t = current();
  const bits = [];
  if (t.kind === 'request') {
    const creator = ds.mode === 'view' ? userById(t.created_by) : state.me;
    bits.push(`<span class="tag tag-request">${icon('paper-plane-tilt', { weight: 'fill' })}Request</span>`);
    if (creator) bits.push(`<span class="hint">from ${esc(creator.id === state.me.id ? 'you' : creator.name)}</span>`);
  }
  if (t.parent_id) {
    const parent = state.tasks.get(t.parent_id);
    if (parent) bits.push(`<button type="button" class="tag" data-open-task="${parent.id}">${icon('arrow-bend-up-left')}${esc(taskRef(parent))} ${esc(parent.title.length > 42 ? parent.title.slice(0, 40) + '…' : parent.title)}</button>`);
  }
  region.innerHTML = bits.join('');
  region.hidden = !bits.length;
}

function renderProps() {
  const region = ds.el.querySelector('[data-region="props"]');
  if (!region) return;
  const t = current();
  const can = editable();
  const b = boardById(t.board_id);
  const people = t.assignees.map(userById).filter(Boolean);
  const dis = can ? '' : 'disabled';
  const due = t.due_date;
  const dueCls = due && t.status !== 'done' && daysUntil(due) < 0 ? ' style="color:var(--danger);font-weight:600"' : '';
  const creator = ds.mode === 'view' ? userById(t.created_by) : null;
  renderStepper();
  const assignedBy = (t.assignments || [])
    .filter((a) => a.by)
    .map((a) => {
      const by = userById(a.by);
      const to = userById(a.user_id);
      if (!by || !to) return '';
      const who = a.by === a.user_id ? `${esc(to.id === state.me.id ? 'You' : to.name)} took it on` : `${esc(by.id === state.me.id ? 'You' : by.name)} assigned ${esc(to.id === state.me.id ? 'you' : firstName(to))}`;
      return `<span class="assign-line">${avatar(by, 'av-xs')}<span>${who}</span>${a.at ? `<span class="hint">${esc(ago(a.at))}</span>` : ''}</span>`;
    })
    .filter(Boolean);
  region.innerHTML = `
    <div class="prop"><dt>${icon('users')}${t.kind === 'request' ? 'Asking' : 'Assignees'}</dt><dd>
      <button class="prop-btn${people.length ? '' : ' is-empty'}" data-prop="assignees" aria-haspopup="menu" ${dis}>
        ${people.length ? `${avatarStack(t.assignees, 4, 'av-sm')}<span class="names">${esc(people.map((p) => p.name).join(', '))}</span>` : 'Add people'}
      </button></dd></div>
    ${assignedBy.length ? `<div class="prop prop-top"><dt>${icon('arrow-bend-down-right')}Assigned by</dt><dd><div class="assign-lines">${assignedBy.join('')}</div></dd></div>` : ''}
    <div class="prop"><dt>${icon('cell-signal-full')}Priority</dt><dd>
      <button class="prop-btn" data-prop="priority" aria-haspopup="menu" ${dis}>${prioIcon(t.priority)}${PRIORITY[t.priority].label}</button></dd></div>
    <div class="prop"><dt>${icon('calendar-blank')}Due date</dt><dd>
      <span class="date-wrap">
        <span class="prop-btn${due ? '' : ' is-empty'}"${dueCls}>${due ? `${esc(dueLabel(due))}${daysUntil(due) > 1 || daysUntil(due) < -1 ? '' : ` <span class="hint">${esc(fullDate(new Date(due + 'T00:00').getTime()))}</span>`}` : 'Set a date'}</span>
        <input type="date" data-prop="due" value="${due || ''}" aria-label="Due date" ${dis}>
      </span>
      ${due && can ? `<button class="icon-btn" data-act="clear-due" aria-label="Clear due date">${icon('x')}</button>` : ''}
    </dd></div>
    <div class="prop"><dt>${icon('kanban')}Board</dt><dd>
      <button class="prop-btn" data-prop="board" aria-haspopup="menu" ${dis}>${swatch(b)}${esc(b?.name || 'Choose')}</button></dd></div>
    ${creator ? `<div class="prop"><dt>${icon('user-circle')}Created</dt><dd><span class="prop-static">${avatar(creator, 'av-sm')}${esc(creator.name)}<span class="hint">${esc(ago(t.created_at))}</span></span></dd></div>` : ''}`;

  const dateInput = region.querySelector('input[type="date"]');
  dateInput?.addEventListener('change', () => setField({ due_date: dateInput.value || null }));
  dateInput?.addEventListener('click', (e) => { try { e.target.showPicker?.(); } catch { /* not supported */ } });
}

function renderStepper() {
  const region = ds.el.querySelector('[data-region="stepper"]');
  if (!region) return;
  const t = current();
  const can = editable();
  const idx = STATUS_ORDER.indexOf(t.status);
  region.style.setProperty('--fill', String(idx / (STATUS_ORDER.length - 1)));
  region.dataset.status = t.status;
  region.innerHTML = `<div class="stepper-track" aria-hidden="true"><i></i></div>${STATUS_ORDER.map((s, i) => `
    <button type="button" role="radio" class="step${i < idx ? ' is-past' : ''}${i === idx ? ' is-current' : ''}" data-step="${s}"
      aria-checked="${i === idx}" ${can ? '' : 'disabled'}>
      <span class="step-dot">${i < idx || (i === idx && s === 'done') ? icon('check', { weight: 'bold' }) : i === idx ? '<i class="pulse"></i>' : ''}</span>
      <span class="step-label">${STATUS[s].label}</span>
    </button>`).join('')}`;
}

function applyPermissions() {
  const can = editable();
  const title = ds.el.querySelector('#doc-title');
  const body = ds.el.querySelector('#doc-body');
  if (title) title.readOnly = !can;
  if (body) {
    body.readOnly = !can;
    if (!can) body.placeholder = 'No notes yet.';
  }
  const ro = ds.el.querySelector('[data-region="readonly"]');
  if (ro) {
    ro.innerHTML = can ? '' : `<div class="notice readonly-note">${icon('lock-simple', { fill: true })}<span>You can comment here. Only the people on this task, a manager, or Sujay and Karan can change it.</span></div>`;
  }
}

function renderChecklist() {
  const region = ds.el.querySelector('[data-region="checklist"]');
  if (!region) return;
  const can = editable();
  let items;
  if (ds.mode === 'new') items = ds.draft.checklist.map((text, i) => ({ id: `d${i}`, text, done: false }));
  else if (!ds.detail) {
    region.innerHTML = `<h3>${icon('list-checks')}Checklist</h3><div class="skel" style="height:18px;width:60%;margin:6px 0"></div><div class="skel" style="height:18px;width:45%;margin:10px 0"></div>`;
    return;
  } else items = ds.detail.checklist_items;
  const done = items.filter((i) => i.done).length;
  if (!items.length && !can) { region.innerHTML = ''; return; }
  region.innerHTML = `
    <h3>${icon('list-checks')}Checklist ${items.length ? `<span class="count">${done} of ${items.length}</span>` : ''}</h3>
    ${items.length ? `<div class="progress"><span class="progress-bar"><i style="transform:scaleX(${items.length ? done / items.length : 0})"></i></span></div>` : ''}
    <div class="checks">
      ${items.map((i) => `<div class="check-item${i.done ? ' is-done' : ''}" data-check="${i.id}">
        <button type="button" class="check-box" data-act="toggle-check" role="checkbox" aria-checked="${i.done}" aria-label="${esc(i.text)}" ${can && ds.mode === 'view' ? '' : 'disabled'}>${icon('check', { cls: 'ph-bold' })}</button>
        <textarea class="check-text" rows="1" aria-label="Checklist item" ${can ? '' : 'readonly'}>${esc(i.text)}</textarea>
        ${can ? `<button type="button" class="icon-btn" data-act="remove-check" aria-label="Remove item">${icon('x')}</button>` : ''}
      </div>`).join('')}
      ${can ? `<label class="check-add">${icon('plus')}<input type="text" data-check-add placeholder="Add an item" maxlength="300" aria-label="Add checklist item"></label>` : ''}
    </div>`;
  region.querySelectorAll('.check-text').forEach((ta) => {
    autosize(ta);
    ta.addEventListener('input', () => autosize(ta));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ta.blur(); } });
    ta.addEventListener('change', () => updateCheckText(ta));
  });
  const add = region.querySelector('[data-check-add]');
  add?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = add.value.trim();
    if (!text) return;
    if (ds.mode === 'new') {
      ds.draft.checklist.push(text);
      renderChecklist();
      ds.el.querySelector('[data-check-add]')?.focus();
      return;
    }
    add.value = '';
    try {
      const { item } = await api(`tasks/${ds.id}/checklist`, { method: 'POST', body: { text } });
      ds.detail.checklist_items.push(item);
      bumpChecklist();
      renderChecklist();
      ds.el.querySelector('[data-check-add]')?.focus();
    } catch (err) { add.value = text; toastError(err); }
  });
}

function bumpChecklist() {
  const items = ds.detail.checklist_items;
  const t = state.tasks.get(ds.id);
  if (t) upsertTask({ ...t, checklist: { total: items.length, done: items.filter((i) => i.done).length } });
}

async function updateCheckText(ta) {
  const row = ta.closest('[data-check]');
  const id = row.dataset.check;
  const text = ta.value.trim();
  if (ds.mode === 'new') {
    const idx = Number(id.slice(1));
    if (text) ds.draft.checklist[idx] = text;
    else ds.draft.checklist.splice(idx, 1);
    renderChecklist();
    return;
  }
  const item = ds.detail.checklist_items.find((i) => String(i.id) === id);
  if (!item || text === item.text) return;
  if (!text) { ta.value = item.text; return; }
  try {
    await api(`checklist/${id}`, { method: 'PATCH', body: { text } });
    item.text = text;
  } catch (err) { ta.value = item.text; toastError(err); }
}

function renderLinked() {
  const region = ds.el.querySelector('[data-region="linked"]');
  if (!region) return;
  const t = current();
  if (ds.mode === 'new' || t.kind === 'request') { region.innerHTML = ''; return; }
  const children = [...state.tasks.values()].filter((x) => x.parent_id === t.id);
  const owners = admins().filter((u) => u.id !== state.me.id);
  if (!children.length && !owners.length) { region.innerHTML = ''; return; }
  const ownerNames = owners.map(firstName).join(' or ');
  const list = children.map((c) => `<button type="button" class="linked-item" data-open-task="${c.id}">
      ${statusIcon(c.status)}
      <span class="row-main"><span class="row-title" style="display:block">${esc(c.title)}</span>
      <span class="row-sub"><span>${esc(userById(c.created_by)?.id === state.me.id ? 'You' : firstName(userById(c.created_by)))} asked ${esc(c.assignees.map(userById).filter(Boolean).map(firstName).join(' and '))}</span></span></span>
      ${avatarStack(c.assignees, 2, 'av-sm')}
    </button>`).join('');
  region.innerHTML = `
    <h3>${icon('paper-plane-tilt')}${isAdmin() ? 'Requests on this task' : 'Need Sujay or Karan?'} ${children.length ? `<span class="count">${children.length}</span>` : ''}</h3>
    <div class="linked">${list}</div>
    ${ds.asking ? askBox(owners) : owners.length ? `<button type="button" class="btn btn-secondary" data-act="ask" style="margin-top:${children.length ? 8 : 0}px">${icon('paper-plane-tilt', { weight: 'bold' })}Ask ${esc(ownerNames)}</button>` : ''}`;
  if (ds.asking) {
    const input = region.querySelector('[name="ask-title"]');
    input?.focus();
  }
}

function askBox(owners) {
  const picked = ds.askWho || (owners.length === 1 ? [owners[0].id] : []);
  ds.askWho = picked;
  return `<form class="ask-box" data-ask-form>
    <div class="field"><span class="label">Who do you need?</span>
      <div class="ask-who">${owners.map((o) => `<button type="button" class="who-toggle${picked.includes(o.id) ? ' is-on' : ''}" data-who="${o.id}" aria-pressed="${picked.includes(o.id)}">${avatar(o, 'av-md')}${esc(o.name)}</button>`).join('')}</div></div>
    <div class="field"><label class="label" for="ask-title">What do you need from them?</label>
      <input class="input" id="ask-title" name="ask-title" maxlength="200" placeholder="e.g. Sign off on the client allocation note"></div>
    <div class="field"><label class="label" for="ask-body">Details <span class="opt">(optional)</span></label>
      <textarea class="input" id="ask-body" name="ask-body" rows="3" placeholder="Context, deadline, links"></textarea></div>
    <div class="ask-actions"><button type="button" class="btn btn-ghost" data-act="ask-cancel">Cancel</button><button type="submit" class="btn btn-primary">Send request</button></div>
  </form>`;
}

function renderTimeline() {
  const region = ds.el.querySelector('[data-region="timeline"]');
  if (!region) return;
  if (!ds.detail) {
    region.innerHTML = `<h3>${icon('chats-circle')}Discussion</h3><div class="skel" style="height:14px;width:50%;margin:8px 0"></div><div class="skel" style="height:14px;width:70%;margin:12px 0"></div>`;
    return;
  }
  const items = [
    ...ds.detail.comment_list.map((c) => ({ ...c, type: 'comment' })),
    ...ds.detail.activity.filter((a) => a.action !== 'commented').map((a) => ({ ...a, type: 'event' })),
  ].sort((a, b) => a.created_at - b.created_at);
  const me = state.me;
  region.innerHTML = `
    <h3>${icon('chats-circle')}Discussion ${ds.detail.comment_list.length ? `<span class="count">${ds.detail.comment_list.length}</span>` : ''}</h3>
    <div class="timeline">
      ${items.map((i) => {
        const u = userById(i.user_id);
        const who = u ? (u.id === me.id ? 'You' : u.name) : 'Someone';
        if (i.type === 'comment') {
          return `<div class="comment">${avatar(u)}<div><div class="comment-head"><b>${esc(who)}</b><time datetime="${new Date(i.created_at).toISOString()}" title="${esc(new Date(i.created_at).toLocaleString())}">${esc(ago(i.created_at))}</time></div><div class="comment-body">${esc(i.body)}</div></div></div>`;
        }
        return `<div class="t-event"><span class="ev-icon">${activityIcon(i)}</span><span><b>${esc(who)}</b> ${describe(i, 'this')} <span>${esc(ago(i.created_at))}</span></span></div>`;
      }).join('')}
    </div>
    <form class="composer" data-comment-form>
      ${avatar(me)}
      <div class="composer-box">
        <textarea name="comment" rows="1" placeholder="Write a comment" aria-label="Write a comment" maxlength="4000"></textarea>
        <div class="composer-foot"><span class="hint">Ctrl + Enter to send</span><button type="submit" class="btn btn-primary">Comment</button></div>
      </div>
    </form>`;
  const ta = region.querySelector('textarea[name="comment"]');
  ta.addEventListener('input', () => autosize(ta));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); region.querySelector('[data-comment-form]').requestSubmit(); }
  });
}

function renderFoot() {
  const region = ds.el.querySelector('[data-region="foot"]');
  if (!region) return;
  const d = ds.draft;
  const adminIds = admins().map((a) => a.id);
  const toOwner = !isAdmin() && d.assignees.some((id) => adminIds.includes(id));
  const note = d.kind === 'request' || toOwner
    ? 'This will be sent as a request to Sujay or Karan.'
    : d.assignees.length ? '' : 'No one is assigned yet.';
  region.innerHTML = `<span class="hint">${esc(note)}</span>
    <button type="button" class="btn btn-ghost" data-act="close">Cancel</button>
    <button type="button" class="btn btn-primary" data-act="create" ${d.title.trim() ? '' : 'disabled'}>${d.kind === 'request' || toOwner ? 'Send request' : 'Create task'}</button>`;
}

// ---------- interactions ----------

async function onClick(e) {
  const el = e.target.closest('[data-act], [data-prop], [data-open-task], [data-who], [data-step]');
  if (!el || !ds) return;
  const t = current();

  if (el.dataset.step) {
    if (el.dataset.step === t.status) return;
    const to = el.dataset.step;
    setField({ status: to });
    if (ds.mode === 'view' && to === 'done') toast('Marked as done', { type: 'success' });
    return;
  }

  if (el.dataset.openTask) { navigate.open(Number(el.dataset.openTask)); return; }

  if (el.dataset.who) {
    const id = Number(el.dataset.who);
    ds.askWho = ds.askWho.includes(id) ? ds.askWho.filter((x) => x !== id) : [...ds.askWho, id];
    el.classList.toggle('is-on');
    el.setAttribute('aria-pressed', ds.askWho.includes(id));
    return;
  }

  const prop = el.dataset.prop;
  if (prop === 'status') {
    openMenu(el, {
      items: () => STATUS_ORDER.map((s) => ({ id: s, label: STATUS[s].label, iconHtml: statusIcon(s), checked: current().status === s })),
      onSelect: (s) => { setField({ status: s }); },
    });
    return;
  }
  if (prop === 'priority') {
    openMenu(el, {
      items: () => PRIORITY_ORDER.map((p) => ({ id: p, label: PRIORITY[p].label, iconHtml: prioIcon(p), checked: current().priority === p })),
      onSelect: (p) => { setField({ priority: p }); },
    });
    return;
  }
  if (prop === 'board') {
    openMenu(el, {
      items: () => state.boards.map((b) => ({ id: String(b.id), label: b.name, iconHtml: swatch(b), checked: current().board_id === b.id })),
      onSelect: (id) => { setField({ board_id: Number(id) }); },
    });
    return;
  }
  if (prop === 'assignees') {
    const options = assignableUsers();
    openMenu(el, {
      search: options.length > 6,
      placeholder: 'Find a person…',
      items: () => {
        const cur = current().assignees;
        const extra = cur.filter((id) => !options.some((o) => o.id === id)).map(userById).filter(Boolean);
        const rows = [...options, ...extra].map((u) => ({
          id: String(u.id),
          label: u.id === state.me.id ? `${u.name} (you)` : u.name,
          sub: u.role === 'admin' ? 'Owner' : u.title,
          iconHtml: avatar(u, 'av-sm'),
          checked: cur.includes(u.id),
          disabled: !canViewAll() && !options.some((o) => o.id === u.id),
        }));
        if (!canViewAll()) rows.push({ type: 'note', label: 'You can assign yourself, Sujay or Karan. Only they or a manager can assign other team members.' });
        return rows;
      },
      onSelect: (id) => {
        const uid = Number(id);
        const cur = current().assignees;
        const next = cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid];
        setField({ assignees: next });
        return true;
      },
    });
    return;
  }

  switch (el.dataset.act) {
    case 'close': closeDrawer(); break;
    case 'clear-due': setField({ due_date: null }); break;
    case 'more': moreMenu(el); break;
    case 'create': createFromDraft(el); break;
    case 'ask': ds.asking = true; ds.askWho = null; renderLinked(); bindAskForm(); break;
    case 'ask-cancel': ds.asking = false; renderLinked(); break;
    case 'toggle-check': toggleCheck(el); break;
    case 'remove-check': removeCheck(el); break;
    default: break;
  }
}

ds_bindForms();
function ds_bindForms() {
  document.addEventListener('submit', async (e) => {
    if (!ds) return;
    const form = e.target;
    if (form.matches('[data-comment-form]') && ds.el.contains(form)) {
      e.preventDefault();
      const ta = form.querySelector('textarea');
      const text = ta.value.trim();
      if (!text) return;
      const btn = form.querySelector('button[type="submit"]');
      setBusy(btn, true);
      try {
        const { comment } = await api(`tasks/${ds.id}/comments`, { method: 'POST', body: { body: text } });
        ds.detail.comment_list.push(comment);
        const t = state.tasks.get(ds.id);
        if (t) upsertTask({ ...t, comments: (t.comments || 0) + 1 });
        renderTimeline();
        const scroll = ds.el.querySelector('.drawer-scroll');
        scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' });
        ds.el.querySelector('textarea[name="comment"]')?.focus();
      } catch (err) {
        toastError(err);
        setBusy(btn, false);
      }
    }
    if (form.matches('[data-ask-form]') && ds.el.contains(form)) {
      e.preventDefault();
      const title = form.querySelector('[name="ask-title"]').value.trim();
      const body = form.querySelector('[name="ask-body"]').value.trim();
      if (!ds.askWho?.length) { toast('Choose who you need.', { type: 'error' }); return; }
      if (!title) { form.querySelector('[name="ask-title"]').focus(); toast('Say what you need from them.', { type: 'error' }); return; }
      const btn = form.querySelector('button[type="submit"]');
      setBusy(btn, true);
      const parent = state.tasks.get(ds.id);
      try {
        await createTask({ board_id: parent.board_id, kind: 'request', parent_id: parent.id, title, body, assignees: ds.askWho, priority: 'normal' });
        ds.asking = false;
        renderLinked();
        toast(`Request sent to ${ds.askWho.map((id) => firstName(userById(id))).join(' and ')}`, { type: 'success' });
      } catch (err) {
        toastError(err);
        setBusy(btn, false);
      }
    }
  });
}

function bindAskForm() {
  const input = ds.el.querySelector('[name="ask-title"]');
  input?.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); ds.asking = false; renderLinked(); } });
}

async function toggleCheck(btn) {
  const row = btn.closest('[data-check]');
  const item = ds.detail.checklist_items.find((i) => String(i.id) === row.dataset.check);
  if (!item) return;
  item.done = !item.done;
  row.classList.toggle('is-done', item.done);
  btn.setAttribute('aria-checked', item.done);
  bumpChecklist();
  const items = ds.detail.checklist_items;
  const bar = ds.el.querySelector('.progress-bar i');
  if (bar) bar.style.transform = `scaleX(${items.filter((i) => i.done).length / items.length})`;
  const count = ds.el.querySelector('[data-region="checklist"] h3 .count');
  if (count) count.textContent = `${items.filter((i) => i.done).length} of ${items.length}`;
  try {
    await api(`checklist/${item.id}`, { method: 'PATCH', body: { done: item.done } });
  } catch (err) {
    item.done = !item.done;
    bumpChecklist();
    renderChecklist();
    toastError(err);
  }
}

async function removeCheck(btn) {
  const row = btn.closest('[data-check]');
  const id = row.dataset.check;
  if (ds.mode === 'new') {
    ds.draft.checklist.splice(Number(id.slice(1)), 1);
    renderChecklist();
    return;
  }
  const items = ds.detail.checklist_items;
  const idx = items.findIndex((i) => String(i.id) === id);
  if (idx < 0) return;
  const [removed] = items.splice(idx, 1);
  bumpChecklist();
  renderChecklist();
  try {
    await api(`checklist/${id}`, { method: 'DELETE' });
  } catch (err) {
    items.splice(idx, 0, removed);
    bumpChecklist();
    renderChecklist();
    toastError(err);
  }
}

function moreMenu(anchor) {
  const t = current();
  openMenu(anchor, {
    align: 'end',
    items: () => [
      { id: 'copy', label: 'Copy link', iconHtml: icon('link-simple') },
      ...(canDelete(t) ? [{ type: 'sep' }, { id: 'delete', label: t.kind === 'request' ? 'Delete request' : 'Delete task', iconHtml: icon('trash'), danger: true }] : []),
    ],
    onSelect: (id) => {
      if (id === 'copy') {
        const url = `${location.origin}/admin/#/?t=${t.id}`;
        navigator.clipboard?.writeText(url).then(() => toast('Link copied', { type: 'success' }), () => toast(url));
      }
      if (id === 'delete') confirmDelete(t);
    },
  });
}

function confirmDelete(t) {
  openSheet(`
    <h2>Delete “${esc(t.title)}”?</h2>
    <p class="lede">This removes the ${t.kind === 'request' ? 'request' : 'task'}, its checklist and its discussion for everyone. This can’t be undone.</p>
    <div class="sheet-actions"><button class="btn btn-ghost" data-close type="button">Keep it</button><button class="btn btn-danger" data-confirm type="button">Delete</button></div>`, {
    label: 'Confirm delete',
    onMount: (sheet, close) => {
      sheet.querySelector('[data-confirm]').addEventListener('click', async (e) => {
        setBusy(e.currentTarget, true);
        try {
          await api(`tasks/${t.id}`, { method: 'DELETE' });
          close();
          closeDrawer();
          removeTask(t.id);
          for (const x of state.tasks.values()) if (x.parent_id === t.id) upsertTask({ ...x, parent_id: null });
          toast('Deleted', { type: 'success' });
        } catch (err) {
          setBusy(e.currentTarget, false);
          toastError(err);
        }
      });
    },
  });
}

async function createFromDraft(btn) {
  const d = ds.draft;
  if (!d.title.trim()) return;
  const adminIds = admins().map((a) => a.id);
  if (d.kind === 'request' && !d.assignees.some((id) => adminIds.includes(id))) {
    toast('Add Sujay or Karan to send this request.', { type: 'error' });
    return;
  }
  setBusy(btn, true);
  try {
    const task = await createTask({ ...d, title: d.title.trim() });
    const isRequest = task.kind === 'request';
    toast(isRequest ? 'Request sent' : 'Task created', { type: 'success' });
    navigate.open(task.id);
  } catch (err) {
    setBusy(btn, false);
    toastError(err);
  }
}
