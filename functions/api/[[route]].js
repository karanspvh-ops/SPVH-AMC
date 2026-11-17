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
// Web Push (VAPID). The private half lives in the VAPID_PRIVATE_KEY secret.
const VAPID_PUBLIC_KEY = 'BPaZ_X7JEWCyS0KBZSp9aD3PUcsb5gN1PwjSE0xEFh0U1JfzooGK-_VzFJzwLKkc5hE0UuM6jZU4hpUaZm4L4gs';
const VAPID_SUBJECT = 'https://www.spvhamc.com';

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
  3: [
    `ALTER TABLE tasks ADD COLUMN pooled INTEGER NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS task_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, kind TEXT NOT NULL,
      from_user INTEGER NOT NULL, to_user INTEGER, note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, resolved_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_transfers_task ON task_transfers(task_id)`,
    `CREATE INDEX IF NOT EXISTS idx_transfers_to ON task_transfers(to_user, status)`,
  ],
  4: [
    `ALTER TABLE boards ADD COLUMN owner_id INTEGER`,
    `ALTER TABLE boards ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shown'`,
    `CREATE TABLE IF NOT EXISTS board_access (
      board_id INTEGER NOT NULL, user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      requested_at INTEGER NOT NULL, decided_by INTEGER, decided_at INTEGER,
      PRIMARY KEY (board_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_board_access_user ON board_access(user_id, status)`,
  ],
  5: [
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
      ua TEXT, created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)`,
  ],
  6: [
    `ALTER TABLE tasks ADD COLUMN recurrence_id INTEGER`,
    `ALTER TABLE tasks ADD COLUMN dup_of INTEGER`,
    `ALTER TABLE tasks ADD COLUMN dup_reason TEXT`,
    `ALTER TABLE users ADD COLUMN reports_to INTEGER`,
    `CREATE TABLE IF NOT EXISTS recurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
      board_id INTEGER NOT NULL, priority TEXT NOT NULL DEFAULT 'normal',
      assignees TEXT NOT NULL DEFAULT '[]', checklist TEXT NOT NULL DEFAULT '[]',
      freq TEXT NOT NULL, anchor_day INTEGER NOT NULL, next_due TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_recurrence ON tasks(recurrence_id)`,
    `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
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
  status: u.status, created_at: u.created_at, last_seen_at: u.last_seen_at, reports_to: u.reports_to || null,
});

// Owners and managers can see and assign everyone's work; members only see their own.
const viewAll = (me) => me.role === 'admin' || me.clearance === 'manager';
// Everyone except Sujay and Karan sees: tasks they created or are on, open pool tasks, tasks offered to them,
// every task on personal boards they may view (their own, shown ones, hidden ones they were approved for),
// and, for managers only, every task on team boards.
const VISIBLE_TO_MEMBER = `(t.created_by = ? OR t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)
  OR (t.pooled = 1 AND t.status != 'done' AND NOT EXISTS (SELECT 1 FROM task_assignees x WHERE x.task_id = t.id))
  OR t.id IN (SELECT task_id FROM task_transfers WHERE to_user = ? AND status = 'pending')
  OR t.board_id IN (SELECT vb.id FROM boards vb WHERE vb.owner_id IS NOT NULL AND (vb.owner_id = ? OR vb.visibility = 'shown'
       OR vb.id IN (SELECT board_id FROM board_access WHERE user_id = ? AND status = 'approved')))
  OR (? = 1 AND t.board_id IN (SELECT id FROM boards WHERE owner_id IS NULL)))`;
const memberBinds = (me) => [me.id, me.id, me.id, me.id, me.id, me.clearance === 'manager' ? 1 : 0];
const seesAll = (me) => me.role === 'admin';

