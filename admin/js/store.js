import { api } from './api.js';

const listeners = new Set();
let queued = false;

export const state = {
  me: null,
  users: [],
  usersById: new Map(),
  boards: [],
  tasks: new Map(),
  pending: 0,
  activity: [],
  loaded: false,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    for (const fn of listeners) fn();
  });
}

export async function loadAll() {
  const data = await api('bootstrap');
  state.me = data.me;
  setUsers(data.users, data.former);
  state.boards = data.boards;
  state.tasks = new Map(data.tasks.map((t) => [t.id, t]));
  state.pending = data.pending;
  state.loaded = true;
  emit();
}

export async function loadActivity() {
  const { activity } = await api('activity?limit=40');
  state.activity = activity;
  state.activityLoaded = true;
  emit();
}

// `former` are people whose access was turned off: kept only so their names still show on past work.
export function setUsers(users, former = []) {
  state.users = users;
  state.usersById = new Map([...former, ...users].map((u) => [u.id, u]));
}

export function reset() {
  state.me = null;
  state.users = [];
  state.usersById = new Map();
  state.boards = [];
  state.tasks = new Map();
  state.pending = 0;
  state.activity = [];
  state.loaded = false;
}

export const isAdmin = () => state.me?.role === 'admin';
export const admins = () => state.users.filter((u) => u.role === 'admin');
export const userById = (id) => state.usersById.get(id);
export const boardById = (id) => state.boards.find((b) => b.id === id);
export const allTasks = () => [...state.tasks.values()];

export function canEdit(task) {
  const me = state.me;
  if (!me || !task) return false;
  return me.role === 'admin' || task.created_by === me.id || task.assignees.includes(me.id);
}

export function canDelete(task) {
  const me = state.me;
  return !!me && (me.role === 'admin' || task.created_by === me.id);
}

export function assignableUsers() {
  if (isAdmin()) return state.users;
  return state.users.filter((u) => u.id === state.me.id || u.role === 'admin');
}

export function upsertTask(task) {
  const prev = state.tasks.get(task.id);
  state.tasks.set(task.id, { ...prev, ...task });
  emit();
}

export function removeTask(id) {
  state.tasks.delete(id);
  emit();
}

// Optimistic patch: apply locally, persist, roll back on failure.
export async function patchTask(id, patch) {
  const prev = state.tasks.get(id);
  if (!prev) return;
  state.tasks.set(id, { ...prev, ...patch, updated_at: Date.now() });
  emit();
  try {
    const { task } = await api(`tasks/${id}`, { method: 'PATCH', body: patch });
    state.tasks.set(id, { ...state.tasks.get(id), ...task });
    emit();
    return task;
  } catch (err) {
    state.tasks.set(id, prev);
    emit();
    throw err;
  }
}

export async function createTask(payload) {
  const { task } = await api('tasks', { method: 'POST', body: payload });
  state.tasks.set(task.id, task);
  emit();
  return task;
}
