import { api } from '../api.js';
import { state, allTasks, canViewAll, canEditEvent, upsertEvent, removeEvent, userById } from '../store.js';
import {
  esc, icon, avatar, avatarStack, statusIcon, todayISO, toISO, fromISO, addDays, EVENT_KINDS, firstName,
} from '../util.js';
import { openSheet, toast, toastError, setBusy } from '../ui.js';

const view = {
  cursor: null, // ISO date of the first of the shown month
  selected: null, // ISO date or null (agenda shows the next 14 days)
  everyone: false, // owners/managers: include everyone's task due dates
};

const fmtMonth = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
const fmtDayLong = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDayShort = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const firstOfMonth = (iso) => `${iso.slice(0, 7)}-01`;
const shiftMonth = (iso, n) => {
  const d = fromISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + n, 1));
};

function tasksForCalendar() {
  const meId = state.me.id;
  return allTasks().filter((t) => t.due_date && (view.everyone && canViewAll() ? true : t.assignees.includes(meId) || (t.kind === 'request' && t.created_by === meId)));
}

function collect(from, to) {
  const days = new Map();
  const slot = (iso) => {
    if (!days.has(iso)) days.set(iso, { events: [], tasks: [] });
    return days.get(iso);
  };
  for (const e of state.events) {
    if (e.end_date < from || e.start_date > to) continue;
    let d = e.start_date < from ? from : e.start_date;
    const last = e.end_date > to ? to : e.end_date;
    while (d <= last) {
      slot(d).events.push({ e, isStart: d === e.start_date, isEnd: d === e.end_date });
      d = addDays(d, 1);
    }
  }
  for (const t of tasksForCalendar()) {
    if (t.due_date >= from && t.due_date <= to) slot(t.due_date).tasks.push(t);
  }
  for (const v of days.values()) {
    v.events.sort((a, b) => (a.e.start_time || '') .localeCompare(b.e.start_time || '') || a.e.start_date.localeCompare(b.e.start_date));
    v.tasks.sort((a, b) => (a.status === 'done') - (b.status === 'done'));
  }
  return days;
}

const timeRange = (e) => (e.start_time ? `${e.start_time}${e.end_time ? ` to ${e.end_time}` : ''}` : '');
const dateRange = (e) => (e.start_date === e.end_date ? fmtDayShort.format(fromISO(e.start_date)) : `${fmtDayShort.format(fromISO(e.start_date))} to ${fmtDayShort.format(fromISO(e.end_date))}`);

function eventPill(item, dayIndex, iso) {
  const { e, isStart, isEnd } = item;
  const k = EVENT_KINDS[e.kind] || EVENT_KINDS.other;
  const weekStart = dayIndex % 7 === 0;
  const showTitle = isStart || weekStart;
  // Let the title run across the days this bar covers in the current week row.
  const daysLeft = Math.round((fromISO(e.end_date) - fromISO(iso)) / 86400000) + 1;
  const span = Math.max(1, Math.min(daysLeft, 7 - (dayIndex % 7)));
  const cls = `cal-ev${isStart ? ' is-start' : ''}${isEnd ? ' is-end' : ''}${span > 1 && showTitle ? ' is-span' : ''}`;
  return `<button type="button" class="${cls}" style="--ev:${k.color};--span:${span}" data-event="${e.id}" title="${esc(e.title)}">
    ${showTitle ? `${icon(k.icon, { weight: 'bold' })}<span>${esc(e.title)}</span>` : '<span class="sr-only">continues</span>&nbsp;'}
  </button>`;
}

