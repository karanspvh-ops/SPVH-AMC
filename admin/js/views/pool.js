import {
  state, allTasks, canViewAll, boardById, userById, isOpenInPool, poolTasks, inbox, claimTask, poolAction, createTask, teamBoards, loadAll,
} from '../store.js';
import { esc, icon, avatar, avatarStack, prioIcon, dueBadge, swatch, firstName, ago } from '../util.js';
import { openSheet, toast, toastError, setBusy } from '../ui.js';
import { api } from '../api.js';
import { emptyState } from '../rows.js';

let tab = 'open';

export function progressBar(t, { label = true } = {}) {
  const ck = t.checklist || { total: 0, done: 0 };
  if (!ck.total) return '';
  const pct = ck.done / ck.total;
  return `<div class="progress-line${pct === 1 ? ' is-complete' : ''}">
    <span class="pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${ck.total}" aria-valuenow="${ck.done}" aria-label="Checklist progress"><i style="transform:scaleX(${pct})"></i></span>
    ${label ? `<span>${ck.done} of ${ck.total} done</span>` : `<span>${ck.done}/${ck.total}</span>`}
  </div>`;
}

function handoverQuote(t) {
  if (!t.handover_note) return '';
  const by = userById(t.handover_by);
  return `<blockquote class="handover-quote">${by ? avatar(by, 'av-xs') : ''}<span><b>${by ? esc(by.id === state.me.id ? 'Your' : `${firstName(by)}’s`) : 'Previous'} handover:</b> ${esc(t.handover_note)}</span></blockquote>`;
}

export function poolCard(t, { compact = false } = {}) {
  const b = boardById(t.board_id);
  const creator = userById(t.created_by);
  const open = isOpenInPool(t);
  const owners = t.assignees.map(userById).filter(Boolean);
  return `<article class="pool-card${compact ? ' is-compact' : ''}" data-open="${t.id}" role="button" tabindex="0" aria-label="${esc(t.title)}">
    <div class="pool-top">
      ${b ? `<span class="tag tag-board">${swatch(b)}${esc(b.name)}</span>` : ''}
      ${t.priority === 'urgent' || t.priority === 'high' ? prioIcon(t.priority) : ''}
      ${dueBadge(t)}
    </div>
    <h3 class="pool-title">${esc(t.title)}</h3>
    ${t.has_body && t.body_preview ? `<p class="pool-desc">${esc(t.body_preview)}</p>` : ''}
    ${progressBar(t)}
    ${compact ? '' : handoverQuote(t)}
    <div class="pool-foot">
      ${open
        ? `<span class="pool-by">${creator ? `Added by ${esc(creator.id === state.me.id ? 'you' : firstName(creator))}, ` : ''}${esc(ago(t.updated_at || t.created_at))}</span>
           <button type="button" class="btn btn-primary btn-claim" data-claim="${t.id}">${icon('hand-grabbing', { weight: 'bold' })}Claim</button>`
        : `<span class="pool-by">${owners.length ? `Claimed by ${esc(owners.map((u) => (u.id === state.me.id ? 'you' : firstName(u))).join(', '))}` : 'Done'}</span>${avatarStack(t.assignees, 3, 'av-sm')}`}
    </div>
  </article>`;
}

/** Shared click handling for pool cards: claim, or open the task. */
export function bindPoolCards(root, ctx) {
  root.addEventListener('click', async (e) => {
    const claim = e.target.closest('[data-claim]');
    if (claim) {
      e.stopPropagation();
      const id = Number(claim.dataset.claim);
      setBusy(claim, true);
      try {
        await claimTask(id);
        toast('It’s yours. Add details and a checklist, then get going.', { type: 'success' });
        ctx.openTask(id);
      } catch (err) {
        setBusy(claim, false);
        toastError(err);
        if (err.status === 409) ctx.refresh();
      }
      return;
    }
    const card = e.target.closest('[data-open]');
    if (card && root.contains(card)) ctx.openTask(Number(card.dataset.open));
  });
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.pool-card')) {
      e.preventDefault();
      ctx.openTask(Number(e.target.dataset.open));
    }
  });
}