async function logActivity(db, { taskId = null, boardId = null, userId, action, detail = null }) {
  await db.prepare('INSERT INTO activity (task_id, board_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(taskId, boardId, userId, action, detail == null ? null : JSON.stringify(detail), Date.now()).run();
}

async function adminIds(db) {
  const { results } = await db.prepare(`SELECT id FROM users WHERE role = 'admin' AND status = 'approved'`).all();
  return results.map((r) => r.id);
}


// ---------- web push ----------

const b64urlDecode = (s) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
const concatBytes = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** RFC 8291 (aes128gcm) encryption of one push message for one subscription. */
async function encryptPush(sub, plaintext) {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concatBytes(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concatBytes(header, asPublic, body);
}

let vapidKey = null;
async function vapidHeader(env, endpoint) {
  if (!vapidKey) {
    const pubRaw = b64urlDecode(VAPID_PUBLIC_KEY);
    vapidKey = await crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY,
      x: b64url(pubRaw.slice(1, 33)), y: b64url(pubRaw.slice(33, 65)), ext: true,
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  const part = (o) => b64url(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapidKey, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${VAPID_PUBLIC_KEY}`;
}

async function sendPush(env, sub, payload) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(env, sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body: await encryptPush(sub, enc.encode(JSON.stringify(payload))),
  });
  if (res.status === 404 || res.status === 410) {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
  } else if (!res.ok) {
    console.warn('push failed', res.status, await res.text().catch(() => ''));
  }
}

/** Sends queued notifications after the response has gone out. Never throws. */
async function flushNotifications(env, queue) {
  if (!queue.length || !env.VAPID_PRIVATE_KEY) return;
  for (const { userIds, payload } of queue) {
    try {
      const ids = [...new Set(userIds)].filter(Number.isInteger);
      if (!ids.length) continue;
      const { results } = await env.DB.prepare(
        `SELECT * FROM push_subscriptions WHERE user_id IN (${ids.map(() => '?').join(',')})`
      ).bind(...ids).all();
      await Promise.all(results.map((sub) => sendPush(env, sub, payload).catch((err) => console.warn('push error', err))));
    } catch (err) {
      console.warn('notify error', err);
    }
  }
}

/** Queue a notification for people other than the person acting. */
function notify(env, me, userIds, payload) {
  if (!env.notifyQueue) return;
  const ids = (userIds || []).filter((id) => id && id !== me?.id);
  if (ids.length) env.notifyQueue.push({ userIds: ids, payload: { tag: 'spvh', ...payload } });
}

const firstNameOf = (u) => (u?.name || 'Someone').split(' ')[0];
const taskUrl = (id) => `/admin/#/?t=${id}`;

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

  if (!isOwner) {
    notify(env, null, await adminIds(db), { title: 'New access request', body: `${name} wants to join the workspace.`, url: '/admin/#/team', tag: 'access' });
    return json({ status: 'pending' }, 201);
  }

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
  const scope = seesAll(me) ? '' : ` AND ${VISIBLE_TO_MEMBER}`;
  const scopeBinds = seesAll(me) ? [] : memberBinds(me);
  const { results: tasks } = await db.prepare(
    `SELECT t.id, t.board_id, t.kind, t.parent_id, t.title, t.status, t.priority, t.due_date, t.position, t.created_by,
       t.created_at, t.updated_at, t.completed_at, t.pooled, t.recurrence_id, t.dup_of, t.dup_reason, (length(t.body) > 0) AS has_body,
       (SELECT bo.owner_id FROM boards bo WHERE bo.id = t.board_id) AS board_owner,
       CASE WHEN t.pooled = 1 THEN substr(t.body, 1, 280) END AS body_preview,
       (SELECT tr.note FROM task_transfers tr WHERE tr.task_id = t.id AND tr.kind IN ('handover', 'release') AND tr.note != ''
         ORDER BY tr.created_at DESC LIMIT 1) AS handover_note,
       (SELECT tr.from_user FROM task_transfers tr WHERE tr.task_id = t.id AND tr.kind IN ('handover', 'release') AND tr.note != ''
         ORDER BY tr.created_at DESC LIMIT 1) AS handover_by
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
      pooled: !!t.pooled,
      dup_of: viewAll(me) ? t.dup_of : null,
      dup_reason: viewAll(me) ? t.dup_reason : null,
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
  const transfers = await db.prepare('SELECT * FROM task_transfers WHERE task_id = ? ORDER BY created_at ASC').bind(id).all();
  const events = activity.results.map((a) => ({ ...a, detail: a.detail ? JSON.parse(a.detail) : null }));
  let duplicate = null;
  if (task.dup_of) {
    duplicate = await db.prepare('SELECT id, title, status, completed_at, recurrence_id FROM tasks WHERE id = ?').bind(task.dup_of).first();
  }
  return {
    transfers: transfers.results,
    timing: me.role === 'admin' ? stageTiming(task, events) : null,
    duplicate,
    ...task,
    body: body.results[0]?.body || '',
    checklist_items: checklist.results.map((c) => ({ ...c, done: !!c.done })),
    comment_list: comments.results,
    activity: viewAll(me) ? events : events.filter((a) => a.action !== 'flagged'),
  };
}

function canEdit(me, task) {
  return viewAll(me) || task.created_by === me.id || task.assignees.includes(me.id) || task.board_owner === me.id;
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
  const board = await db.prepare('SELECT id, owner_id FROM boards WHERE id = ? AND archived = 0').bind(boardId).first();
  if (board && !canAddToBoard(me, board)) throw new HttpError(403, 'Only the board’s owner can add tasks to it.');
  if (!board) throw new HttpError(400, 'Choose a board for this task.');
  const status = STATUSES.includes(body.status) ? body.status : 'todo';
  const priority = PRIORITIES.includes(body.priority) ? body.priority : 'normal';
  const due = body.due_date && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) ? body.due_date : null;
  const pooled = body.pooled === true && body.kind !== 'request';
  if (pooled && !viewAll(me)) throw new HttpError(403, 'Only Sujay, Karan or a manager can add tasks to the pool.');
  if (pooled && board.owner_id != null) throw new HttpError(400, 'Pool tasks go on a team board, not a personal one.');
  if (FREQS.includes(body.repeat)) {
    if (!viewAll(me)) throw new HttpError(403, 'Only Sujay, Karan or a manager can set up repeating tasks.');
    if (pooled || body.kind === 'request') throw new HttpError(400, 'Pool tasks and requests can’t repeat.');
    if (!due) throw new HttpError(400, 'Set a due date first. The schedule repeats from it.');
  }
  const assignees = pooled ? [] : await checkAssignees(db, me, body.assignees || []);
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
  const textBody = typeof body.body === 'string' ? body.body.slice(0, pooled ? 600 : 20000) : '';
  const now = Date.now();
  const position = Number.isFinite(body.position) ? body.position : await nextPosition(db, boardId, status);
  const res = await db.prepare(
    `INSERT INTO tasks (board_id, kind, parent_id, title, body, status, priority, due_date, position, created_by, created_at, updated_at, completed_at, pooled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(boardId, kind, parentId, title, textBody, pooled ? 'todo' : status, priority, due, position, me.id, now, now, !pooled && status === 'done' ? now : null, pooled ? 1 : 0).run();
  const id = res.meta.last_row_id;
  const stmts = assignees.map((uid) =>
    db.prepare('INSERT INTO task_assignees (task_id, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)').bind(id, uid, me.id, now));
  if (!pooled && Array.isArray(body.checklist)) {
    body.checklist.slice(0, 50).forEach((text, i) => {
      const t = typeof text === 'string' ? text.trim().slice(0, 300) : '';
      if (t) stmts.push(db.prepare('INSERT INTO checklist (task_id, text, position) VALUES (?, ?, ?)').bind(id, t, (i + 1) * 1024));
    });
  }
  if (stmts.length) await db.batch(stmts);
  await logActivity(db, { taskId: id, boardId, userId: me.id, action: kind === 'request' ? 'requested' : pooled ? 'pooled' : 'created', detail: { title, assignees } });
  if (pooled) {
    const { results: everyone } = await db.prepare(`SELECT id FROM users WHERE status = 'approved'`).all();
    notify(env, me, everyone.map((u) => u.id), { title: 'New in the task pool', body: `${title}. Claim it if you can take it on.`, url: '/admin/#/pool', tag: `pool-${id}` });
  } else if (kind === 'request') {
    notify(env, me, assignees, { title: `${firstNameOf(me)} needs your input`, body: title, url: taskUrl(id), tag: `task-${id}` });
  } else {
    notify(env, me, assignees, { title: `${firstNameOf(me)} assigned you a task`, body: title, url: taskUrl(id), tag: `task-${id}` });
  }
  if (kind === 'task' && FREQS.includes(body.repeat)) {
    if (!viewAll(me)) throw new HttpError(403, 'Only Sujay, Karan or a manager can set up repeating tasks.');
    await makeRecurring(db, me, id, body.repeat);
  } else if (kind === 'task') {
    await checkDuplicate(env, me, id, title);
  }
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
    const board = await db.prepare('SELECT id, name, owner_id FROM boards WHERE id = ? AND archived = 0').bind(Number(body.board_id)).first();
    if (!board) throw new HttpError(400, 'That board doesn’t exist.');
    if (board.id !== task.board_id && !canAddToBoard(me, board)) throw new HttpError(403, 'Only the board’s owner can move tasks onto it.');
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
    if (added.length) notify(env, me, added, { title: `${firstNameOf(me)} assigned you a task`, body: task.title, url: taskUrl(id), tag: `task-${id}` });
  }

  sets.push('updated_at = ?'); binds.push(Date.now());
  stmts.unshift(db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id));
  await db.batch(stmts);
  for (const [action, detail] of log) {
    await logActivity(db, { taskId: id, boardId: task.board_id, userId: me.id, action, detail });
  }
  if (log.some(([action]) => action === 'renamed') && task.kind === 'task' && !task.dup_of && !task.recurrence_id) {
    await checkDuplicate(env, me, id, body.title);
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


// ---------- task pool: claim, release, invite, handover ----------

const isOpenInPool = (t) => t.pooled && !t.assignees.length && t.status !== 'done';

async function returnToPool(db, taskId) {
  await db.batch([
    db.prepare(`UPDATE tasks SET pooled = 1, status = 'todo', completed_at = NULL, updated_at = ? WHERE id = ?`).bind(Date.now(), taskId),
    db.prepare(`UPDATE task_transfers SET status = 'cancelled', resolved_at = ? WHERE task_id = ? AND status = 'pending'`).bind(Date.now(), taskId),
  ]);
}

async function claimTask(env, me, id) {
  const db = env.DB;
  const task = await loadTask(db, me, id);
  if (!isOpenInPool(task)) throw new HttpError(409, 'Someone has already claimed this task.');
  const now = Date.now();
  // Only one claim can win: the insert does nothing if anyone is already on the task.
  const res = await db.prepare(
    `INSERT INTO task_assignees (task_id, user_id, assigned_by, assigned_at)
     SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM task_assignees WHERE task_id = ?)`
  ).bind(id, me.id, me.id, now, id).run();
  if (!res.meta.changes) throw new HttpError(409, 'Someone claimed this task a moment before you.');
  await db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').bind(now, id).run();
  await logActivity(db, { taskId: id, boardId: task.board_id, userId: me.id, action: 'claimed', detail: { title: task.title } });
  return json({ task: await loadTask(db, me, id) });
}

async function releaseTask(env, me, id, body) {
  const db = env.DB;
  if (!viewAll(me)) throw new HttpError(403, 'Only Sujay, Karan or a manager can put tasks back in the pool. Hand it over to a colleague instead.');
  const task = await loadTask(db, me, id);
  if (task.status === 'done') throw new HttpError(400, 'This task is already done.');
  const note = str(body.note, { max: 2000, field: 'Handover note' });
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?').bind(id),
    db.prepare(`INSERT INTO task_transfers (task_id, kind, from_user, to_user, note, status, created_at, resolved_at) VALUES (?, 'release', ?, NULL, ?, 'done', ?, ?)`).bind(id, me.id, note, now, now),
  ]);
  await returnToPool(db, id);
  await logActivity(db, { taskId: id, boardId: task.board_id, userId: me.id, action: 'released', detail: { title: task.title } });
  return json({ task: await loadTask(db, me, id) });
}

async function offerTask(env, me, id, body) {
  const db = env.DB;
  const task = await loadTask(db, me, id);
  const kind = body.kind === 'handover' ? 'handover' : 'invite';
  if (!task.assignees.includes(me.id) && !viewAll(me)) throw new HttpError(403, 'Only people working on this task can invite others or hand it over.');
  if (task.status === 'done') throw new HttpError(400, 'This task is already done.');
  if (kind === 'handover' && !task.assignees.includes(me.id)) throw new HttpError(400, 'You can only hand over a task you are working on.');
  const to = await db.prepare(`SELECT id, name FROM users WHERE id = ? AND status = 'approved'`).bind(Number(body.to_user)).first();
  if (!to) throw new HttpError(400, 'Choose someone who has access to the workspace.');
  if (to.id === me.id) throw new HttpError(400, 'Choose someone other than yourself.');
  if (task.assignees.includes(to.id)) throw new HttpError(400, `${to.name} is already working on this task.`);
  const pending = await db.prepare(`SELECT kind, to_user FROM task_transfers WHERE task_id = ? AND status = 'pending'`).bind(id).all();
  if (kind === 'handover' && pending.results.some((r) => r.kind === 'handover')) throw new HttpError(409, 'A handover is already waiting for an answer.');
  if (pending.results.some((r) => r.to_user === to.id)) throw new HttpError(409, `${to.name} already has a request waiting on this task.`);
  const note = str(body.note, { max: 2000, field: 'Note' });
  const now = Date.now();
  const res = await db.prepare(
    `INSERT INTO task_transfers (task_id, kind, from_user, to_user, note, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(id, kind, me.id, to.id, note, now).run();
  await logActivity(db, { taskId: id, boardId: task.board_id, userId: me.id, action: kind === 'handover' ? 'handover_asked' : 'invited', detail: { to: to.id } });
  notify(env, me, [to.id], {
    title: kind === 'handover' ? `${firstNameOf(me)} wants to hand over a task` : `${firstNameOf(me)} invited you to a task`,
    body: note ? `${task.title}: ${note.slice(0, 120)}` : task.title, url: taskUrl(id), tag: `task-${id}`,
  });
  return json({ transfer: await db.prepare('SELECT * FROM task_transfers WHERE id = ?').bind(res.meta.last_row_id).first() }, 201);
}

async function answerTransfer(env, me, transferId, action) {
  const db = env.DB;
  const tr = await db.prepare('SELECT * FROM task_transfers WHERE id = ?').bind(transferId).first();
  if (!tr || tr.status !== 'pending') throw new HttpError(404, 'This request has already been answered or withdrawn.');
  const now = Date.now();
  const task = await db.prepare('SELECT id, board_id, title FROM tasks WHERE id = ?').bind(tr.task_id).first();
  if (!task) throw new HttpError(404, 'This task no longer exists.');

  if (action === 'cancel') {
    if (tr.from_user !== me.id && !viewAll(me)) throw new HttpError(403, 'Only the person who sent this request can withdraw it.');
    await db.prepare(`UPDATE task_transfers SET status = 'cancelled', resolved_at = ? WHERE id = ?`).bind(now, tr.id).run();
    return json({ ok: true });
  }
  if (tr.to_user !== me.id) throw new HttpError(403, 'This request is for someone else.');

  if (action === 'accept') {
    const stmts = [db.prepare(`UPDATE task_transfers SET status = 'accepted', resolved_at = ? WHERE id = ?`).bind(now, tr.id)];
    if (tr.kind === 'handover') stmts.push(db.prepare('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?').bind(tr.task_id, tr.from_user));
    stmts.push(db.prepare(
      `INSERT INTO task_assignees (task_id, user_id, assigned_by, assigned_at)
       SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?)`
    ).bind(tr.task_id, me.id, tr.from_user, now, tr.task_id, me.id));
    stmts.push(db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').bind(now, tr.task_id));
    await db.batch(stmts);
    await logActivity(db, { taskId: tr.task_id, boardId: task.board_id, userId: me.id, action: tr.kind === 'handover' ? 'handover_accepted' : 'invite_accepted', detail: { from: tr.from_user } });
    notify(env, me, [tr.from_user], { title: tr.kind === 'handover' ? `${firstNameOf(me)} took over your task` : `${firstNameOf(me)} joined your task`, body: task.title, url: taskUrl(tr.task_id), tag: `task-${tr.task_id}` });
    return json({ task: await loadTask(db, me, tr.task_id) });
  }

  if (action === 'decline') {
    await db.prepare(`UPDATE task_transfers SET status = 'declined', resolved_at = ? WHERE id = ?`).bind(now, tr.id).run();
    let pooled = false;
    if (tr.kind === 'handover') {
      // The person handing over asked to leave the task: they come off it, and if nobody is left it returns to the pool.
      await db.prepare('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?').bind(tr.task_id, tr.from_user).run();
      const left = await db.prepare('SELECT COUNT(*) AS n FROM task_assignees WHERE task_id = ?').bind(tr.task_id).first();
      if (!left.n) {
        await returnToPool(db, tr.task_id);
        pooled = true;
      }
    }
    await logActivity(db, { taskId: tr.task_id, boardId: task.board_id, userId: me.id, action: tr.kind === 'handover' ? 'handover_declined' : 'invite_declined', detail: { from: tr.from_user, pooled } });
    notify(env, me, [tr.from_user], {
      title: tr.kind === 'handover' ? `${firstNameOf(me)} declined your handover` : `${firstNameOf(me)} declined your invitation`,
      body: pooled ? `${task.title} went back to the task pool.` : task.title, url: taskUrl(tr.task_id), tag: `task-${tr.task_id}`,
    });
    return json({ ok: true, pooled });
  }
  throw new HttpError(404, 'Not found.');
}

async function listTransfers(db, me) {
  const { results } = await db.prepare(
    seesAll(me)
      ? `SELECT * FROM task_transfers WHERE status = 'pending' ORDER BY created_at DESC`
      : `SELECT * FROM task_transfers WHERE status = 'pending' AND (to_user = ? OR from_user = ?) ORDER BY created_at DESC`
  ).bind(...(seesAll(me) ? [] : [me.id, me.id])).all();
  return results;
}


// ---------- boards: team boards (no owner) and personal boards ----------

const BOARD_COLORS = ['blue', 'teal', 'gold', 'plum', 'slate', 'rust'];
const canAddToBoard = (me, b) => me.role === 'admin' || b.owner_id == null || b.owner_id === me.id;
const canManageBoard = (me, b) => me.role === 'admin' || (b.owner_id != null && b.owner_id === me.id);

async function listBoards(db, me) {
  const { results } = await db.prepare(
    `SELECT b.*, (SELECT status FROM board_access ba WHERE ba.board_id = b.id AND ba.user_id = ?) AS my_access
     FROM boards b WHERE b.archived = 0 ORDER BY (b.owner_id IS NOT NULL), b.position ASC, b.id ASC`
  ).bind(me.id).all();
  return results.map((b) => {
    let access;
    if (b.owner_id == null) access = 'team';
    else if (b.owner_id === me.id) access = 'owner';
    else if (me.role === 'admin') access = 'admin';
    else if (b.visibility === 'shown') access = 'open';
    else if (b.my_access === 'approved') access = 'approved';
    else if (b.my_access === 'pending') access = 'pending';
    else access = 'locked';
    const locked = access === 'locked' || access === 'pending';
    const { my_access, ...rest } = b;
    return { ...rest, description: locked ? '' : rest.description, access };
  });
}

async function boardRequests(db, me) {
  const { results } = await db.prepare(
    `SELECT ba.board_id, ba.user_id, ba.requested_at, b.name AS board_name, b.owner_id
     FROM board_access ba JOIN boards b ON b.id = ba.board_id
     WHERE ba.status = 'pending' AND b.archived = 0 AND (b.owner_id = ? OR ? = 1) ORDER BY ba.requested_at DESC`
  ).bind(me.id, me.role === 'admin' ? 1 : 0).all();
  return results;
}

async function boardsRoute(request, env, me, b, c, d, method, body) {
  const db = env.DB;
  const isAdmin = me.role === 'admin';
  if (!b && method === 'POST') {
    const name = str(body.name, { min: 1, max: 60, field: 'Board name' });
    const description = str(body.description, { max: 240, field: 'Description' });
    const color = BOARD_COLORS.includes(body.color) ? body.color : 'blue';
    const team = isAdmin && body.team === true;
    const visibility = body.visibility === 'hidden' && !team ? 'hidden' : 'shown';
    const max = await db.prepare('SELECT MAX(position) AS p FROM boards').first();
    const res = await db.prepare(
      'INSERT INTO boards (name, description, color, position, created_by, created_at, owner_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(name, description, color, (max?.p || 0) + 1, me.id, Date.now(), team ? null : me.id, visibility).run();
    const board = (await listBoards(db, me)).find((x) => x.id === res.meta.last_row_id);
    return json({ board }, 201);
  }

  const board = b ? await db.prepare('SELECT * FROM boards WHERE id = ?').bind(Number(b)).first() : null;
  if (!board) throw new HttpError(404, 'That board doesn’t exist.');

  if (!c && method === 'PATCH') {
    if (!canManageBoard(me, board)) throw new HttpError(403, 'Only the board’s owner, Sujay or Karan can change this board.');
    const name = 'name' in body ? str(body.name, { min: 1, max: 60, field: 'Board name' }) : board.name;
    const description = 'description' in body ? str(body.description, { max: 240, field: 'Description' }) : board.description;
    const color = BOARD_COLORS.includes(body.color) ? body.color : board.color;
    const visibility = board.owner_id == null ? 'shown' : body.visibility === 'hidden' ? 'hidden' : body.visibility === 'shown' ? 'shown' : board.visibility;
    const archived = 'archived' in body ? (body.archived ? 1 : 0) : board.archived;
    if (archived && board.owner_id == null) {
      const count = await db.prepare('SELECT COUNT(*) AS n FROM boards WHERE archived = 0 AND owner_id IS NULL').first();
      if (count.n <= 1) throw new HttpError(400, 'Keep at least one team board.');
    }
    await db.prepare('UPDATE boards SET name = ?, description = ?, color = ?, visibility = ?, archived = ? WHERE id = ?')
      .bind(name, description, color, visibility, archived, board.id).run();
    return json({ board: (await listBoards(db, me)).find((x) => x.id === board.id) || { ...board, archived } });
  }

  if (c === 'access') {
    if (board.owner_id == null) throw new HttpError(400, 'Team boards are open to the whole team.');
    if (!d && method === 'GET') {
      if (!canManageBoard(me, board)) throw new HttpError(403, 'Only the board’s owner can see who has access.');
      const { results } = await db.prepare('SELECT user_id, status, requested_at, decided_at FROM board_access WHERE board_id = ? ORDER BY requested_at DESC').bind(board.id).all();
      return json({ access: results });
    }
    if (!d && method === 'POST') {
      if (board.owner_id === me.id || isAdmin) throw new HttpError(400, 'You can already see this board.');
      if (board.visibility === 'shown') throw new HttpError(400, 'This board is open to everyone already.');
      const existing = await db.prepare('SELECT status FROM board_access WHERE board_id = ? AND user_id = ?').bind(board.id, me.id).first();
      if (existing?.status === 'approved') throw new HttpError(400, 'You already have access to this board.');
      await db.prepare(
        `INSERT INTO board_access (board_id, user_id, status, requested_at) VALUES (?, ?, 'pending', ?)
         ON CONFLICT(board_id, user_id) DO UPDATE SET status = 'pending', requested_at = excluded.requested_at, decided_by = NULL, decided_at = NULL`
      ).bind(board.id, me.id, Date.now()).run();
      notify(env, me, [board.owner_id], { title: `${firstNameOf(me)} asked to see your board`, body: board.name, url: '/admin/#/', tag: `board-${board.id}` });
      return json({ ok: true, status: 'pending' }, 201);
    }
    const uid = Number(d);
    const action = request.url.split('/').pop().split('?')[0];
    if (method === 'POST' && Number.isInteger(uid) && ['approve', 'decline', 'revoke'].includes(action)) {
      if (!canManageBoard(me, board)) throw new HttpError(403, 'Only the board’s owner, Sujay or Karan can decide who sees it.');
      const target = await db.prepare(`SELECT id FROM users WHERE id = ? AND status = 'approved'`).bind(uid).first();
      if (!target) throw new HttpError(400, 'That person no longer has access to the workspace.');
      if (action === 'revoke') {
        await db.prepare('DELETE FROM board_access WHERE board_id = ? AND user_id = ?').bind(board.id, uid).run();
      } else {
        const status = action === 'approve' ? 'approved' : 'declined';
        await db.prepare(
          `INSERT INTO board_access (board_id, user_id, status, requested_at, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(board_id, user_id) DO UPDATE SET status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at`
        ).bind(board.id, uid, status, Date.now(), me.id, Date.now()).run();
        if (status === 'approved') notify(env, me, [uid], { title: `${firstNameOf(me)} shared a board with you`, body: board.name, url: `/admin/#/board/${board.id}`, tag: `board-${board.id}` });
      }
      return json({ ok: true });
    }
  }
  throw new HttpError(404, 'Not found.');
}


// ---------- repeating tasks ----------

const FREQS = ['weekly', 'monthly', 'quarterly', 'yearly'];
const LEAD_DAYS = { weekly: 2, monthly: 5, quarterly: 10, yearly: 14 };
const isoUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const todayIST = () => isoUTC(Date.now() + 5.5 * 3600 * 1000);
const addDaysISO = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoUTC(Date.UTC(y, m - 1, d + n)); };

function advanceDue(iso, freq, anchor) {
  const [y, m, d] = iso.split('-').map(Number);
  if (freq === 'weekly') return isoUTC(Date.UTC(y, m - 1, d + 7));
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[freq];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return isoUTC(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(anchor, lastDay)));
}