function grid(compact) {
  const today = todayISO();
  const first = view.cursor;
  const offset = (fromISO(first).getDay() + 6) % 7;
  const start = addDays(first, -offset);
  const end = addDays(start, 41);
  const days = collect(start, end);
  const month = first.slice(0, 7);
  const maxItems = compact ? 2 : 4;
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const iso = addDays(start, i);
    const d = fromISO(iso);
    const items = days.get(iso) || { events: [], tasks: [] };
    const all = [
      ...items.events.map((x) => eventPill(x, i, iso)),
      ...items.tasks.map((t) => `<button type="button" class="cal-task${t.status === 'done' ? ' is-done' : ''}" data-task="${t.id}" title="${esc(t.title)}">${statusIcon(t.status)}<span>${esc(t.title)}</span></button>`),
    ];
    const dots = [
      ...items.events.map((x) => `<i style="background:${(EVENT_KINDS[x.e.kind] || EVENT_KINDS.other).color}"></i>`),
      ...items.tasks.map(() => '<i class="is-task"></i>'),
    ].slice(0, 4).join('');
    const count = items.events.length + items.tasks.length;
    const cls = [
      'cal-cell',
      iso.slice(0, 7) !== month ? 'is-other' : '',
      iso === today ? 'is-today' : '',
      iso === view.selected ? 'is-selected' : '',
      d.getDay() === 0 || d.getDay() === 6 ? 'is-weekend' : '',
    ].filter(Boolean).join(' ');
    cells += `<div class="${cls}" data-day="${iso}">
      <div class="cal-cell-head">
        <button type="button" class="cal-date" data-select="${iso}" aria-label="${esc(fmtDayLong.format(d))}${count ? `, ${count} ${count === 1 ? 'item' : 'items'}` : ''}">${d.getDate()}</button>
        <button type="button" class="cal-add" data-add-event="${iso}" aria-label="Add an event on ${esc(fmtDayLong.format(d))}">${icon('plus', { weight: 'bold' })}</button>
      </div>
      <div class="cal-items">${all.slice(0, maxItems).join('')}${all.length > maxItems ? `<button type="button" class="cal-more" data-select="${iso}">+${all.length - maxItems} more</button>` : ''}</div>
      <div class="cal-dots" aria-hidden="true">${dots}</div>
    </div>`;
  }
  return `<div class="cal-grid" role="grid" aria-label="${esc(fmtMonth.format(fromISO(first)))}">
    ${WEEKDAYS.map((w) => `<div class="cal-wd" role="columnheader">${w}</div>`).join('')}
    ${cells}
  </div>`;
}

function agenda() {
  const today = todayISO();
  const from = view.selected || today;
  const to = view.selected || addDays(today, 13);
  const days = collect(from, to);
  const keys = [...days.keys()].sort();
  const title = view.selected ? fmtDayLong.format(fromISO(view.selected)) : 'Next two weeks';
  const body = keys.length
    ? keys.map((iso) => {
      const { events, tasks } = days.get(iso);
      const label = iso === today ? 'Today' : iso === addDays(today, 1) ? 'Tomorrow' : fmtDayLong.format(fromISO(iso));
      return `<div class="ag-day">
        ${view.selected ? '' : `<div class="ag-date">${esc(label)}</div>`}
        ${events.map(({ e }) => {
          const k = EVENT_KINDS[e.kind] || EVENT_KINDS.other;
          const by = userById(e.created_by);
          const meta = [timeRange(e), e.start_date !== e.end_date ? dateRange(e) : '', e.location].filter(Boolean).map(esc).join(', ');
          return `<button type="button" class="ag-item" data-event="${e.id}">
            <span class="ag-icon" style="--ev:${k.color}">${icon(k.icon, { weight: 'duotone' })}</span>
            <span class="ag-main"><span class="ag-title">${esc(e.title)}${e.visibility === 'private' ? ` ${icon('lock-simple', { weight: 'bold', cls: 'ag-lock' })}` : ''}</span>
            <span class="ag-sub">${esc(k.label)}${meta ? ` · ${meta}` : ''}</span></span>
            ${by ? avatar(by, 'av-sm') : ''}
          </button>`;
        }).join('')}
        ${tasks.map((t) => `<button type="button" class="ag-item" data-task="${t.id}">
            <span class="ag-icon is-task">${statusIcon(t.status)}</span>
            <span class="ag-main"><span class="ag-title">${esc(t.title)}</span><span class="ag-sub">Task due${t.assignees.length ? ` for ${esc(t.assignees.map(userById).filter(Boolean).map((u) => (u.id === state.me.id ? 'you' : firstName(u))).join(', '))}` : ''}</span></span>
            ${avatarStack(t.assignees, 2, 'av-sm')}
          </button>`).join('')}
      </div>`;
    }).join('')
    : `<div class="empty">${icon('calendar-check', { weight: 'duotone' })}<strong>${view.selected ? 'Nothing on this day' : 'A clear fortnight'}</strong><p>Add a holiday, a trip or a celebration so the team knows.</p></div>`;
  return `<aside class="agenda">
    <div class="ag-head"><h3>${esc(title)}</h3>${view.selected ? '<button type="button" class="link" data-clear-day>Show next two weeks</button>' : ''}</div>
    <div class="ag-body">${body}</div>
    <button type="button" class="btn btn-secondary btn-block ag-add" data-add-event="${view.selected || today}">${icon('calendar-plus', { weight: 'bold' })}Add event</button>
  </aside>`;
}

