import { state, userById, boardById, canEdit, patchTask } from './store.js';
import { esc, icon, statusIcon, prioIcon, dueBadge, avatarStack, avatar, swatch, firstName, STATUS, STATUS_ORDER } from './util.js';
import { openMenu, toast, toastError } from './ui.js';

export function taskRow(t, { board = true, requester = false } = {}) {
  const b = boardById(t.board_id);
  const parent = t.parent_id ? state.tasks.get(t.parent_id) : null;
  const creator = userById(t.created_by);
  const sub = [];
  if (requester && creator) sub.push(`<span>From ${esc(creator.id === state.me.id ? 'you' : firstName(creator))}</span>`);
  if (parent) sub.push(`<span>On “${esc(parent.title)}”</span>`);
  if (board && b) sub.push(`<span class="tag tag-board">${swatch(b)}${esc(b.name)}</span>`);
  if (t.kind === 'request' && !requester) sub.push('<span class="tag tag-request">Request</span>');
  const editable = canEdit(t);
  return `<div class="row${t.status === 'done' ? ' is-done' : ''}" role="button" tabindex="0" data-open="${t.id}">
    <button type="button" class="status-btn" data-status-menu="${t.id}" aria-label="Status: ${STATUS[t.status].label}" ${editable ? '' : 'disabled'}>${statusIcon(t.status)}</button>
    <div class="row-main">
      <div class="row-title">${esc(t.title)}</div>
      ${sub.length ? `<div class="row-sub">${sub.join('')}</div>` : ''}
    </div>
    <div class="row-meta">
      ${t.priority === 'urgent' || t.priority === 'high' ? prioIcon(t.priority) : ''}
      ${dueBadge(t)}
      ${requester && creator ? avatar(creator, 'av-sm') : avatarStack(t.assignees)}
    </div>
  </div>`;
}

export function statusMenu(anchor, task) {
  openMenu(anchor, {
    items: () => STATUS_ORDER.map((s) => ({ id: s, label: STATUS[s].label, iconHtml: statusIcon(s), checked: task.status === s })),
    onSelect: async (s) => {
      if (s === task.status) return;
      try {
        await patchTask(task.id, { status: s });
        if (s === 'done') toast('Marked as done', { type: 'success' });
      } catch (err) { toastError(err); }
    },
  });
}

/** Delegated click/keyboard handling for task rows inside `root`. */
export function bindRows(root, openTask) {
  root.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-status-menu]');
    if (sb) {
      e.stopPropagation();
      const task = state.tasks.get(Number(sb.dataset.statusMenu));
      if (task) statusMenu(sb, task);
      return;
    }
    const row = e.target.closest('[data-open]');
    if (row) openTask(Number(row.dataset.open));
  });
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open]')) {
      e.preventDefault();
      openTask(Number(e.target.dataset.open));
    }
  });
}

export const emptyState = (iconName, title, body, action = '') =>
  `<div class="empty">${icon(iconName)}<strong>${esc(title)}</strong>${body ? `<p>${esc(body)}</p>` : ''}${action}</div>`;