async function makeRecurring(db, me, taskId, freq) {
  const t = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
  if (!t) throw new HttpError(404, 'This task no longer exists.');
  if (t.kind !== 'task' || t.pooled) throw new HttpError(400, 'Only regular tasks can repeat.');
  if (!t.due_date) throw new HttpError(400, 'Set a due date first. The schedule repeats from it.');
  if (t.recurrence_id) {
    const existing = await db.prepare(`SELECT status FROM recurrences WHERE id = ?`).bind(t.recurrence_id).first();
    if (existing && existing.status !== 'stopped') throw new HttpError(400, 'This task already repeats.');
  }
  const [assignees, checklist] = await db.batch([
    db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').bind(taskId),
    db.prepare('SELECT text FROM checklist WHERE task_id = ? ORDER BY position ASC, id ASC').bind(taskId),
  ]);
  const anchor = Number(t.due_date.slice(8, 10));
  const now = Date.now();
  const res = await db.prepare(
    `INSERT INTO recurrences (title, body, board_id, priority, assignees, checklist, freq, anchor_day, next_due, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  ).bind(t.title, t.body, t.board_id, t.priority, JSON.stringify(assignees.results.map((r) => r.user_id)),
    JSON.stringify(checklist.results.map((r) => r.text)), freq, anchor, advanceDue(t.due_date, freq, anchor), me.id, now, now).run();
  await db.prepare('UPDATE tasks SET recurrence_id = ?, dup_of = NULL, dup_reason = NULL WHERE id = ?').bind(res.meta.last_row_id, taskId).run();
  await logActivity(db, { taskId, boardId: t.board_id, userId: me.id, action: 'repeat_set', detail: { freq } });
  return res.meta.last_row_id;
}

async function listRecurrences(db, me) {
  const { results } = await db.prepare(
    `SELECT r.*, (SELECT MAX(id) FROM tasks WHERE recurrence_id = r.id) AS last_task_id,
       (SELECT COUNT(*) FROM tasks WHERE recurrence_id = r.id) AS copies
     FROM recurrences r WHERE r.status != 'stopped' ORDER BY r.next_due ASC`
  ).all();
  const rows = results.map((r) => ({ ...r, assignees: JSON.parse(r.assignees), checklist: JSON.parse(r.checklist) }));
  return viewAll(me) ? rows : rows.filter((r) => r.created_by === me.id || r.assignees.includes(me.id));
}

/** Creates each repeating task's next copy once its lead window opens. Runs at most every few minutes. */
async function runRecurrences(env) {
  const db = env.DB;
  const now = Date.now();
  const last = await db.prepare(`SELECT value FROM app_meta WHERE key = 'recur_last'`).first();
  if (last && now - Number(last.value) < 3 * 60 * 1000) return;
  const claim = await db.prepare(
    `INSERT INTO app_meta (key, value) VALUES ('recur_last', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE CAST(app_meta.value AS INTEGER) < ?`
  ).bind(String(now), now - 3 * 60 * 1000).run();
  if (!claim.meta.changes) return;

  const today = todayIST();
  const { results } = await db.prepare(`SELECT * FROM recurrences WHERE status = 'active'`).all();
  for (const r of results) {
    const horizon = addDaysISO(today, LEAD_DAYS[r.freq] || 3);
    if (r.next_due > horizon) continue;
    // Missed cycles are skipped: only the latest occurrence inside the window is created.
    let due = r.next_due;
    let next = advanceDue(due, r.freq, r.anchor_day);
    while (next <= horizon) { due = next; next = advanceDue(due, r.freq, r.anchor_day); }
    const moved = await db.prepare('UPDATE recurrences SET next_due = ?, updated_at = ? WHERE id = ? AND next_due = ?')
      .bind(next, now, r.id, r.next_due).run();
    if (!moved.meta.changes) continue;

    let board = await db.prepare('SELECT id FROM boards WHERE id = ? AND archived = 0').bind(r.board_id).first();
    if (!board) board = await db.prepare('SELECT id FROM boards WHERE archived = 0 AND owner_id IS NULL ORDER BY position LIMIT 1').first();
    const assignees = JSON.parse(r.assignees);
    const { results: active } = assignees.length
      ? await db.prepare(`SELECT id FROM users WHERE status = 'approved' AND id IN (${assignees.map(() => '?').join(',')})`).bind(...assignees).all()
      : { results: [] };
    const position = await nextPosition(db, board.id, 'todo');
    const res = await db.prepare(
      `INSERT INTO tasks (board_id, kind, title, body, status, priority, due_date, position, created_by, created_at, updated_at, recurrence_id)
       VALUES (?, 'task', ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(board.id, r.title, r.body, r.priority, due, position, r.created_by, now, now, r.id).run();
    const id = res.meta.last_row_id;
    const stmts = active.map((u) => db.prepare('INSERT INTO task_assignees (task_id, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)').bind(id, u.id, r.created_by, now));
    JSON.parse(r.checklist).forEach((text, i) => stmts.push(db.prepare('INSERT INTO checklist (task_id, text, position) VALUES (?, ?, ?)').bind(id, text, (i + 1) * 1024)));
    if (stmts.length) await db.batch(stmts);
    await logActivity(db, { taskId: id, boardId: board.id, userId: r.created_by, action: 'repeated', detail: { due } });
    if (env.notifyQueue && active.length) {
      env.notifyQueue.push({ userIds: active.map((u) => u.id), payload: { title: 'New this cycle', body: `${r.title}, due ${due}`, url: taskUrl(id), tag: `task-${id}` } });
    }
  }
}

// ---------- duplicate check ----------

const DUP_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'our', 'all', 'new', 'task']);
const MONTH_WORDS = new Set(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'q1', 'q2', 'q3', 'q4', 'fy', 'week', 'weekly', 'month', 'monthly', 'quarter', 'quarterly', 'annual', 'yearly']);