/** Calendar with month grid and agenda. `compact` trims cell contents for the overview. */
export function renderCalendar(host, ctx, { compact = false } = {}) {
  if (!view.cursor) view.cursor = firstOfMonth(todayISO());
  const title = fmtMonth.format(fromISO(view.cursor));
  const isThisMonth = view.cursor === firstOfMonth(todayISO());
  host.innerHTML = `
    <div class="calendar${compact ? ' is-compact' : ''}">
      <div class="cal-main">
        <div class="cal-toolbar">
          <h3 class="cal-title">${esc(title)}</h3>
          <div class="cal-nav">
            <button type="button" class="icon-btn" data-month="-1" aria-label="Previous month">${icon('caret-left', { weight: 'bold' })}</button>
            <button type="button" class="btn btn-ghost cal-today" data-month="0" ${isThisMonth && !view.selected ? 'disabled' : ''}>Today</button>
            <button type="button" class="icon-btn" data-month="1" aria-label="Next month">${icon('caret-right', { weight: 'bold' })}</button>
          </div>
          ${canViewAll() ? `<button type="button" class="toggle-chip${view.everyone ? ' is-on' : ''}" data-everyone aria-pressed="${view.everyone}">${icon('users-three', { weight: 'bold' })}Everyone’s tasks</button>` : ''}
        </div>
        ${grid(compact)}
        <div class="cal-legend">${Object.values(EVENT_KINDS).map((k) => `<span><i style="background:${k.color}"></i>${esc(k.label)}</span>`).join('')}<span><i class="is-task"></i>Task due</span></div>
      </div>
      ${agenda()}
    </div>`;

  host.addEventListener('click', (e) => {
    const t = e.target.closest('[data-month],[data-select],[data-add-event],[data-event],[data-task],[data-everyone],[data-clear-day]');
    if (!t || !host.contains(t)) return;
    if (t.dataset.month !== undefined) {
      const n = Number(t.dataset.month);
      view.cursor = n === 0 ? firstOfMonth(todayISO()) : shiftMonth(view.cursor, n);
      if (n === 0) view.selected = null;
      ctx.rerender();
    } else if (t.dataset.select) {
      view.selected = view.selected === t.dataset.select ? null : t.dataset.select;
      ctx.rerender();
    } else if (t.dataset.addEvent) {
      openEventSheet({ start_date: t.dataset.addEvent });
    } else if (t.dataset.event) {
      const ev = state.events.find((x) => x.id === Number(t.dataset.event));
      if (ev) openEventSheet(ev);
    } else if (t.dataset.task) {
      ctx.openTask(Number(t.dataset.task));
    } else if (t.dataset.everyone !== undefined) {
      view.everyone = !view.everyone;
      ctx.rerender();
    } else if (t.dataset.clearDay !== undefined) {
      view.selected = null;
      ctx.rerender();
    }
  });
}

