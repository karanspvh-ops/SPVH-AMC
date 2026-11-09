import { state, userById } from './store.js';
import { esc, icon, STATUS, PRIORITY, shortDate } from './util.js';

const names = (ids = []) => {
  const list = ids.map(userById).filter(Boolean).map((u) => (u.id === state.me?.id ? 'you' : u.name.split(' ')[0]));
  if (list.length <= 1) return list[0] || 'someone';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
};

const ICONS = {
  created: 'plus-circle', requested: 'paper-plane-tilt', status: 'arrow-right', assigned: 'user-plus',
  commented: 'chat-circle', renamed: 'pencil-simple', priority: 'cell-signal-full', due: 'calendar-blank',
  moved: 'kanban', checked: 'check-square', deleted: 'trash', access: 'shield-check',
};
export const activityIcon = (a) => icon(ICONS[a.action] || 'dot-outline');

/** Returns an HTML sentence. `taskHtml` is the already-escaped task reference (link or "this"). */
export function describe(a, taskHtml) {
  const d = a.detail || {};
  const t = taskHtml;
  switch (a.action) {
    case 'created': return `created ${t}`;
    case 'requested': return `asked ${esc(names(d.assignees))} for input on ${t}`;
    case 'status': return `moved ${t} to <b>${esc(STATUS[d.to]?.label || d.to)}</b>`;
    case 'assigned': {
      const parts = [];
      if (d.added?.length) parts.push(`added ${esc(names(d.added))} to ${t}`);
      if (d.removed?.length) parts.push(`took ${esc(names(d.removed))} off ${t}`);
      return parts.join(' and ') || `updated people on ${t}`;
    }
    case 'commented': return `commented on ${t}`;
    case 'renamed': return `renamed ${t}`;
    case 'priority': return `set ${t} to <b>${esc(PRIORITY[d.to]?.label || d.to)}</b> priority`;
    case 'due': return d.to ? `set ${t} due <b>${esc(shortDate(d.to))}</b>` : `cleared the due date on ${t}`;
    case 'moved': return `moved ${t} to the <b>${esc(d.board)}</b> board`;
    case 'checked': return `checked off “${esc(d.text)}” on ${t}`;
    case 'deleted': return `deleted “${esc(d.title)}”`;
    case 'access':
      if (d.clearance === 'manager') return `gave <b>${esc(d.user)}</b> manager clearance`;
      if (d.clearance === 'member') return `removed manager clearance from <b>${esc(d.user)}</b>`;
      if (d.status === 'approved') return `approved access for <b>${esc(d.user)}</b>`;
      if (d.status === 'rejected') return `declined the access request from <b>${esc(d.user)}</b>`;
      return `turned off access for <b>${esc(d.user)}</b>`;
    default: return `updated ${t}`;
  }
}