export const inboxCount = () => inbox().length + state.boardRequests.length;

function boardRequestCards() {
  return state.boardRequests.map((r) => {
    const who = userById(r.user_id);
    if (!who) return '';
    const owner = r.owner_id && r.owner_id !== state.me.id ? userById(r.owner_id) : null;
    return `<article class="inbox-card is-board">
      <div class="inbox-head">${avatar(who, 'av-md')}<div>
        <p><b>${esc(who.name)}</b> asked to see ${owner ? `${esc(firstName(owner))}’s` : 'your'} board</p>
        <a class="link inbox-task" href="#/board/${r.board_id}">${icon('lock-simple', { weight: 'bold' })} ${esc(r.board_name)}</a>
      </div></div>
      <div class="inbox-actions">
        <span class="hint">${esc(ago(r.requested_at))}</span>
        <button type="button" class="btn btn-ghost" data-board-req="${r.board_id}" data-user="${r.user_id}" data-answer="decline">Decline</button>
        <button type="button" class="btn btn-primary" data-board-req="${r.board_id}" data-user="${r.user_id}" data-answer="approve">Let them see it</button>
      </div>
    </article>`;
  }).join('');
}

export const inboxCards = () => boardRequestCards() + transferCards();

function transferCards() {
  return inbox().map((tr) => {
    const t = state.tasks.get(tr.task_id);
    const from = userById(tr.from_user);
    if (!t || !from) return '';
    const handover = tr.kind === 'handover';
    return `<article class="inbox-card">
      <div class="inbox-head">${avatar(from, 'av-md')}<div>
        <p><b>${esc(from.name)}</b> ${handover ? 'wants to hand over' : 'invited you to work on'}</p>
        <button type="button" class="link inbox-task" data-open="${t.id}">${esc(t.title)}</button>
      </div></div>
      ${progressBar(t)}
      ${tr.note ? `<blockquote class="handover-quote"><span>${esc(tr.note)}</span></blockquote>` : ''}
      <div class="inbox-actions">
        <span class="hint">${handover ? 'If you decline, it goes back to the task pool.' : esc(ago(tr.created_at))}</span>
        <button type="button" class="btn btn-ghost" data-transfer="${tr.id}" data-answer="decline">Decline</button>
        <button type="button" class="btn btn-primary" data-transfer="${tr.id}" data-answer="accept">${handover ? 'Take it over' : 'Join task'}</button>
      </div>
    </article>`;
  }).join('');
}

export function bindInbox(root, ctx) {
  root.addEventListener('click', async (e) => {
    const br = e.target.closest('[data-board-req]');
    if (br) {
      e.stopPropagation();
      setBusy(br, true);
      try {
        await api(`boards/${br.dataset.boardReq}/access/${br.dataset.user}/${br.dataset.answer}`, { method: 'POST', body: {} });
        await loadAll();
        toast(br.dataset.answer === 'approve' ? 'Access granted' : 'Request declined', { type: 'success' });
      } catch (err) { setBusy(br, false); toastError(err); }
      return;
    }
    const b = e.target.closest('[data-transfer]');
    if (!b) return;
    e.stopPropagation();
    const tr = state.transfers.find((x) => x.id === Number(b.dataset.transfer));
    setBusy(b, true);
    try {
      const res = await poolAction(`transfers/${b.dataset.transfer}/${b.dataset.answer}`);
      if (b.dataset.answer === 'accept') {
        toast(tr?.kind === 'handover' ? 'The task is yours now' : 'You’ve joined the task', { type: 'success' });
        if (tr) ctx.openTask(tr.task_id);
      } else {
        toast(res.pooled ? 'Declined. The task went back to the pool.' : 'Declined', { type: 'success' });
      }
    } catch (err) {
      setBusy(b, false);
      toastError(err);
    }
  });
}

