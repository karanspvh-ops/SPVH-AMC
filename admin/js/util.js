import { state, userById, boardById } from './store.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const icon = (name, { fill = false, cls = '' } = {}) =>
  `<i class="${fill ? 'ph-fill' : 'ph'} ph-${name}${cls ? ' ' + cls : ''}" aria-hidden="true"></i>`;

export const STATUS = {
  todo: { label: 'To do', icon: 'circle-dashed', fill: false },
  doing: { label: 'In progress', icon: 'circle-half', fill: true },
  review: { label: 'In review', icon: 'clock-countdown', fill: true },
  done: { label: 'Done', icon: 'check-circle', fill: true },
};
export const STATUS_ORDER = ['todo', 'doing', 'review', 'done'];

export const PRIORITY = {
  urgent: { label: 'Urgent', icon: 'warning-circle', fill: true },
  high: { label: 'High', icon: 'cell-signal-full', fill: false },
  normal: { label: 'Normal', icon: 'cell-signal-medium', fill: false },
  low: { label: 'Low', icon: 'cell-signal-low', fill: false },
};
export const PRIORITY_ORDER = ['urgent', 'high', 'normal', 'low'];

export const BOARD_COLORS = {
  blue: '#496BAD', teal: '#47A996', gold: '#C9A84C', plum: '#7A5BA8', slate: '#5F6E82', rust: '#B5603F',
};

export const statusIcon = (status) => {
  const s = STATUS[status] || STATUS.todo;
  return icon(s.icon, { fill: s.fill, cls: `status-icon st-${status}` });
};

export const prioIcon = (priority) => {
  const p = PRIORITY[priority] || PRIORITY.normal;
  return icon(p.icon, { fill: p.fill, cls: `prio-icon prio-${priority}` });
};

export const swatch = (board) =>
  `<span class="board-swatch" style="background:${BOARD_COLORS[board?.color] || BOARD_COLORS.blue}"></span>`;

const AV_COLORS = ['#3B5B9A', '#2B7666', '#85661A', '#5E4F96', '#9C4A42', '#2B6F7F', '#4D6175', '#8D4A70'];
const PHOTOS = {
  'sujay.prakash@spvhgroup.com': '/assets/images/Sujay-1024.webp',
  'karan.nagda@spvhgroup.com': '/assets/images/Karan-updated-640-640.webp',
};

export const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';

export const firstName = (u) => (u?.name || '').trim().split(/\s+/)[0] || 'Someone';

export function avatar(user, size = '') {
  if (!user) return `<span class="av ${size} av-more" aria-hidden="true">?</span>`;
  const photo = PHOTOS[(user.email || '').toLowerCase()];
  const bg = AV_COLORS[user.id % AV_COLORS.length];
  const inner = photo ? `<img src="${photo}" alt="" loading="lazy" decoding="async">` : esc(initials(user.name));
  return `<span class="av ${size}" style="--av:${bg}" title="${esc(user.name)}">${inner}</span>`;
}

export function avatarStack(ids, max = 3, size = 'av-sm') {
  if (!ids?.length) return '';
  const users = ids.map(userById).filter(Boolean);
  const shown = users.slice(0, max).map((u) => avatar(u, size)).join('');
  const more = users.length > max ? `<span class="av ${size} av-more">+${users.length - max}</span>` : '';
  return `<span class="av-stack">${shown}${more}</span>`;
}

export const namesOf = (ids) => ids.map(userById).filter(Boolean).map((u) => u.name).join(', ');

// ---------- dates ----------

const DAY = 86400000;
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const daysUntil = (iso) => {
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((parseISO(iso) - today) / DAY);
};

const fmtShort = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtFull = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });

export const longToday = () => fmtLong.format(new Date());
export const shortDate = (iso) => fmtShort.format(parseISO(iso));
export const fullDate = (ms) => fmtFull.format(new Date(ms));

export function dueLabel(iso) {
  if (!iso) return '';
  const n = daysUntil(iso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return shortDate(iso);
}

export function dueBadge(task) {
  if (!task.due_date) return '';
  const n = daysUntil(task.due_date);
  const open = task.status !== 'done';
  const cls = open && n < 0 ? 'is-overdue' : open && n <= 1 ? 'is-soon' : '';
  return `<span class="due ${cls}">${icon('calendar-blank')}${esc(dueLabel(task.due_date))}</span>`;
}

export function ago(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return fullDate(ms);
}

export const timeOf = (ms) => fmtTime.format(new Date(ms));

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export const isOverdue = (t) => t.status !== 'done' && t.due_date && daysUntil(t.due_date) < 0;
export const taskRef = (t) => `SP-${t.id}`;
export const boardName = (id) => boardById(id)?.name || 'Board';
export const meId = () => state.me?.id;

export function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function debounce(fn, ms) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return d;
}

export function sortTasks(list) {
  return list.sort((a, b) => a.position - b.position || a.id - b.id);
}

export function byDue(a, b) {
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date) return -1;
  if (b.due_date) return 1;
  return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || b.updated_at - a.updated_at;
}
