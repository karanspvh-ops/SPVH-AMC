import { api, setUnauthorizedHandler, isStandalone } from './api.js';
import { state, subscribe, loadAll, reset, isAdmin, isManager, allTasks, boardById, userById, emit } from './store.js';
import { esc, icon, avatar, swatch } from './util.js';
import { openMenu, closeMenu, openSheet, toast, toastError, setBusy } from './ui.js';
import { openTask, openNewTask, closeDrawer, drawerOpenFor, setDrawerNavigation } from './drawer.js';
import { isDragging } from './dnd.js';
import { renderAuth } from './views/auth.js';
import { renderOverview } from './views/overview.js';
import { renderMyWork } from './views/mywork.js';
import { renderRequests } from './views/requests.js';
import { renderBoard, renderBoards, renderPersonBoard, openBoardSheet } from './views/board.js';
import { renderCalendarPage, openEventSheet } from './views/calendar.js';
import { renderTeam, resetTeamCache } from './views/team.js';

const app = document.getElementById('app');
let shellReady = false;
let unsub = null;
let pollTimer = null;
let lastSync = 0;
let deferredInstall = null;
let query = '';
let currentKey = '';

// ---------- routing ----------

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  return { path: `/${parts.join('/')}`, parts, task: Number(params.get('t')) || null };
}

function go(hash) { location.hash = hash; }

// True when the open task has its own history entry, so closing can step back.
let taskEntryPushed = false;

function openTaskRoute(id) {
  const { path, task } = parseHash();
  if (task) {
    history.replaceState(null, '', `#${path}?t=${id}`);
    route();
  } else {
    location.hash = `${path}?t=${id}`;
  }
}

function closeTaskRoute() {
  const { path, task } = parseHash();
  if (!task) return;
  if (taskEntryPushed) {
    taskEntryPushed = false;
    history.back();
  } else {
    history.replaceState(null, '', `#${path}`);
  }
}

setDrawerNavigation({ open: openTaskRoute, close: closeTaskRoute });

const ctx = {
  openTask: openTaskRoute,
  newTask: (defaults = {}) => {
    const { parts } = parseHash();
    const boardId = parts[0] === 'board' ? Number(parts[1]) : undefined;
    openNewTask({ board_id: boardId, ...defaults });
  },
  go,
  rerender: () => renderPage(true),
  get query() { return query; },
};

function route(e) {
  if (!state.loaded) return;
  const { path, task } = parseHash();
  if (e?.type === 'hashchange') {
    const prevHadTask = /[?&]t=\d+/.test(new URL(e.oldURL).hash);
    if (task && !prevHadTask) taskEntryPushed = true;
    if (!task) taskEntryPushed = false;
  }
  if (path !== currentKey) {
    currentKey = path;
    query = '';
    const search = document.querySelector('[data-search]');
    if (search) search.value = '';
    renderChrome();
    renderPage(true);
    document.querySelector('.main')?.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
  }
  if (task) {
    if (drawerOpenFor() !== task) openTask(task);
  } else if (drawerOpenFor()) {
    closeDrawer({ fromRoute: true });
  }
}

window.addEventListener('hashchange', route);

// ---------- rendering ----------

function pageTitle() {
  const { parts } = parseHash();
  switch (parts[0]) {
    case 'my': return { title: 'My work', search: true };
    case 'requests': return { title: 'Requests', search: true };
    case 'boards': return { title: 'Boards', search: false };
    case 'board': {
      const b = boardById(Number(parts[1]));
      return { title: b?.name || 'Board', board: b, search: true };
    }
    case 'team': return { title: 'Team', search: false };
    case 'calendar': return { title: 'Calendar', search: false };
    case 'people': {
      const u = userById(Number(parts[1]));
      return { title: u ? (u.id === state.me.id ? 'Your board' : `${u.name}`) : 'Board', search: true };
    }
    default: return { title: 'Overview', search: false };
  }
}

