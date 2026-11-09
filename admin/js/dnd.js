// Pointer-based Kanban drag and drop. Mouse drags after a 4px move;
// touch drags after a short long-press so normal scrolling still works.

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let busy = false;
export const isDragging = () => busy;

export function attachBoardDnd(boardEl, { canDrag, onDrop, onOpen }) {
  let pending = null;
  let drag = null;
  let suppressClick = false;

  const cards = (list) => [...list.querySelectorAll('.card')];
  const nextCard = (el) => {
    let n = el.nextElementSibling;
    while (n && !n.classList.contains('card')) n = n.nextElementSibling;
    return n;
  };

  function onPointerDown(e) {
    if (e.button !== 0 || drag) return;
    const card = e.target.closest('.card');
    if (!card || !boardEl.contains(card) || !canDrag(Number(card.dataset.id))) return;
    pending = { card, x: e.clientX, y: e.clientY, type: e.pointerType, id: e.pointerId, timer: null };
    if (e.pointerType === 'touch') {
      pending.timer = setTimeout(() => { if (pending) start(pending.x, pending.y); }, 260);
    }
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function onPointerMove(e) {
    if (pending && !drag) {
      const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
      if (pending.type === 'touch') {
        if (dist > 10) cancelPending();
        else { pending.x = e.clientX; pending.y = e.clientY; }
        return;
      }
      if (dist > 4) start(e.clientX, e.clientY);
      else return;
    }
    if (!drag) return;
    e.preventDefault();
    drag.x = e.clientX;
    drag.y = e.clientY;
  }

  function onTouchMove(e) {
    if (drag) e.preventDefault();
  }

  function onPointerUp() {
    if (drag) finish(true);
    cancelPending();
  }

  function onPointerCancel() {
    if (drag) finish(false);
    cancelPending();
  }

  function onKey(e) {
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  }

  function cancelPending() {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = null;
    if (!drag) removeWindowListeners();
  }

  function removeWindowListeners() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }

  function start(x, y) {
    const card = pending.card;
    const isTouch = pending.type === 'touch';
    if (pending.timer) clearTimeout(pending.timer);
    pending = null;
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('card-ghost');
    ghost.removeAttribute('tabindex');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    card.classList.add('is-source');
    document.body.classList.add('is-dragging');
    busy = true;
    drag = {
      card, ghost, x, y,
      offX: x - rect.left, offY: y - rect.top,
      originList: card.parentElement, originNext: nextCard(card), raf: 0,
      tilt: 0,
    };
    place();
    if (isTouch) navigator.vibrate?.(8);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('keydown', onKey, true);
    drag.raf = requestAnimationFrame(frame);
  }

  function place() {
    const tilt = reduceMotion() ? '' : ' rotate(1.5deg) scale(1.02)';
    drag.ghost.style.transform = `translate(${drag.x - drag.offX}px, ${drag.y - drag.offY}px)${tilt}`;
  }

  function frame() {
    if (!drag) return;
    place();
    autoScroll();
    hitTest();
    drag.raf = requestAnimationFrame(frame);
  }

  function autoScroll() {
    const b = boardEl.getBoundingClientRect();
    const edge = 56;
    if (drag.x < b.left + edge) boardEl.scrollLeft -= Math.ceil((b.left + edge - drag.x) / 4);
    else if (drag.x > b.right - edge) boardEl.scrollLeft += Math.ceil((drag.x - (b.right - edge)) / 4);
    const list = drag.card.parentElement;
    if (list?.classList.contains('col-list')) {
      const l = list.getBoundingClientRect();
      if (drag.y < l.top + 48) list.scrollTop -= Math.ceil((l.top + 48 - drag.y) / 4);
      else if (drag.y > l.bottom - 48) list.scrollTop += Math.ceil((drag.y - (l.bottom - 48)) / 4);
    }
  }

  function hitTest() {
    const under = document.elementFromPoint(drag.x, drag.y);
    let list = under?.closest('.col-list');
    if (!list) {
      const col = under?.closest('.col');
      list = col?.querySelector('.col-list');
    }
    if (!list || !boardEl.contains(list)) return;
    const others = cards(list).filter((c) => c !== drag.card);
    const ref = others.find((c) => {
      const r = c.getBoundingClientRect();
      return drag.y < r.top + r.height / 2;
    }) || null;
    if (drag.card.parentElement === list && nextCard(drag.card) === ref) return;
    move(list, ref);
  }

  function move(list, ref) {
    const prevList = drag.card.parentElement;
    const affected = [...new Set([...cards(prevList), ...cards(list)])].filter((c) => c !== drag.card);
    const first = new Map(affected.map((c) => [c, c.getBoundingClientRect()]));
    if (ref) list.insertBefore(drag.card, ref);
    else {
      const empty = list.querySelector('.col-empty');
      list.insertBefore(drag.card, empty || null);
    }
    boardEl.querySelectorAll('.col.is-target').forEach((c) => c.classList.remove('is-target'));
    if (list !== drag.originList) list.closest('.col')?.classList.add('is-target');
    if (reduceMotion()) return;
    for (const c of affected) {
      const a = first.get(c);
      const b = c.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) continue;
      c.style.transition = 'none';
      c.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        c.style.transition = 'transform 180ms cubic-bezier(0.23, 1, 0.32, 1)';
        c.style.transform = '';
        setTimeout(() => { c.style.transition = ''; }, 200);
      });
    }
  }

  function finish(commit) {
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.raf);
    removeWindowListeners();
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('keydown', onKey, true);
    if (!commit) d.originList.insertBefore(d.card, d.originNext || d.originList.querySelector('.col-empty'));
    boardEl.querySelectorAll('.col.is-target').forEach((c) => c.classList.remove('is-target'));
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);

    const target = d.card.getBoundingClientRect();
    const done = () => {
      d.ghost.remove();
      d.card.classList.remove('is-source');
      document.body.classList.remove('is-dragging');
      busy = false;
      const list = d.card.parentElement;
      const moved = list !== d.originList || nextCard(d.card) !== d.originNext;
      if (commit && moved) {
        const prev = (() => { let p = d.card.previousElementSibling; while (p && !p.classList.contains('card')) p = p.previousElementSibling; return p; })();
        const next = nextCard(d.card);
        onDrop(Number(d.card.dataset.id), list.dataset.status, prev ? Number(prev.dataset.id) : null, next ? Number(next.dataset.id) : null);
      }
    };
    if (reduceMotion()) { done(); return; }
    d.ghost.style.transition = 'transform 180ms cubic-bezier(0.23, 1, 0.32, 1)';
    d.ghost.style.transform = `translate(${target.left}px, ${target.top}px)`;
    let finished = false;
    const end = () => { if (!finished) { finished = true; done(); } };
    d.ghost.addEventListener('transitionend', end, { once: true });
    setTimeout(end, 220);
  }

  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('contextmenu', (e) => { if (e.target.closest('.card')) e.preventDefault(); });
  boardEl.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card || suppressClick) return;
    onOpen(Number(card.dataset.id));
  });
  boardEl.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) {
      e.preventDefault();
      onOpen(Number(e.target.dataset.id));
    }
  });
}
