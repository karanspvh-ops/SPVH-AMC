import { api } from '../api.js';
import { state, canViewAll, userById, boardById, loadAll } from '../store.js';
import { esc, icon, avatarStack, swatch, shortDate, FREQ_LABEL } from '../util.js';
import { openMenu, toast, toastError } from '../ui.js';
import { emptyState } from '../rows.js';

export function renderRepeating(root, ctx) {
  const list = state.recurrences.slice().sort((a, b) => a.next_due.localeCompare(b.next_due));
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1 class="page-title">Repeating tasks</h1>
          <p class="page-sub">Work that comes round on a schedule. Each copy appears on the assignee’s board a few days before it’s due.</p></div>
        ${canViewAll() ? `<button class="btn btn-primary" type="button" data-new>${icon('plus', { weight: 'bold' })}New repeating task</button>` : ''}
      </div>
      ${list.length ? `<div class="list">${list.map((r) => {
        const b = boardById(r.board_id);
        const paused = r.status === 'paused';
        const by = userById(r.created_by);
        return `<div class="row repeat-row${paused ? ' is-paused' : ''}" role="button" tabindex="0" data-open="${r.last_task_id || ''}">
          <span class="repeat-icon">${icon('arrows-clockwise', { weight: 'bold' })}</span>
          <div class="row-main">
            <div class="row-title">${esc(r.title)}</div>
            <div class="row-sub"><span>${esc(FREQ_LABEL[r.freq])}</span>${b ? `<span class="tag tag-board">${swatch(b)}${esc(b.name)}</span>` : ''}<span>${r.copies} ${r.copies === 1 ? 'copy' : 'copies'} so far</span>${by ? `<span>Set up by ${esc(by.name.split(' ')[0])}</span>` : ''}</div>
          </div>
          <div class="row-meta">
            <span class="${paused ? 'tag' : 'due'}">${paused ? 'Paused' : `${icon('calendar-blank', { weight: 'bold' })}Next due ${esc(shortDate(r.next_due))}`}</span>
            ${avatarStack(r.assignees, 3, 'av-sm')}
            ${canViewAll() || r.created_by === state.me.id ? `<button type="button" class="icon-btn" data-series="${r.id}" aria-label="Options for ${esc(r.title)}" aria-haspopup="menu">${icon('dots-three', { weight: 'bold' })}</button>` : ''}
          </div>
        </div>`;
      }).join('')}</div>`
      : `<div class="list">${emptyState('arrows-clockwise', 'Nothing repeats yet', canViewAll() ? 'Open any task with a due date and set “Repeats” to every week, month, quarter or year.' : 'Repeating tasks assigned to you will show up here.')}</div>`}
    </div>`;

  root.querySelector('[data-new]')?.addEventListener('click', () => ctx.newTask({ repeat: 'monthly' }));
  root.addEventListener('click', (e) => {
    const m = e.target.closest('[data-series]');
    if (m) { e.stopPropagation(); seriesMenu(m, state.recurrences.find((r) => r.id === Number(m.dataset.series))); return; }
    const row = e.target.closest('[data-open]');
    if (row && row.dataset.open) ctx.openTask(Number(row.dataset.open));
  });
}

function seriesMenu(anchor, r) {
  openMenu(anchor, {
    align: 'end',
    items: () => [
      { type: 'label', label: 'How often' },
      ...['weekly', 'monthly', 'quarterly', 'yearly'].map((f) => ({ id: `freq:${f}`, label: FREQ_LABEL[f], checked: r.freq === f })),
      { type: 'sep' },
      r.status === 'paused' ? { id: 'resume', label: 'Resume', iconHtml: icon('play') } : { id: 'pause', label: 'Pause', iconHtml: icon('pause') },
      { id: 'stop', label: 'Stop repeating', iconHtml: icon('stop-circle'), danger: true },
    ],
    onSelect: async (id) => {
      try {
        const body = id.startsWith('freq:') ? { freq: id.slice(5) } : { status: id === 'pause' ? 'paused' : id === 'resume' ? 'active' : 'stopped' };
        await api(`recurrences/${r.id}`, { method: 'PATCH', body });
        await loadAll();
        toast(id === 'stop' ? 'Stopped repeating' : id === 'pause' ? 'Paused' : id === 'resume' ? 'Resumed' : 'Schedule updated', { type: 'success' });
      } catch (err) { toastError(err); }
    },
  });
}
