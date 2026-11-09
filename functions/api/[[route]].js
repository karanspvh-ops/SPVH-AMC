// SPVH Workspace API: Cloudflare Pages Function backed by D1 (binding: DB).
// Owners (full access) come from env.OWNER_EMAILS, falling back to the defaults below.

const DEFAULT_OWNERS = ['sujay.prakash@spvhgroup.com', 'karan.nagda@spvhgroup.com'];
const COOKIE = 'spvh_ws';
const PERSISTENT_TTL = 400 * 86400 * 1000;
const BROWSER_TTL = 12 * 3600 * 1000;
const PBKDF2_ITERATIONS = 100000;
const STATUSES = ['todo', 'doing', 'review', 'done'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const EVENT_KINDS = ['celebration', 'holiday', 'travel', 'work_travel', 'leave', 'meeting', 'other'];
const enc = new TextEncoder();

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    title TEXT, phone TEXT, note TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'pending',
    pass_hash TEXT NOT NULL, pass_salt TEXT NOT NULL,
    created_at INTEGER NOT NULL, reviewed_by INTEGER, reviewed_at INTEGER, last_seen_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, persistent INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ua TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '',
    color TEXT DEFAULT 'blue', position REAL NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER, created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, board_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'task', parent_id INTEGER,
    title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo', priority TEXT NOT NULL DEFAULT 'normal',
    due_date TEXT, position REAL NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS task_assignees (task_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (task_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS checklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0, position REAL NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    body TEXT NOT NULL, created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, board_id INTEGER, user_id INTEGER NOT NULL,
    action TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (email TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(board_id, status, position)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_assignees_user ON task_assignees(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_checklist_task ON checklist(task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_time ON activity(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_task ON activity(task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts(email, at)`,
];

// Each entry upgrades a live database one step; statements must be safe to re-run.
const MIGRATIONS = {
  2: [
    `ALTER TABLE users ADD COLUMN clearance TEXT NOT NULL DEFAULT 'member'`,
    `ALTER TABLE task_assignees ADD COLUMN assigned_by INTEGER`,
    `ALTER TABLE task_assignees ADD COLUMN assigned_at INTEGER`,
    `UPDATE task_assignees SET
       assigned_by = (SELECT created_by FROM tasks WHERE tasks.id = task_assignees.task_id),
       assigned_at = (SELECT created_at FROM tasks WHERE tasks.id = task_assignees.task_id)
     WHERE assigned_by IS NULL`,
    `CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other',
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, start_time TEXT, end_time TEXT,
      location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'team',
      created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_events_dates ON events(start_date, end_date)`,
  ],
};

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  await db.prepare('CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)').run();
  let version = (await db.prepare('SELECT version FROM schema_meta WHERE id = 1').first())?.version || 1;
  for (const v of Object.keys(MIGRATIONS).map(Number).sort((a, b) => a - b)) {
    if (version >= v) continue;
    for (const sql of MIGRATIONS[v]) {
      try {
        await db.prepare(sql).run();
      } catch (err) {
        if (!/duplicate column/i.test(String(err?.message))) throw err;
      }
    }
    await db.prepare('INSERT INTO schema_meta (id, version) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version').bind(v).run();
    version = v;
  }
  const board = await db.prepare('SELECT id FROM boards LIMIT 1').first();
  if (!board) {
    await db.prepare(`INSERT INTO boards (name, description, color, position, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind('General', 'Day-to-day work across the firm.', 'blue', 1, Date.now()).run();
  }
  schemaReady = true;
}

// ---------- helpers ----------

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { hash: b64(bits), salt: b64(salt) };
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function owners(env) {
  const list = (env.OWNER_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : DEFAULT_OWNERS;
}

function str(v, { max = 200, min = 0, field = 'Field' } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw new HttpError(400, min > 1 ? `${field} must be at least ${min} characters.` : `${field} is required.`);
  if (s.length > max) throw new HttpError(400, `${field} must be under ${max} characters.`);
  return s;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function sessionCookie(token, persistent, secure) {
  let c = `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Lax`;
  if (secure) c += '; Secure';
  if (persistent) c += `; Max-Age=${Math.floor(PERSISTENT_TTL / 1000)}`;
  return c;
}

function clearCookie(secure) {
  return `${COOKIE}=; Path=/api; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0`;
}

async function createSession(db, userId, persistent, ua) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = b64url(raw);
  const id = await sha256hex(token);
  const now = Date.now();
  await db.prepare('INSERT INTO sessions (id, user_id, persistent, created_at, expires_at, ua) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, userId, persistent ? 1 : 0, now, now + (persistent ? PERSISTENT_TTL : BROWSER_TTL), (ua || '').slice(0, 200)).run();
  return token;
}

const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, title: u.title || '', phone: u.phone || '',
  role: u.role, clearance: u.role === 'admin' ? 'owner' : u.clearance || 'member',
  status: u.status, created_at: u.created_at, last_seen_at: u.last_seen_at,
});

// Owners and managers can see and assign everyone's work; members only see their own.
const viewAll = (me) => me.role === 'admin' || me.clearance === 'manager';
const VISIBLE_TO_MEMBER = '(t.created_by = ? OR t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?))';

async function logActivity(db, { taskId = null, boardId = null, userId, action, detail = null }) {
  await db.prepare('INSERT INTO activity (task_id, board_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(taskId, boardId, userId, action, detail == null ? null : JSON.stringify(detail), Date.now()).run();
}

async function adminIds(db) {
  const { results } = await db.prepare(`SELECT id FROM users WHERE role = 'admin' AND status = 'approved'`).all();
  return results.map((r) => r.id);
}

// ---------- auth ----------

async function authenticate(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const id = await sha256hex(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS sid, s.persistent, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
  ).bind(id).first();
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now || row.status !== 'approved') {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }
  const ttl = row.persistent ? PERSISTENT_TTL : BROWSER_TTL;
  if (row.expires_at - now < ttl / 2 || !row.last_seen_at || now - row.last_seen_at > 5 * 60 * 1000) {
    await env.DB.batch([
      env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(now + ttl, id),
      env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now, row.id),
    ]);
  }
  return { ...row, sessionId: id };
}

async function signup(request, env, body) {
  const db = env.DB;
  const name = str(body.name, { min: 2, max: 80, field: 'Full name' });
  const email = str(body.email, { min: 3, max: 160, field: 'Email' }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (password.length > 200) throw new HttpError(400, 'Password is too long.');
  const title = str(body.title, { max: 80, field: 'Designation' });
  const phone = str(body.phone, { max: 30, field: 'Phone' });
  const note = str(body.note, { max: 1000, field: 'Reason' });

  const existing = await db.prepare('SELECT id, status FROM users WHERE email = ?').bind(email).first();
  if (existing) throw new HttpError(409, 'An account with this email already exists. Try signing in instead.');

  // Owner emails are unverified at sign-up, so they must also prove they hold the setup secret.
  const isOwner = owners(env).includes(email);
  if (isOwner) {
    if (!env.OWNER_SETUP_CODE) throw new HttpError(403, 'Owner sign-up isn’t switched on yet. Add the OWNER_SETUP_CODE secret in Cloudflare first.');
    const given = await sha256hex(String(body.setup_code || ''));
    const expected = await sha256hex(env.OWNER_SETUP_CODE);
    if (!body.setup_code || !safeEqual(given, expected)) {
      throw new HttpError(403, body.setup_code ? 'That owner setup code isn’t right.' : 'This email belongs to an owner. Enter the owner setup code to continue.', 'owner_code');
    }
  }
  const { hash, salt } = await hashPassword(password);
  const now = Date.now();
  const res = await db.prepare(
    `INSERT INTO users (email, name, title, phone, note, role, status, pass_hash, pass_salt, created_at, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(email, name, title, phone, note, isOwner ? 'admin' : 'member', isOwner ? 'approved' : 'pending', hash, salt, now, isOwner ? now : null).run();
  const userId = res.meta.last_row_id;

  if (!isOwner) return json({ status: 'pending' }, 201);

  const secure = new URL(request.url).protocol === 'https:';
  const persistent = !!body.remember;
  const token = await createSession(db, userId, persistent, request.headers.get('user-agent'));
  return json({ status: 'approved' }, 201, { 'set-cookie': sessionCookie(token, persistent, secure) });
}

async function login(request, env, body) {
  const db = env.DB;
  const email = str(body.email, { min: 3, max: 160, field: 'Email' }).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const now = Date.now();
  const windowStart = now - 15 * 60 * 1000;
  const attempts = await db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND at > ?').bind(email, windowStart).first();
  if (attempts.n >= 8) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  const check = await hashPassword(password, user ? user.pass_salt : b64(new Uint8Array(16)));
  if (!user || !safeEqual(check.hash, user.pass_hash)) {
    await db.batch([
      db.prepare('INSERT INTO login_attempts (email, at) VALUES (?, ?)').bind(email, now),
      db.prepare('DELETE FROM login_attempts WHERE at < ?').bind(now - 86400000),
    ]);
    throw new HttpError(401, 'That email and password don’t match.');
  }
  await db.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run();

  if (owners(env).includes(email) && user.status === 'approved' && user.role !== 'admin') {
    await db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).bind(user.id).run();
  }
  if (user.status === 'pending') throw new HttpError(403, 'Your access request is waiting for approval from Sujay or Karan.', 'pending');
  if (user.status === 'rejected') throw new HttpError(403, 'Your access request wasn’t approved. Contact Sujay or Karan if you think this is a mistake.', 'rejected');
  if (user.status === 'disabled') throw new HttpError(403, 'Your access has been turned off. Contact Sujay or Karan to restore it.', 'disabled');

  const secure = new URL(request.url).protocol === 'https:';
  const persistent = !!body.remember;
  const token = await createSession(db, user.id, persistent, request.headers.get('user-agent'));
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, persistent, secure) });
}

// ---------- data loading ----------

async function loadTasks(db, me, where = '1=1', binds = []) {
  const scope = viewAll(me) ? '' : ` AND ${VISIBLE_TO_MEMBER}`;
  const scopeBinds = viewAll(me) ? [] : [me.id, me.id];
  const { results: tasks } = await db.prepare(
    `SELECT t.id, t.board_id, t.kind, t.parent_id, t.title, t.status, t.priority, t.due_date, t.position, t.created_by,
       t.created_at, t.updated_at, t.completed_at, (length(t.body) > 0) AS has_body
     FROM tasks t WHERE (${where})${scope} ORDER BY t.position ASC`
  ).bind(...binds, ...scopeBinds).all();
  if (!tasks.length) return [];
  const [assignees, checks, comments] = await db.batch([
    db.prepare('SELECT task_id, user_id, assigned_by, assigned_at FROM task_assignees ORDER BY assigned_at ASC'),
    db.prepare('SELECT task_id, COUNT(*) AS total, SUM(done) AS done FROM checklist GROUP BY task_id'),
    db.prepare('SELECT task_id, COUNT(*) AS n FROM comments GROUP BY task_id'),
  ]);
  const aMap = new Map(), cMap = new Map(), kMap = new Map();
  for (const r of assignees.results) {
    if (!aMap.has(r.task_id)) aMap.set(r.task_id, []);
    aMap.get(r.task_id).push({ user_id: r.user_id, by: r.assigned_by, at: r.assigned_at });
  }
  for (const r of checks.results) cMap.set(r.task_id, { total: r.total, done: r.done || 0 });
  for (const r of comments.results) kMap.set(r.task_id, r.n);
  return tasks.map((t) => {
    const assignments = aMap.get(t.id) || [];
    return {
      ...t,
      has_body: !!t.has_body,
      assignees: assignments.map((x) => x.user_id),
      assignments,
      checklist: cMap.get(t.id) || { total: 0, done: 0 },
      comments: kMap.get(t.id) || 0,
    };
  });
}

async function loadTask(db, me, id) {
  const [t] = await loadTasks(db, me, 't.id = ?', [id]);
  if (!t) throw new HttpError(404, 'This task no longer exists, or it isn’t shared with you.');
  return t;
}

async function taskDetail(db, me, id) {
  const task = await loadTask(db, me, id);
  const [body, checklist, comments, activity] = await db.batch([
    db.prepare('SELECT body FROM tasks WHERE id = ?').bind(id),
    db.prepare('SELECT id, text, done, position FROM checklist WHERE task_id = ? ORDER BY position ASC, id ASC').bind(id),
    db.prepare('SELECT id, user_id, body, created_at FROM comments WHERE task_id = ? ORDER BY created_at ASC').bind(id),
    db.prepare('SELECT id, user_id, action, detail, created_at FROM activity WHERE task_id = ? ORDER BY created_at ASC').bind(id),
  ]);
  return {
    ...task,
    body: body.results[0]?.body || '',
    checklist_items: checklist.results.map((c) => ({ ...c, done: !!c.done })),
    comment_list: comments.results,
    activity: activity.results.map((a) => ({ ...a, detail: a.detail ? JSON.parse(a.detail) : null })),
  };
}

function canEdit(me, task) {
  return viewAll(me) || task.created_by === me.id || task.assignees.includes(me.id);
}

// `existing` assignees are kept as-is even if their access was later turned off.
async function checkAssignees(db, me, ids, existing = []) {
  if (!Array.isArray(ids)) throw new HttpError(400, 'Assignees must be a list.');
  const clean = [...new Set(ids.map(Number).filter(Number.isInteger))];
  const fresh = clean.filter((id) => !existing.includes(id));
  if (!fresh.length) return clean;
  const { results } = await db.prepare(
    `SELECT id, role FROM users WHERE status = 'approved' AND id IN (${fresh.map(() => '?').join(',')})`
  ).bind(...fresh).all();
  if (results.length !== fresh.length) throw new HttpError(400, 'One of the selected people no longer has access.');
  if (!viewAll(me)) {
    for (const u of results) {
      if (u.id !== me.id && u.role !== 'admin') throw new HttpError(403, 'Only Sujay, Karan or a manager can assign work to other team members.');
    }
  }
  return clean;
}

async function nextPosition(db, boardId, status) {
  const r = await db.prepare('SELECT MAX(position) AS p FROM tasks WHERE board_id = ? AND status = ?').bind(boardId, status).first();
  return (r?.p || 0) + 1024;
}

// ---------- handlers ----------

async function createTask(env, me, body) {
  const db = env.DB;
  const title = str(body.title, { min: 1, max: 200, field: 'Title' });
  const boardId = Number(body.board_id);
  const board = await db.prepare('SELECT id FROM boards WHERE id = ? AND archived = 0').bind(boardId).first();
  if (!board) throw new HttpError(400, 'Choose a board for this task.');
  const status = STATUSES.includes(body.status) ? body.status : 'todo';
  const priority = PRIORITIES.includes(body.priority) ? body.priority : 'normal';
  const due = body.due_date && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) ? body.due_date : null;
  const assignees = await checkAssignees(db, me, body.assignees || []);
  const admins = await adminIds(db);
  let kind = body.kind === 'request' ? 'request' : 'task';
  if (me.role !== 'admin' && assignees.some((id) => admins.includes(id))) kind = 'request';
  if (kind === 'request' && !assignees.some((id) => admins.includes(id))) {
    throw new HttpError(400, 'A request needs Sujay or Karan as an assignee.');
  }
  let parentId = null;
  if (body.parent_id) {
    const parent = await loadTask(db, me, Number(body.parent_id)).catch(() => null);
    if (!parent) throw new HttpError(400, 'The linked task no longer exists.');
    parentId = parent.id;
  }
  const textBody = typeof body.body === 'string' ? body.body.slice(0, 20000) : '';
  const now = Date.now();
  const position = Number.isFinite(body.position) ? body.position : await nextPosition(db, boardId, status);
  const res = await db.prepare(
    `INSERT INTO tasks (board_id, kind, parent_id, title, body, status, priority, due_date, position, created_by, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(boardId, kind, parentId, title, textBody, status, priority, due, position, me.id, now, now, status === 'done' ? now : null).run();
  const id = res.meta.last_row_id;
  const stmts = assignees.map((uid) =>
    db.prepare('INSERT INTO task_assignees (task_id, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)').bind(id, uid, me.id, now));
  if (Array.isArray(body.checklist)) {
    body.checklist.slice(0, 50).forEach((text, i) => {
      const t = typeof text === 'string' ? text.trim().slice(0, 300) : '';
      if (t) stmts.push(db.prepare('INSERT INTO checklist (task_id, text, position) VALUES (?, ?, ?)').bind(id, t, (i + 1) * 1024));
    });
  }
  if (stmts.length) await db.batch(stmts);
  await logActivity(db, { taskId: id, boardId, userId: me.id, action: kind === 'request' ? 'requested' : 'created', detail: { title, assignees } });
  return json({ task: await loadTask(db, me, id) }, 201);
}

async function updateTask(env, me, id, body) {
  const db = env.DB;
  const task = await loadTask(db, me, id);
  if (!canEdit(me, task)) throw new HttpError(403, 'Only the people on this task, a manager, or Sujay and Karan can change it.');
  const sets = [], binds = [], log = [];

  if ('title' in body) {
    const title = str(body.title, { min: 1, max: 200, field: 'Title' });
    if (title !== task.title) { sets.push('title = ?'); binds.push(title); log.push(['renamed', { from: task.title, to: title }]); }
  }
  if ('body' in body) {
    sets.push('body = ?'); binds.push(typeof body.body === 'string' ? body.body.slice(0, 20000) : '');
  }
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) throw new HttpError(400, 'Unknown status.');
    if (body.status !== task.status) {
      sets.push('status = ?', 'completed_at = ?');
      binds.push(body.status, body.status === 'done' ? Date.now() : null);
      log.push(['status', { from: task.status, to: body.status }]);
    }
  }
  if ('priority' in body) {
    if (!PRIORITIES.includes(body.priority)) throw new HttpError(400, 'Unknown priority.');
    if (body.priority !== task.priority) { sets.push('priority = ?'); binds.push(body.priority); log.push(['priority', { to: body.priority }]); }
  }
  if ('due_date' in body) {
    const due = body.due_date && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) ? body.due_date : null;
    if (due !== task.due_date) { sets.push('due_date = ?'); binds.push(due); log.push(['due', { to: due }]); }
  }
  if ('board_id' in body) {
    const board = await db.prepare('SELECT id, name FROM boards WHERE id = ? AND archived = 0').bind(Number(body.board_id)).first();
    if (!board) throw new HttpError(400, 'That board doesn’t exist.');
    if (board.id !== task.board_id) { sets.push('board_id = ?'); binds.push(board.id); log.push(['moved', { board: board.name }]); }
  }
  if ('position' in body && Number.isFinite(body.position)) { sets.push('position = ?'); binds.push(body.position); }

  const stmts = [];
  if ('assignees' in body) {
    const next = await checkAssignees(db, me, body.assignees, task.assignees);
    const added = next.filter((x) => !task.assignees.includes(x));
    const removed = task.assignees.filter((x) => !next.includes(x));
    if (!viewAll(me)) {
      const admins = await adminIds(db);
      if (removed.some((x) => x !== me.id && !admins.includes(x))) {
        throw new HttpError(403, 'Only Sujay, Karan or a manager can take other people off a task.');
      }
    }
    const now = Date.now();
    for (const uid of removed) stmts.push(db.prepare('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?').bind(id, uid));
    for (const uid of added) {
      stmts.push(db.prepare('INSERT INTO task_assignees (task_id, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)').bind(id, uid, me.id, now));
    }
    if (added.length || removed.length) log.push(['assigned', { added, removed }]);
  }

  sets.push('updated_at = ?'); binds.push(Date.now());
  stmts.unshift(db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id));
  await db.batch(stmts);
  for (const [action, detail] of log) {
    await logActivity(db, { taskId: id, boardId: task.board_id, userId: me.id, action, detail });
  }
  return json({ task: await loadTask(db, me, id) });
}

async function deleteTask(env, me, id) {
  const db = env.DB;
  const task = await loadTask(db, me, id);
  if (me.role !== 'admin' && task.created_by !== me.id) throw new HttpError(403, 'Only the person who created this task, or Sujay and Karan, can delete it.');
  await db.batch([
    db.prepare('DELETE FROM tasks WHERE id = ?').bind(id),
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?').bind(id),
    db.prepare('DELETE FROM checklist WHERE task_id = ?').bind(id),
    db.prepare('DELETE FROM comments WHERE task_id = ?').bind(id),
    db.prepare('UPDATE tasks SET parent_id = NULL WHERE parent_id = ?').bind(id),
    db.prepare('DELETE FROM activity WHERE task_id = ?').bind(id),
  ]);
  await logActivity(db, { boardId: task.board_id, userId: me.id, action: 'deleted', detail: { title: task.title } });
  return json({ ok: true });
}

// ---------- calendar events ----------

const canSeeEvent = (me, e) => e.visibility === 'team' || e.created_by === me.id || me.role === 'admin';

function readEvent(body, existing = {}) {
  const merged = { ...existing, ...body };
  const title = str(merged.title, { min: 1, max: 120, field: 'Event title' });
  const kind = EVENT_KINDS.includes(merged.kind) ? merged.kind : 'other';
  const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const time = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
  const start = date(merged.start_date);
  if (!start) throw new HttpError(400, 'Choose a start date.');
  const end = date(merged.end_date) || start;
  if (end < start) throw new HttpError(400, 'The end date can’t be before the start date.');
  return {
    title, kind, start_date: start, end_date: end,
    start_time: time(merged.start_time), end_time: time(merged.end_time),
    location: str(merged.location, { max: 120, field: 'Location' }),
    notes: str(merged.notes, { max: 2000, field: 'Notes' }),
    visibility: merged.visibility === 'private' ? 'private' : 'team',
  };
}

async function listEvents(db, me) {
  const { results } = await db.prepare(
    me.role === 'admin'
      ? 'SELECT * FROM events ORDER BY start_date ASC, start_time ASC'
      : `SELECT * FROM events WHERE visibility = 'team' OR created_by = ? ORDER BY start_date ASC, start_time ASC`
  ).bind(...(me.role === 'admin' ? [] : [me.id])).all();
  return results;
}

async function routeApi(request, env, segs, me) {
  const db = env.DB;
  const method = request.method;
  const body = method === 'GET' || method === 'DELETE' ? {} : await request.json().catch(() => ({}));
  const isAdmin = me.role === 'admin';
  const [a, b, c] = segs;

  if (a === 'me' && !b && method === 'GET') return json({ me: publicUser(me) });

  if (a === 'me' && !b && method === 'PATCH') {
    const name = 'name' in body ? str(body.name, { min: 2, max: 80, field: 'Full name' }) : me.name;
    const title = 'title' in body ? str(body.title, { max: 80, field: 'Designation' }) : me.title;
    const phone = 'phone' in body ? str(body.phone, { max: 30, field: 'Phone' }) : me.phone;
    await db.prepare('UPDATE users SET name = ?, title = ?, phone = ? WHERE id = ?').bind(name, title, phone, me.id).run();
    return json({ me: publicUser({ ...me, name, title, phone }) });
  }

  if (a === 'me' && b === 'password' && method === 'POST') {
    const check = await hashPassword(String(body.current || ''), me.pass_salt);
    if (!safeEqual(check.hash, me.pass_hash)) throw new HttpError(400, 'Your current password isn’t right.');
    const next = String(body.next || '');
    if (next.length < 8) throw new HttpError(400, 'New password must be at least 8 characters.');
    const { hash, salt } = await hashPassword(next);
    await db.batch([
      db.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').bind(hash, salt, me.id),
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(me.id, me.sessionId),
    ]);
    return json({ ok: true });
  }

  if (a === 'bootstrap' && method === 'GET') {
    const [users, boards, pending, former] = await db.batch([
      db.prepare(`SELECT * FROM users WHERE status = 'approved' ORDER BY role = 'admin' DESC, name ASC`),
      db.prepare('SELECT * FROM boards WHERE archived = 0 ORDER BY position ASC, id ASC'),
      db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'pending'`),
      db.prepare(`SELECT id, name, title, role, status FROM users WHERE status = 'disabled'`),
    ]);
    const tasks = await loadTasks(db, me);
    const events = await listEvents(db, me);
    return json({
      me: publicUser(me),
      users: users.results.map(publicUser),
      former: former.results,
      boards: boards.results,
      tasks,
      events,
      pending: isAdmin ? pending.results[0].n : 0,
    });
  }

  if (a === 'activity' && method === 'GET') {
    const limit = Math.min(Number(new URL(request.url).searchParams.get('limit')) || 30, 100);
    // Members only see activity on their own tasks; access changes are for owners only.
    const scope = viewAll(me)
      ? (isAdmin ? '' : `WHERE a.action != 'access'`)
      : `WHERE a.task_id IN (SELECT t.id FROM tasks t WHERE ${VISIBLE_TO_MEMBER})`;
    const { results } = await db.prepare(
      `SELECT a.id, a.task_id, a.board_id, a.user_id, a.action, a.detail, a.created_at, tk.title AS task_title
       FROM activity a LEFT JOIN tasks tk ON tk.id = a.task_id ${scope} ORDER BY a.created_at DESC LIMIT ?`
    ).bind(...(viewAll(me) ? [] : [me.id, me.id]), limit).all();
    return json({ activity: results.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })) });
  }

  // calendar events
  if (a === 'events') {
    if (!b && method === 'GET') return json({ events: await listEvents(db, me) });
    if (!b && method === 'POST') {
      const e = readEvent(body);
      const now = Date.now();
      const res = await db.prepare(
        `INSERT INTO events (title, kind, start_date, end_date, start_time, end_time, location, notes, visibility, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(e.title, e.kind, e.start_date, e.end_date, e.start_time, e.end_time, e.location, e.notes, e.visibility, me.id, now, now).run();
      return json({ event: await db.prepare('SELECT * FROM events WHERE id = ?').bind(res.meta.last_row_id).first() }, 201);
    }
    const existing = b ? await db.prepare('SELECT * FROM events WHERE id = ?').bind(Number(b)).first() : null;
    if (!existing || !canSeeEvent(me, existing)) throw new HttpError(404, 'That event no longer exists.');
    if (existing.created_by !== me.id && !isAdmin) throw new HttpError(403, 'Only the person who added this event, or Sujay and Karan, can change it.');
    if (method === 'PATCH') {
      const e = readEvent(body, existing);
      await db.prepare(
        `UPDATE events SET title = ?, kind = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?, location = ?, notes = ?, visibility = ?, updated_at = ? WHERE id = ?`
      ).bind(e.title, e.kind, e.start_date, e.end_date, e.start_time, e.end_time, e.location, e.notes, e.visibility, Date.now(), existing.id).run();
      return json({ event: await db.prepare('SELECT * FROM events WHERE id = ?').bind(existing.id).first() });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM events WHERE id = ?').bind(existing.id).run();
      return json({ ok: true });
    }
  }

  // users / access approvals
  if (a === 'users') {
    if (!b && method === 'GET') {
      if (!isAdmin) throw new HttpError(403, 'Only Sujay or Karan can review access.');
      const { results } = await db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
      const own = owners(env);
      return json({ users: results.map((u) => ({ ...publicUser(u), note: u.note || '', owner: own.includes(u.email.toLowerCase()) })) });
    }
    if (b && method === 'PATCH') {
      if (!isAdmin) throw new HttpError(403, 'Only Sujay or Karan can change access.');
      const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(Number(b)).first();
      if (!target) throw new HttpError(404, 'That person no longer exists.');
      if (owners(env).includes(target.email.toLowerCase())) throw new HttpError(400, 'Owner access can’t be changed.');
      const next = { ...target };
      const stmts = [];
      if ('status' in body) {
        if (!['approved', 'rejected', 'disabled'].includes(body.status)) throw new HttpError(400, 'Unknown access status.');
        next.status = body.status;
        stmts.push(db.prepare('UPDATE users SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').bind(body.status, me.id, Date.now(), target.id));
        if (body.status !== 'approved') stmts.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id));
      }
      if ('clearance' in body) {
        if (!['member', 'manager'].includes(body.clearance)) throw new HttpError(400, 'Unknown clearance level.');
        next.clearance = body.clearance;
        stmts.push(db.prepare('UPDATE users SET clearance = ? WHERE id = ?').bind(body.clearance, target.id));
      }
      if (!stmts.length) throw new HttpError(400, 'Nothing to change.');
      await db.batch(stmts);
      if ('status' in body) await logActivity(db, { userId: me.id, action: 'access', detail: { user: target.name, status: body.status } });
      if ('clearance' in body) await logActivity(db, { userId: me.id, action: 'access', detail: { user: target.name, clearance: body.clearance } });
      return json({ user: publicUser(next) });
    }
  }

  // boards
  if (a === 'boards') {
    if (!b && method === 'POST') {
      if (!isAdmin) throw new HttpError(403, 'Only Sujay or Karan can create boards.');
      const name = str(body.name, { min: 1, max: 60, field: 'Board name' });
      const description = str(body.description, { max: 240, field: 'Description' });
      const color = ['blue', 'teal', 'gold', 'plum', 'slate', 'rust'].includes(body.color) ? body.color : 'blue';
      const max = await db.prepare('SELECT MAX(position) AS p FROM boards').first();
      const res = await db.prepare('INSERT INTO boards (name, description, color, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(name, description, color, (max?.p || 0) + 1, me.id, Date.now()).run();
      const board = await db.prepare('SELECT * FROM boards WHERE id = ?').bind(res.meta.last_row_id).first();
      return json({ board }, 201);
    }
    if (b && method === 'PATCH') {
      if (!isAdmin) throw new HttpError(403, 'Only Sujay or Karan can edit boards.');
      const board = await db.prepare('SELECT * FROM boards WHERE id = ?').bind(Number(b)).first();
      if (!board) throw new HttpError(404, 'That board doesn’t exist.');
      const name = 'name' in body ? str(body.name, { min: 1, max: 60, field: 'Board name' }) : board.name;
      const description = 'description' in body ? str(body.description, { max: 240, field: 'Description' }) : board.description;
      const color = ['blue', 'teal', 'gold', 'plum', 'slate', 'rust'].includes(body.color) ? body.color : board.color;
      const archived = 'archived' in body ? (body.archived ? 1 : 0) : board.archived;
      if (archived) {
        const count = await db.prepare('SELECT COUNT(*) AS n FROM boards WHERE archived = 0').first();
        if (count.n <= 1) throw new HttpError(400, 'Keep at least one board.');
      }
      await db.prepare('UPDATE boards SET name = ?, description = ?, color = ?, archived = ? WHERE id = ?').bind(name, description, color, archived, board.id).run();
      return json({ board: { ...board, name, description, color, archived } });
    }
  }

  // tasks
  if (a === 'tasks') {
    if (!b && method === 'POST') return createTask(env, me, body);
    const id = Number(b);
    if (!Number.isInteger(id)) throw new HttpError(404, 'Not found.');
    if (!c && method === 'GET') return json({ task: await taskDetail(db, me, id) });
    if (!c && method === 'PATCH') return updateTask(env, me, id, body);
    if (!c && method === 'DELETE') return deleteTask(env, me, id);

    if (c === 'comments' && method === 'POST') {
      await loadTask(db, me, id);
      const text = str(body.body, { min: 1, max: 4000, field: 'Comment' });
      const now = Date.now();
      const res = await db.prepare('INSERT INTO comments (task_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').bind(id, me.id, text, now).run();
      await db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').bind(now, id).run();
      await logActivity(db, { taskId: id, userId: me.id, action: 'commented', detail: { excerpt: text.slice(0, 120) } });
      return json({ comment: { id: res.meta.last_row_id, user_id: me.id, body: text, created_at: now } }, 201);
    }

    if (c === 'checklist' && method === 'POST') {
      const task = await loadTask(db, me, id);
      if (!canEdit(me, task)) throw new HttpError(403, 'Only the people on this task can edit its checklist.');
      const text = str(body.text, { min: 1, max: 300, field: 'Checklist item' });
      const max = await db.prepare('SELECT MAX(position) AS p FROM checklist WHERE task_id = ?').bind(id).first();
      const res = await db.prepare('INSERT INTO checklist (task_id, text, position) VALUES (?, ?, ?)').bind(id, text, (max?.p || 0) + 1024).run();
      return json({ item: { id: res.meta.last_row_id, text, done: false } }, 201);
    }
  }

  if (a === 'checklist' && b) {
    const item = await db.prepare('SELECT * FROM checklist WHERE id = ?').bind(Number(b)).first();
    if (!item) throw new HttpError(404, 'That checklist item no longer exists.');
    const task = await loadTask(db, me, item.task_id);
    if (!canEdit(me, task)) throw new HttpError(403, 'Only the people on this task can edit its checklist.');
    if (method === 'PATCH') {
      const text = 'text' in body ? str(body.text, { min: 1, max: 300, field: 'Checklist item' }) : item.text;
      const done = 'done' in body ? (body.done ? 1 : 0) : item.done;
      await db.prepare('UPDATE checklist SET text = ?, done = ? WHERE id = ?').bind(text, done, item.id).run();
      if (done && !item.done) await logActivity(db, { taskId: task.id, userId: me.id, action: 'checked', detail: { text } });
      return json({ item: { id: item.id, text, done: !!done } });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM checklist WHERE id = ?').bind(item.id).run();
      return json({ ok: true });
    }
  }

  throw new HttpError(404, 'Not found.');
}

export async function onRequest(context) {
  const { request, env, params } = context;
  try {
    if (!env.DB) throw new HttpError(500, 'The workspace database isn’t connected yet.');
    if (request.method !== 'GET' && request.headers.get('x-spvh') !== '1') {
      throw new HttpError(403, 'Request blocked.');
    }
    await ensureSchema(env.DB);
    const segs = Array.isArray(params.route) ? params.route : [params.route].filter(Boolean);
    const [a, b] = segs;
    const secure = new URL(request.url).protocol === 'https:';

    if (a === 'auth') {
      if (b === 'signup' && request.method === 'POST') return await signup(request, env, await request.json().catch(() => ({})));
      if (b === 'login' && request.method === 'POST') return await login(request, env, await request.json().catch(() => ({})));
      if (b === 'logout' && request.method === 'POST') {
        const token = readCookie(request, COOKIE);
        if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256hex(token)).run();
        return json({ ok: true }, 200, { 'set-cookie': clearCookie(secure) });
      }
      throw new HttpError(404, 'Not found.');
    }

    const me = await authenticate(request, env);
    if (!me) return json({ error: 'Please sign in.', code: 'auth' }, 401, { 'set-cookie': clearCookie(secure) });
    return await routeApi(request, env, segs, me);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong on our side. Try again in a moment.' }, 500);
  }
}