function titleWords(title) {
  return new Set(String(title).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !DUP_STOP.has(w) && !MONTH_WORDS.has(w)));
}

function looksSame(a, b) {
  const A = titleWords(a), B = titleWords(b);
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  const union = A.size + B.size - shared;
  return shared / union >= 0.75;
}

/** Flags a task added by anyone below owner level that repeats completed one-off work or a repeating task. */
async function checkDuplicate(env, me, taskId, title) {
  if (me.role === 'admin') return;
  const db = env.DB;
  const since = Date.now() - 400 * 86400 * 1000;
  const { results } = await db.prepare(
    `SELECT id, title, status, recurrence_id, completed_at FROM tasks
     WHERE id != ? AND kind = 'task' AND ((status = 'done' AND recurrence_id IS NULL AND completed_at > ?) OR recurrence_id IS NOT NULL)
     ORDER BY (recurrence_id IS NOT NULL) DESC, completed_at DESC LIMIT 2000`
  ).bind(taskId, since).all();
  const match = results.find((t) => looksSame(title, t.title));
  if (!match) return;
  const reason = match.recurrence_id ? 'repeating' : 'completed';
  await db.prepare('UPDATE tasks SET dup_of = ?, dup_reason = ? WHERE id = ?').bind(match.id, reason, taskId).run();
  await logActivity(db, { taskId, userId: me.id, action: 'flagged', detail: { of: match.id, title: match.title, reason } });
  const owners = await adminIds(db);
  const boss = me.reports_to ? [me.reports_to] : [];
  notify(env, null, [...boss, ...owners].filter((id) => id !== me.id), {
    title: `Possible duplicate from ${firstNameOf(me)}`,
    body: reason === 'repeating'
      ? `“${title}” looks like the repeating task “${match.title}”.`
      : `“${title}” looks like “${match.title}”, which is already done.`,
    url: taskUrl(taskId), tag: `dup-${taskId}`,
  });
}