export function renderPool(root, ctx) {
  const q = ctx.query.toLowerCase();
  const match = (t) => !q || t.title.toLowerCase().includes(q);
  const open = poolTasks().filter(match).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  const claimed = allTasks().filter((t) => t.pooled && t.assignees.length && t.status !== 'done' && match(t))
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  const list = tab === 'open' ? open : claimed;

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1 class="page-title">Task pool</h1>
          <p class="page-sub">Open work anyone can pick up. Claim a task and it moves to your board.</p>
        </div>
        <div class="filters">
          <div class="seg" role="tablist">
            <button type="button" role="tab" data-tab="open" class="${tab === 'open' ? 'is-active' : ''}" aria-selected="${tab === 'open'}">Open <span class="n">${open.length}</span></button>
            <button type="button" role="tab" data-tab="claimed" class="${tab === 'claimed' ? 'is-active' : ''}" aria-selected="${tab === 'claimed'}">Claimed <span class="n">${claimed.length}</span></button>
          </div>
          ${canViewAll() ? `<button class="btn btn-primary" type="button" data-add-pool>${icon('plus', { weight: 'bold' })}Add to pool</button>` : ''}
        </div>
      </div>
      ${inbox().length ? `<section class="ov-section"><div class="section-head"><h2>${icon('handshake', { weight: 'duotone' })}Waiting for your answer<span class="count">${inbox().length}</span></h2></div><div class="inbox-list">${transferCards()}</div></section>` : ''}
      ${list.length
        ? `<div class="pool-grid">${list.map((t) => poolCard(t)).join('')}</div>`
        : `<div class="list">${tab === 'open'
          ? emptyState('stack', 'The pool is empty', canViewAll() ? 'Add open work here and anyone on the team can claim it.' : 'When Sujay, Karan or a manager add open work, it shows up here for anyone to claim.')
          : emptyState('hand-grabbing', 'Nothing claimed yet', 'Tasks taken from the pool show here while they’re in progress.')}</div>`}
    </div>`;

  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; ctx.rerender(); }));
  root.querySelector('[data-add-pool]')?.addEventListener('click', () => openPoolSheet(ctx));
  bindPoolCards(root, ctx);
  bindInbox(root, ctx);
}

export function openPoolSheet(ctx) {
  const boards = teamBoards();
  openSheet(`
    <h2>Add to the task pool</h2>
    <p class="lede">Give it a name and a short description. Whoever claims it adds the details and checklist.</p>
    <form novalidate>
      <div class="field"><label class="label" for="pl-title">Task</label>
        <input class="input" id="pl-title" name="title" maxlength="200" placeholder="e.g. Update October AUM factsheet"></div>
      <div class="field"><label class="label" for="pl-desc">Brief description</label>
        <textarea class="input" id="pl-desc" name="body" rows="3" maxlength="600" placeholder="What needs doing, in a sentence or two"></textarea>
        <span class="hint" data-count>0 / 600</span></div>
      ${boards.length > 1 ? `<div class="field"><label class="label" for="pl-board">Board</label>
        <select class="input" id="pl-board" name="board_id">${boards.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>` : ''}
      <div class="sheet-actions"><button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">${icon('stack', { weight: 'bold' })}Add to pool</button></div>
    </form>`, {
    label: 'Add to the task pool',
    onMount: (sheet, close) => {
      const form = sheet.querySelector('form');
      const desc = form.querySelector('[name="body"]');
      desc.addEventListener('input', () => { sheet.querySelector('[data-count]').textContent = `${desc.value.length} / 600`; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        if (!data.title.trim()) { form.querySelector('[name="title"]').focus(); toast('Give the task a name.', { type: 'error' }); return; }
        const btn = form.querySelector('button[type="submit"]');
        setBusy(btn, true);
        try {
          await createTask({ title: data.title.trim(), body: data.body.trim(), board_id: Number(data.board_id) || boards[0]?.id, pooled: true });
          close();
          toast('Added to the task pool', { type: 'success' });
          ctx.go('#/pool');
        } catch (err) { setBusy(btn, false); toastError(err); }
      });
    },
  });
}