export function renderCalendarPage(root, ctx) {
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1 class="page-title">Calendar</h1><p class="page-sub">Holidays, travel, celebrations and every due date in one place.</p></div>
        <button class="btn btn-primary" type="button" data-new-event>${icon('calendar-plus', { weight: 'bold' })}Add event</button>
      </div>
      <div data-calendar></div>
    </div>`;
  renderCalendar(root.querySelector('[data-calendar]'), ctx);
  root.querySelector('[data-new-event]').addEventListener('click', () => openEventSheet({ start_date: view.selected || todayISO() }));
}

// ---------- add / edit event ----------

export function openEventSheet(existing = {}) {
  const isNew = !existing.id;
  const editable = isNew || canEditEvent(existing);
  const e = {
    title: '', kind: 'other', start_date: todayISO(), end_date: null, start_time: null, end_time: null,
    location: '', notes: '', visibility: 'team', ...existing,
  };
  if (!e.end_date) e.end_date = e.start_date;
  const by = existing.created_by ? userById(existing.created_by) : null;

  if (!editable) {
    const k = EVENT_KINDS[e.kind] || EVENT_KINDS.other;
    openSheet(`
      <div class="ev-view-head"><span class="ag-icon" style="--ev:${k.color}">${icon(k.icon, { weight: 'duotone' })}</span><div><h2>${esc(e.title)}</h2><p class="lede">${esc(k.label)}</p></div></div>
      <dl class="ev-facts">
        <div><dt>${icon('calendar-blank')}When</dt><dd>${esc(dateRange(e))}${timeRange(e) ? `, ${esc(timeRange(e))}` : ''}</dd></div>
        ${e.location ? `<div><dt>${icon('map-pin')}Where</dt><dd>${esc(e.location)}</dd></div>` : ''}
        ${by ? `<div><dt>${icon('user-circle')}Added by</dt><dd>${esc(by.name)}</dd></div>` : ''}
      </dl>
      ${e.notes ? `<p class="ev-notes">${esc(e.notes)}</p>` : ''}
      <div class="sheet-actions"><button class="btn btn-primary" type="button" data-close>Close</button></div>`, { label: e.title });
    return;
  }

  let kind = e.kind;
  let visibility = e.visibility;
  let allDay = !e.start_time;
  openSheet(`
    <h2>${isNew ? 'Add event' : 'Edit event'}</h2>
    <form novalidate class="ev-form">
      <div class="field"><label class="label" for="ev-title">Title</label>
        <input class="input" id="ev-title" name="title" maxlength="120" value="${esc(e.title)}" placeholder="e.g. Diwali, Singapore client visit"></div>
      <div class="field"><span class="label">Type</span>
        <div class="kind-chips" role="radiogroup" aria-label="Event type">
          ${Object.entries(EVENT_KINDS).map(([key, k]) => `<button type="button" role="radio" class="kind-chip${key === kind ? ' is-on' : ''}" aria-checked="${key === kind}" data-kind="${key}" style="--ev:${k.color}">${icon(k.icon, { weight: key === kind ? 'fill' : 'bold' })}${esc(k.label)}</button>`).join('')}
        </div></div>
      <div class="field-row">
        <div class="field"><label class="label" for="ev-start">Starts</label><input class="input" type="date" id="ev-start" name="start_date" value="${e.start_date}"></div>
        <div class="field"><label class="label" for="ev-end">Ends</label><input class="input" type="date" id="ev-end" name="end_date" value="${e.end_date}"></div>
      </div>
      <label class="switch-row"><input type="checkbox" data-allday ${allDay ? 'checked' : ''}><span class="switch" aria-hidden="true"></span>All day</label>
      <div class="field-row" data-times ${allDay ? 'hidden' : ''}>
        <div class="field"><label class="label" for="ev-st">From</label><input class="input" type="time" id="ev-st" name="start_time" value="${e.start_time || '10:00'}"></div>
        <div class="field"><label class="label" for="ev-et">To</label><input class="input" type="time" id="ev-et" name="end_time" value="${e.end_time || '11:00'}"></div>
      </div>
      <div class="field"><label class="label" for="ev-loc">Location <span class="opt">(optional)</span></label><input class="input" id="ev-loc" name="location" maxlength="120" value="${esc(e.location)}"></div>
      <div class="field"><label class="label" for="ev-notes">Notes <span class="opt">(optional)</span></label><textarea class="input" id="ev-notes" name="notes" rows="2" maxlength="2000">${esc(e.notes)}</textarea></div>
      <div class="field"><span class="label">Who can see it</span>
        <div class="seg" role="radiogroup" aria-label="Who can see it">
          <button type="button" role="radio" data-vis="team" class="${visibility === 'team' ? 'is-active' : ''}" aria-checked="${visibility === 'team'}">${icon('users-three', { weight: 'bold' })}Everyone</button>
          <button type="button" role="radio" data-vis="private" class="${visibility === 'private' ? 'is-active' : ''}" aria-checked="${visibility === 'private'}">${icon('lock-simple', { weight: 'bold' })}Only me</button>
        </div>
        <span class="hint" data-vis-hint>${visibility === 'team' ? 'Shows on everyone’s calendar.' : 'Only you and the owners can see it.'}</span></div>
      <div class="sheet-actions">
        ${isNew ? '' : `<button class="btn btn-ghost ev-delete" type="button" data-delete>${icon('trash')}Delete</button>`}
        <button class="btn btn-ghost" type="button" data-close>Cancel</button>
        <button class="btn btn-primary" type="submit">${isNew ? 'Add event' : 'Save'}</button>
      </div>
    </form>`, {
    label: isNew ? 'Add event' : 'Edit event',
    onMount: (sheet, close) => {
      sheet.classList.add('sheet-wide');
      const form = sheet.querySelector('form');
      const start = form.querySelector('[name="start_date"]');
      const end = form.querySelector('[name="end_date"]');
      start.addEventListener('change', () => { if (!end.value || end.value < start.value) end.value = start.value; });
      sheet.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
        kind = b.dataset.kind;
        sheet.querySelectorAll('[data-kind]').forEach((x) => {
          const on = x === b;
          x.classList.toggle('is-on', on);
          x.setAttribute('aria-checked', on);
          const k = EVENT_KINDS[x.dataset.kind];
          x.querySelector('i').className = `${on ? 'ph-fill' : 'ph-bold'} ph-${k.icon}`;
        });
      }));
      sheet.querySelectorAll('[data-vis]').forEach((b) => b.addEventListener('click', () => {
        visibility = b.dataset.vis;
        sheet.querySelectorAll('[data-vis]').forEach((x) => { x.classList.toggle('is-active', x === b); x.setAttribute('aria-checked', x === b); });
        sheet.querySelector('[data-vis-hint]').textContent = visibility === 'team' ? 'Shows on everyone’s calendar.' : 'Only you and the owners can see it.';
      }));
      sheet.querySelector('[data-allday]').addEventListener('change', (ev) => {
        allDay = ev.target.checked;
        sheet.querySelector('[data-times]').hidden = allDay;
      });
      sheet.querySelector('[data-delete]')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        if (!btn.dataset.armed) {
          btn.dataset.armed = '1';
          btn.innerHTML = `${icon('trash')}Click again to delete`;
          btn.classList.add('is-armed');
          return;
        }
        setBusy(btn, true);
        try {
          await api(`events/${existing.id}`, { method: 'DELETE' });
          removeEvent(existing.id);
          close();
          toast('Event deleted', { type: 'success' });
        } catch (err) { setBusy(btn, false); toastError(err); }
      });
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        if (!data.title.trim()) { form.querySelector('[name="title"]').focus(); toast('Give the event a title.', { type: 'error' }); return; }
        const payload = {
          title: data.title.trim(), kind, visibility,
          start_date: data.start_date, end_date: data.end_date || data.start_date,
          start_time: allDay ? null : data.start_time || null, end_time: allDay ? null : data.end_time || null,
          location: data.location.trim(), notes: data.notes.trim(),
        };
        const btn = form.querySelector('button[type="submit"]');
        setBusy(btn, true);
        try {
          const res = isNew
            ? await api('events', { method: 'POST', body: payload })
            : await api(`events/${existing.id}`, { method: 'PATCH', body: payload });
          upsertEvent(res.event);
          close();
          toast(isNew ? 'Event added' : 'Event saved', { type: 'success' });
        } catch (err) { setBusy(btn, false); toastError(err); }
      });
    },
  });
}