// ---------- time in each stage (owners only) ----------

function stageTiming(task, events) {
  const at = (e) => e.created_at;
  const claims = events.filter((e) => e.action === 'claimed');
  const lastClaim = claims[claims.length - 1];
  let start = task.created_at;
  let poolWait = null;
  if (lastClaim) {
    const pooledBefore = events.filter((e) => at(e) <= at(lastClaim) && (e.action === 'pooled' || e.action === 'released' || (e.action === 'handover_declined' && e.detail?.pooled)));
    const enteredPool = pooledBefore.length ? at(pooledBefore[pooledBefore.length - 1]) : task.created_at;
    poolWait = at(lastClaim) - enteredPool;
    start = at(lastClaim);
  }
  const changes = events.filter((e) => e.action === 'status' && at(e) >= start);
  const firstAfterStart = changes[0];
  let current = lastClaim ? 'todo' : (firstAfterStart?.detail?.from || events.find((e) => e.action === 'status')?.detail?.from || task.status);
  const spans = { todo: 0, doing: 0, review: 0 };
  let t0 = start;
  let doneAt = null;
  for (const e of changes) {
    if (current !== 'done') spans[current] = (spans[current] || 0) + (at(e) - t0);
    current = e.detail?.to || current;
    t0 = at(e);
    doneAt = current === 'done' ? at(e) : null;
  }
  const finished = task.status === 'done';
  if (!finished && current !== 'done') spans[current] = (spans[current] || 0) + (Date.now() - t0);
  const end = finished ? (doneAt || task.completed_at || Date.now()) : Date.now();
  return { start, started_by_claim: !!lastClaim, pool_wait: poolWait, spans, current: task.status, finished, total: end - start };
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
      db.prepare('SELECT 1'),
      db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'pending'`),
      db.prepare(`SELECT id, name, title, role, status FROM users WHERE status = 'disabled'`),
    ]);
    await runRecurrences(env).catch((err) => console.warn('recurrence run failed', err));
    const tasks = await loadTasks(db, me);
    const events = await listEvents(db, me);
    const transfers = await listTransfers(db, me);
    return json({
      transfers,
      recurrences: await listRecurrences(db, me),
      board_requests: await boardRequests(db, me),
      me: publicUser(me),
      users: users.results.map(publicUser),
      former: former.results,
      boards: await listBoards(db, me),
      tasks,
      events,
      pending: isAdmin ? pending.results[0].n : 0,
    });
  }

  if (a === 'activity' && method === 'GET') {
    const limit = Math.min(Number(new URL(request.url).searchParams.get('limit')) || 30, 100);
    // Members only see activity on their own tasks; access changes are for owners only.
    const hideFlags = viewAll(me) ? '' : ` AND a.action != 'flagged'`;
    const scope = isAdmin ? '' : `WHERE a.action != 'access'${hideFlags} AND a.task_id IN (SELECT t.id FROM tasks t WHERE ${VISIBLE_TO_MEMBER})`;
    const { results } = await db.prepare(
      `SELECT a.id, a.task_id, a.board_id, a.user_id, a.action, a.detail, a.created_at, tk.title AS task_title
       FROM activity a LEFT JOIN tasks tk ON tk.id = a.task_id ${scope} ORDER BY a.created_at DESC LIMIT ?`
    ).bind(...(isAdmin ? [] : memberBinds(me)), limit).all();
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
      if ('reports_to' in body) {
        const boss = body.reports_to == null ? null : await db.prepare(
          `SELECT id FROM users WHERE id = ? AND status = 'approved' AND (role = 'admin' OR clearance = 'manager')`
        ).bind(Number(body.reports_to)).first();
        if (body.reports_to != null && !boss) throw new HttpError(400, 'Choose an owner or someone with manager clearance.');
        if (boss && boss.id === target.id) throw new HttpError(400, 'Someone can’t report to themselves.');
        next.reports_to = boss ? boss.id : null;
        stmts.push(db.prepare('UPDATE users SET reports_to = ? WHERE id = ?').bind(next.reports_to, target.id));
      }
      if (!stmts.length) throw new HttpError(400, 'Nothing to change.');
      await db.batch(stmts);
      if ('status' in body) await logActivity(db, { userId: me.id, action: 'access', detail: { user: target.name, status: body.status } });
      if ('clearance' in body) await logActivity(db, { userId: me.id, action: 'access', detail: { user: target.name, clearance: body.clearance } });
      return json({ user: publicUser(next) });
    }
  }

  // repeating task series
  if (a === 'recurrences') {
    if (!b && method === 'GET') return json({ recurrences: await listRecurrences(db, me) });
    const r = b ? await db.prepare('SELECT * FROM recurrences WHERE id = ?').bind(Number(b)).first() : null;
    if (!r) throw new HttpError(404, 'That repeating task no longer exists.');
    if (!viewAll(me) && r.created_by !== me.id) throw new HttpError(403, 'Only Sujay, Karan, a manager or whoever set it up can change this schedule.');
    if (!c && method === 'PATCH') {
      const freq = FREQS.includes(body.freq) ? body.freq : r.freq;
      const status = ['active', 'paused', 'stopped'].includes(body.status) ? body.status : r.status;
      let nextDue = r.next_due;
      if (freq !== r.freq) {
        // Re-anchor the schedule on the latest copy's due date.
        const lastDue = (await db.prepare('SELECT MAX(due_date) AS d FROM tasks WHERE recurrence_id = ?').bind(r.id).first())?.d || r.next_due;
        nextDue = advanceDue(lastDue, freq, r.anchor_day);
      }
      if (status === 'active' && r.status === 'paused') {
        const today = todayIST();
        while (nextDue < today) nextDue = advanceDue(nextDue, freq, r.anchor_day);
      }
      await db.prepare('UPDATE recurrences SET freq = ?, status = ?, next_due = ?, updated_at = ? WHERE id = ?').bind(freq, status, nextDue, Date.now(), r.id).run();
      return json({ recurrence: (await listRecurrences(db, me)).find((x) => x.id === r.id) || { ...r, status } });
    }
    if (c === 'template' && method === 'POST') {
      const t = await loadTask(db, me, Number(body.task_id));
      if (t.recurrence_id !== r.id) throw new HttpError(400, 'That task isn’t part of this repeating series.');
      const [full, checklist] = await db.batch([
        db.prepare('SELECT body FROM tasks WHERE id = ?').bind(t.id),
        db.prepare('SELECT text FROM checklist WHERE task_id = ? ORDER BY position ASC, id ASC').bind(t.id),
      ]);
      await db.prepare('UPDATE recurrences SET title = ?, body = ?, board_id = ?, priority = ?, assignees = ?, checklist = ?, updated_at = ? WHERE id = ?')
        .bind(t.title, full.results[0]?.body || '', t.board_id, t.priority, JSON.stringify(t.assignees), JSON.stringify(checklist.results.map((x) => x.text)), Date.now(), r.id).run();
      return json({ ok: true });
    }
  }

  // push notification subscriptions
  if (a === 'push') {
    if (b === 'key' && method === 'GET') return json({ key: VAPID_PUBLIC_KEY, enabled: !!env.VAPID_PRIVATE_KEY });
    if (b === 'subscribe' && method === 'POST') {
      const endpoint = str(body.endpoint, { min: 10, max: 1000, field: 'Endpoint' });
      if (!/^https:\/\//.test(endpoint)) throw new HttpError(400, 'That subscription isn’t valid.');
      const p256dh = str(body.keys?.p256dh, { min: 10, max: 200, field: 'Key' });
      const auth = str(body.keys?.auth, { min: 8, max: 100, field: 'Key' });
      await db.prepare(
        `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, ua, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua`
      ).bind(endpoint, me.id, p256dh, auth, (request.headers.get('user-agent') || '').slice(0, 200), Date.now()).run();
      return json({ ok: true }, 201);
    }
    if (b === 'unsubscribe' && method === 'POST') {
      await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(String(body.endpoint || ''), me.id).run();
      return json({ ok: true });
    }
    if (b === 'test' && method === 'POST') {
      if (!env.VAPID_PRIVATE_KEY) throw new HttpError(503, 'Notifications aren’t switched on yet. The VAPID_PRIVATE_KEY secret is missing in Cloudflare.');
      const n = await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').bind(me.id).first();
      if (!n.n) throw new HttpError(400, 'This account has no devices signed up for notifications yet.');
      env.notifyQueue.push({ userIds: [me.id], payload: { title: 'Notifications are on', body: 'You’ll hear about requests, handovers and new work here.', url: '/admin/#/', tag: 'test' } });
      return json({ ok: true, devices: n.n });
    }
  }

  // boards
  if (a === 'boards') return boardsRoute(request, env, me, b, c, segs[3], method, body);

  // tasks
  if (a === 'tasks') {
    if (!b && method === 'POST') return createTask(env, me, body);
    const id = Number(b);
    if (!Number.isInteger(id)) throw new HttpError(404, 'Not found.');
    if (!c && method === 'GET') return json({ task: await taskDetail(db, me, id) });
    if (!c && method === 'PATCH') return updateTask(env, me, id, body);
    if (!c && method === 'DELETE') return deleteTask(env, me, id);
    if (c === 'claim' && method === 'POST') return claimTask(env, me, id);
    if (c === 'repeat' && method === 'POST') {
      if (!viewAll(me)) throw new HttpError(403, 'Only Sujay, Karan or a manager can set up repeating tasks.');
      if (!FREQS.includes(body.freq)) throw new HttpError(400, 'Choose how often it repeats.');
      await loadTask(db, me, id);
      await makeRecurring(db, me, id, body.freq);
      return json({ task: await loadTask(db, me, id) });
    }
    if (c === 'flag' && method === 'DELETE') {
      if (!viewAll(me)) throw new HttpError(403, 'Only Sujay, Karan or a manager can clear this.');
      await db.prepare('UPDATE tasks SET dup_of = NULL, dup_reason = NULL WHERE id = ?').bind(id).run();
      return json({ task: await loadTask(db, me, id) });
    }
    if (c === 'release' && method === 'POST') return releaseTask(env, me, id, body);
    if (c === 'offer' && method === 'POST') return offerTask(env, me, id, body);

    if (c === 'comments' && method === 'POST') {
      await loadTask(db, me, id);
      const text = str(body.body, { min: 1, max: 4000, field: 'Comment' });
      const now = Date.now();
      const res = await db.prepare('INSERT INTO comments (task_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').bind(id, me.id, text, now).run();
      await db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').bind(now, id).run();
      await logActivity(db, { taskId: id, userId: me.id, action: 'commented', detail: { excerpt: text.slice(0, 120) } });
      const onTask = await loadTask(db, me, id);
      notify(env, me, [...onTask.assignees, onTask.created_by], { title: `${firstNameOf(me)} commented on “${onTask.title}”`, body: text.slice(0, 160), url: taskUrl(id), tag: `task-${id}` });
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

  if (a === 'transfers' && b && method === 'POST' && ['accept', 'decline', 'cancel'].includes(c)) {
    return answerTransfer(env, me, Number(b), c);
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
  const queue = [];
  const env = { ...context.env, notifyQueue: queue };
  const response = await handle(context, env);
  if (queue.length) context.waitUntil(flushNotifications(env, queue));
  return response;
}

async function handle(context, env) {
  const { request, params } = context;
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