let renderQueued = false;
function renderPage(force = false) {
  const page = document.querySelector('[data-page]');
  if (!page) return;
  if (!force) {
    const active = document.activeElement;
    const typing = active && page.contains(active) && active.matches('input, textarea') && !active.closest('[data-quick]');
    if (isDragging() || typing) {
      if (!renderQueued) {
        renderQueued = true;
        const retry = () => { renderQueued = false; renderPage(); };
        if (typing) active.addEventListener('blur', () => setTimeout(retry, 0), { once: true });
        else setTimeout(retry, 300);
      }
      return;
    }
  }
  const board = page.querySelector('[data-board]');
  const scroll = board ? { left: board.scrollLeft, cols: [...board.querySelectorAll('.col-list')].map((c) => [c.dataset.status, c.scrollTop]) } : null;
  const el = document.createElement('div');
  el.className = 'page-wrap';
  page.replaceChildren(el);
  const { parts } = parseHash();
  switch (parts[0]) {
    case 'my': renderMyWork(el, ctx); break;
    case 'requests': renderRequests(el, ctx); break;
    case 'boards': renderBoards(el, ctx); break;
    case 'board': renderBoard(el, ctx, Number(parts[1])); break;
    case 'team': renderTeam(el, ctx); break;
    case 'calendar': renderCalendarPage(el, ctx); break;
    case 'people': renderPersonBoard(el, ctx, Number(parts[1])); break;
    default: renderOverview(el, ctx);
  }
  if (scroll) {
    const nb = el.querySelector('[data-board]');
    if (nb) {
      nb.scrollLeft = scroll.left;
      for (const [s, top] of scroll.cols) {
        const c = nb.querySelector(`.col-list[data-status="${s}"]`);
        if (c && !c.closest('.col').querySelector('[data-quick]')) c.scrollTop = top;
      }
    }
  }
}

function counts() {
  const me = state.me;
  const open = allTasks().filter((t) => t.status !== 'done');
  return {
    mine: open.filter((t) => t.assignees.includes(me.id)).length,
    needsMe: isAdmin()
      ? open.filter((t) => t.kind === 'request' && t.assignees.includes(me.id)).length
      : open.filter((t) => t.kind === 'request' && t.created_by === me.id).length,
    pending: isAdmin() ? state.pending : 0,
  };
}

function renderChrome() {
  if (!shellReady) return;
  const { parts } = parseHash();
  const sec = parts[0] || '';
  const c = counts();
  const me = state.me;
  const navItem = (href, key, ic, label, extra = '') =>
    `<a class="nav-item${sec === key ? ' is-active' : ''}" href="${href}"${sec === key ? ' aria-current="page"' : ''}>${icon(ic, { weight: sec === key ? 'fill' : 'duotone' })}<span>${label}</span>${extra}</a>`;

  document.querySelector('[data-nav]').innerHTML = [
    navItem('#/', '', 'squares-four', 'Overview'),
    navItem('#/my', 'my', 'list-checks', 'My work', c.mine ? `<span class="nav-count">${c.mine}</span>` : ''),
    navItem('#/calendar', 'calendar', 'calendar-dots', 'Calendar'),
    navItem('#/requests', 'requests', 'tray', 'Requests', c.needsMe ? (isAdmin() ? `<span class="nav-badge" aria-label="${c.needsMe} need you">${c.needsMe}</span>` : `<span class="nav-count">${c.needsMe}</span>`) : ''),
    navItem('#/team', 'team', 'users-three', 'Team', c.pending ? `<span class="nav-badge" aria-label="${c.pending} waiting for access">${c.pending}</span>` : ''),
  ].join('');

  document.querySelector('[data-boards]').innerHTML = state.boards.map((b) => {
    const active = sec === 'board' && Number(parts[1]) === b.id;
    const n = allTasks().filter((t) => t.board_id === b.id && t.status !== 'done').length;
    return `<a class="nav-item${active ? ' is-active' : ''}" href="#/board/${b.id}"${active ? ' aria-current="page"' : ''}>${swatch(b)}<span>${esc(b.name)}</span>${n ? `<span class="nav-count">${n}</span>` : ''}</a>`;
  }).join('');

  const showInstall = !isStandalone() && !localStorage.getItem('spvh-install-dismissed');
  document.querySelector('[data-side-foot]').innerHTML = `
    ${showInstall ? `<div class="install-card"><strong>Use it on your phone</strong>Install the workspace on your phone and you stay signed in until you sign out.
      <div style="display:flex;justify-content:space-between;align-items:center"><button type="button" data-install>${icon('device-mobile')}How to install</button>
      <button type="button" class="icon-btn" data-install-dismiss aria-label="Dismiss" style="width:26px;height:26px;color:rgba(201,211,227,.6)">${icon('x')}</button></div></div>` : ''}
    <button class="user-chip" type="button" data-user-menu aria-haspopup="menu">${avatar(me, 'av-md')}<span class="who"><strong>${esc(me.name)}</strong><span>${isAdmin() ? 'Owner' : isManager(me) ? 'Manager' : esc(me.title || 'Team member')}</span></span>${icon('dots-three-vertical')}</button>`;

  const meta = pageTitle();
  document.querySelector('[data-crumbs]').innerHTML = `${meta.board ? swatch(meta.board) : ''}<strong>${esc(meta.title)}</strong>`;
  const searchWrap = document.querySelector('.search');
  searchWrap.hidden = !meta.search;

  const tab = (href, key, ic, label, badge = 0) =>
    `<a class="tab${sec === key ? ' is-active' : ''}" href="${href}">${icon(ic, { weight: sec === key ? 'fill' : 'duotone' })}<span>${label}</span>${badge ? `<span class="dot-count">${badge}</span>` : ''}</a>`;
  const newLabel = sec === 'requests' ? 'New request' : sec === 'calendar' ? 'Add event' : 'New task';
  document.querySelector('[data-tabbar]').innerHTML = [
    tab('#/', '', 'squares-four', 'Home'),
    tab('#/calendar', 'calendar', 'calendar-dots', 'Calendar'),
    `<button type="button" class="tab tab-new" data-tab-new aria-label="${newLabel}"><span class="plus">${icon('plus', { weight: 'bold' })}</span></button>`,
    tab('#/requests', 'requests', 'tray', 'Requests', isAdmin() ? c.needsMe : 0),
    tab('#/team', 'team', 'users-three', 'Team', c.pending),
  ].join('');
  document.querySelector('[data-top-avatar]').innerHTML = avatar(me, 'av-md');
}

function mountShell() {
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar" aria-label="Workspace navigation">
        <a class="side-brand" href="#/"><img src="/assets/images/SPVH LOGO WHITE_2.png" alt="SPVH" width="948" height="330"><span>Workspace</span></a>
        <nav class="side-nav" data-nav aria-label="Main"></nav>
        <div class="side-section">
          <div class="side-label"><a href="#/boards">Boards</a>${isAdmin() ? `<button class="icon-btn" type="button" data-new-board aria-label="New board">${icon('plus')}</button>` : ''}</div>
          <nav class="side-nav" data-boards aria-label="Boards"></nav>
        </div>
        <div class="side-foot" data-side-foot></div>
      </aside>
      <div class="main">
        <header class="topbar">
          <img class="topbar-mark" src="/admin/icons/icon-192.png" alt="" width="28" height="28">
          <div class="crumbs" data-crumbs></div>
          <div class="top-actions">
            <label class="search">${icon('magnifying-glass')}<input type="search" data-search placeholder="Filter tasks" aria-label="Filter tasks" autocomplete="off"><kbd>/</kbd></label>
            <button class="icon-btn top-avatar" type="button" data-top-avatar data-user-menu aria-label="Account" aria-haspopup="menu" style="width:40px;height:40px"></button>
          </div>
        </header>
        <main data-page id="main"></main>
      </div>
      <nav class="tabbar" data-tabbar aria-label="Main"></nav>
    </div>`;
  shellReady = true;

  app.addEventListener('click', (e) => {
    const um = e.target.closest('[data-user-menu]');
    if (um) { userMenu(um); return; }
    if (e.target.closest('[data-install]')) { showInstall(); return; }
    if (e.target.closest('[data-install-dismiss]')) {
      try { localStorage.setItem('spvh-install-dismissed', '1'); } catch { /* storage blocked */ }
      renderChrome();
      return;
    }
    if (e.target.closest('[data-new-board]')) { openBoardSheet(null, ctx); return; }
    if (e.target.closest('[data-tab-new]')) {
      const { parts } = parseHash();
      if (parts[0] === 'calendar') openEventSheet({});
      else ctx.newTask(parts[0] === 'requests' ? { kind: 'request' } : parts[0] === 'people' ? { assignees: [Number(parts[1])] } : {});
    }
  });

  const search = app.querySelector('[data-search]');
  search.addEventListener('input', () => { query = search.value.trim(); renderPage(true); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; query = ''; renderPage(true); search.blur(); } });
}

// ---------- account menu ----------

function userMenu(anchor) {
  const me = state.me;
  openMenu(anchor, {
    align: anchor.classList.contains('user-chip') ? 'start' : 'end',
    items: () => [
      { type: 'label', label: me.email },
      { id: 'profile', label: 'Edit profile', iconHtml: icon('user-circle') },
      { id: 'password', label: 'Change password', iconHtml: icon('key') },
      { id: 'theme', label: 'Appearance', iconHtml: icon('circle-half-tilt'), sub: themeLabel() },
      ...(!isStandalone() ? [{ id: 'install', label: 'Install on your phone', iconHtml: icon('device-mobile') }] : []),
      { type: 'sep' },
      { id: 'signout', label: 'Sign out', iconHtml: icon('sign-out'), danger: true },
    ],
    onSelect: (id) => {
      if (id === 'profile') editProfile();
      if (id === 'password') changePassword();
      if (id === 'theme') setTimeout(() => themeMenu(anchor), 0);
      if (id === 'install') showInstall();
      if (id === 'signout') signOut();
    },
  });
}

function themeLabel() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'System';
}

function themeMenu(anchor) {
  const cur = document.documentElement.dataset.theme || 'system';
  openMenu(anchor, {
    align: anchor.classList.contains('user-chip') ? 'start' : 'end',
    items: () => [
      { id: 'system', label: 'Match device', iconHtml: icon('desktop'), checked: cur === 'system' },
      { id: 'light', label: 'Light', iconHtml: icon('sun'), checked: cur === 'light' },
      { id: 'dark', label: 'Dark', iconHtml: icon('moon'), checked: cur === 'dark' },
    ],
    onSelect: (id) => {
      if (id === 'system') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = id;
      try {
        if (id === 'system') localStorage.removeItem('spvh-theme');
        else localStorage.setItem('spvh-theme', id);
      } catch { /* storage blocked */ }
      const dark = id === 'dark' || (id === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.querySelector('meta[name="theme-color"]').content = dark ? '#060E1A' : '#0A1628';
    },
  });
}

function editProfile() {
  const me = state.me;
  openSheet(`<h2>Your profile</h2><p class="lede">This is how the team sees you.</p>
    <form novalidate>
      <div class="field"><label class="label" for="pf-name">Full name</label><input class="input" id="pf-name" name="name" maxlength="80" value="${esc(me.name)}" autocomplete="name"></div>
      <div class="field"><label class="label" for="pf-title">Designation</label><input class="input" id="pf-title" name="title" maxlength="80" value="${esc(me.title)}" autocomplete="organization-title"></div>
      <div class="field"><label class="label" for="pf-phone">Phone</label><input class="input" id="pf-phone" name="phone" type="tel" maxlength="30" value="${esc(me.phone)}" autocomplete="tel"></div>
      <div class="sheet-actions"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div>
    </form>`, {
    label: 'Edit profile',
    onMount: (sheet, close) => {
      sheet.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target));
        const btn = sheet.querySelector('button[type="submit"]');
        setBusy(btn, true);
        try {
          const res = await api('me', { method: 'PATCH', body });
          state.me = res.me;
          const u = state.usersById.get(res.me.id);
          if (u) Object.assign(u, res.me);
          close();
          toast('Profile saved', { type: 'success' });
          renderChrome();
          emit();
        } catch (err) { setBusy(btn, false); toastError(err); }
      });
    },
  });
}

function changePassword() {
  openSheet(`<h2>Change password</h2><p class="lede">You’ll stay signed in here. Other devices will be signed out.</p>
    <form novalidate>
      <div class="field"><label class="label" for="pw-cur">Current password</label><input class="input" id="pw-cur" name="current" type="password" autocomplete="current-password"></div>
      <div class="field"><label class="label" for="pw-new">New password</label><input class="input" id="pw-new" name="next" type="password" autocomplete="new-password" minlength="8"><span class="hint">At least 8 characters.</span></div>
      <div class="field"><label class="label" for="pw-conf">Confirm new password</label><input class="input" id="pw-conf" name="confirm" type="password" autocomplete="new-password"></div>
      <div class="sheet-actions"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Update password</button></div>
    </form>`, {
    label: 'Change password',
    onMount: (sheet, close) => {
      sheet.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const { current, next, confirm } = Object.fromEntries(new FormData(e.target));
        if (next.length < 8) { toast('New password needs at least 8 characters.', { type: 'error' }); return; }
        if (next !== confirm) { toast('The new passwords don’t match.', { type: 'error' }); return; }
        const btn = sheet.querySelector('button[type="submit"]');
        setBusy(btn, true);
        try {
          await api('me/password', { method: 'POST', body: { current, next } });
          close();
          toast('Password updated', { type: 'success' });
        } catch (err) { setBusy(btn, false); toastError(err); }
      });
    },
  });
}

function showInstall() {
  if (deferredInstall) {
    deferredInstall.prompt();
    deferredInstall.userChoice.finally(() => { deferredInstall = null; renderChrome(); });
    return;
  }
  openSheet(`<h2>Install on your phone</h2>
    <p class="lede">Open <b>spvhamc.com/admin</b> on your phone, then add it to your home screen. Once installed, you stay signed in until you sign out.</p>
    <div class="section-head" style="margin-top:18px"><h2>iPhone (Safari)</h2></div>
    <ol class="ios-steps"><li>${icon('export')}Tap the Share button</li><li>${icon('plus-square')}Choose “Add to Home Screen”</li></ol>
    <div class="section-head" style="margin-top:18px"><h2>Android (Chrome)</h2></div>
    <ol class="ios-steps"><li>${icon('dots-three-vertical')}Tap the menu</li><li>${icon('download-simple')}Choose “Install app”</li></ol>
    <div class="sheet-actions"><button class="btn btn-primary" type="button" data-close>Got it</button></div>`, { label: 'Install on your phone' });
}

async function signOut() {
  try { await api('auth/logout', { method: 'POST', body: {} }); } catch { /* signing out anyway */ }
  teardown();
  showAuth();
}

// ---------- lifecycle ----------

function teardown() {
  closeMenu();
  closeDrawer({ fromRoute: true });
  unsub?.();
  unsub = null;
  clearInterval(pollTimer);
  reset();
  resetTeamCache();
  shellReady = false;
  currentKey = '';
}

function showAuth(opts = {}) {
  document.title = 'Sign in · SPVH Workspace';
  renderAuth(app, { ...opts, onSignedIn: startApp });
}

async function startApp() {
  try {
    await loadAll();
  } catch (err) {
    if (err.status === 401) { showAuth(); return; }
    showFatal(err);
    return;
  }
  lastSync = Date.now();
  document.title = 'SPVH Workspace';
  mountShell();
  currentKey = '';
  route();
  unsub = subscribe(() => { renderChrome(); renderPage(); });
  clearInterval(pollTimer);
  pollTimer = setInterval(sync, 45000);
}

async function sync() {
  if (document.hidden || !state.loaded || isDragging()) return;
  try { await loadAll(); lastSync = Date.now(); } catch { /* next poll will retry */ }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.loaded && Date.now() - lastSync > 15000) sync();
});

function showFatal(err) {
  app.innerHTML = `<div class="boot" style="background:var(--canvas)"><div class="empty">${icon('cloud-warning')}<strong>We couldn’t load the workspace</strong><p>${esc(err.message)}</p><button class="btn btn-primary" type="button" data-retry>Try again</button></div></div>`;
  app.querySelector('[data-retry]').addEventListener('click', startApp);
}

setUnauthorizedHandler(() => {
  if (!state.loaded) return;
  teardown();
  showAuth({ notice: 'You’ve been signed out. Sign in again to continue.' });
});

document.addEventListener('keydown', (e) => {
  if (!state.loaded || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.matches?.('input, textarea, select, [contenteditable]') || document.querySelector('.drawer, .sheet, .menu')) return;
  if (e.key === '/') {
    const s = document.querySelector('[data-search]');
    if (s && !s.closest('.search').hidden && s.offsetParent) { e.preventDefault(); s.focus(); }
  } else if (e.key === 'n' || e.key === 'c') {
    e.preventDefault();
    ctx.newTask();
  }
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch(() => {}));
}

startApp();
