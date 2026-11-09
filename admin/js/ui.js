import { esc, icon } from './util.js';

const layer = () => document.getElementById('layer-root');

// ---------- toasts ----------

export function toast(message, { type = 'info', duration = 3200 } = {}) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast is-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const ic = type === 'error' ? icon('warning-circle', { fill: true }) : type === 'success' ? icon('check-circle', { fill: true }) : '';
  el.innerHTML = `${ic}<span>${esc(message)}</span>`;
  root.appendChild(el);
  while (root.children.length > 3) root.firstElementChild.remove();
  let timer = setTimeout(leave, duration);
  function leave() {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  }
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => { timer = setTimeout(leave, 1600); });
}

export const toastError = (err) => toast(err?.message || 'Something went wrong. Try again.', { type: 'error', duration: 4800 });

// ---------- menus ----------

let activeMenu = null;

export function closeMenu() {
  if (!activeMenu) return;
  const { el, anchor, cleanup } = activeMenu;
  activeMenu = null;
  cleanup();
  el.classList.remove('is-open');
  setTimeout(() => el.remove(), 160);
  anchor?.setAttribute('aria-expanded', 'false');
}

/**
 * items(): returns [{ id, label, iconHtml, sub, checked, danger, disabled }] or
 * { type: 'label', label } / { type: 'sep' } / { type: 'note', label }.
 * onSelect(id) returning true keeps the menu open (for multi-select).
 */
export function openMenu(anchor, { items, onSelect, search = false, placeholder = 'Search…', align = 'start', width } = {}) {
  if (activeMenu?.anchor === anchor) { closeMenu(); return; }
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  if (width) el.style.minWidth = `${width}px`;
  let query = '';
  let activeIndex = -1;

  el.innerHTML = `${search ? `<div class="menu-search"><input type="text" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off"></div>` : ''}<div class="menu-items"></div>`;
  const list = el.querySelector('.menu-items');
  const input = el.querySelector('input');

  function visible() {
    const all = items();
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter((i) => !i.type && `${i.label} ${i.sub || ''}`.toLowerCase().includes(q));
  }

  function render() {
    const rows = visible();
    if (!rows.some((r) => !r.type)) {
      list.innerHTML = `<div class="menu-note">No matches</div>`;
      return;
    }
    list.innerHTML = rows.map((r) => {
      if (r.type === 'sep') return '<div class="menu-sep"></div>';
      if (r.type === 'label') return `<div class="menu-label">${esc(r.label)}</div>`;
      if (r.type === 'note') return `<div class="menu-note">${esc(r.label)}</div>`;
      return `<button type="button" class="menu-item${r.danger ? ' is-danger' : ''}" role="menuitem" data-id="${esc(r.id)}" ${r.disabled ? 'disabled' : ''}>
        ${r.iconHtml || ''}<span class="grow">${esc(r.label)}${r.sub ? ` <span class="sub">${esc(r.sub)}</span>` : ''}</span>
        ${r.checked ? icon('check', { cls: 'check' }) : ''}
      </button>`;
    }).join('');
    setActive(Math.min(Math.max(activeIndex, 0), buttons().length - 1), false);
  }

  const buttons = () => [...list.querySelectorAll('.menu-item:not(:disabled)')];
  function setActive(i, focus = true) {
    const bs = buttons();
    bs.forEach((b) => b.classList.remove('is-active'));
    activeIndex = i;
    if (bs[i]) {
      bs[i].classList.add('is-active');
      if (focus) bs[i].focus({ preventScroll: false });
    }
  }

  function choose(id) {
    const keep = onSelect?.(id);
    if (keep) {
      const hadFocus = el.contains(document.activeElement);
      render();
      if (hadFocus || !input) setActive(activeIndex, document.activeElement !== input);
    } else closeMenu();
  }

  list.addEventListener('click', (e) => {
    const b = e.target.closest('.menu-item');
    if (b && !b.disabled) choose(b.dataset.id);
  });
  list.addEventListener('pointermove', (e) => {
    const b = e.target.closest('.menu-item');
    if (b) { const i = buttons().indexOf(b); if (i !== activeIndex) setActive(i, false); }
  });
  el.addEventListener('keydown', (e) => {
    const bs = buttons();
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((activeIndex + 1) % bs.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((activeIndex - 1 + bs.length) % bs.length); }
    else if (e.key === 'Enter' && document.activeElement === input && bs[activeIndex]) { e.preventDefault(); choose(bs[activeIndex].dataset.id); }
    else if (e.key === 'Tab') closeMenu();
  });
  input?.addEventListener('input', () => { query = input.value.trim(); activeIndex = 0; render(); });

  render();
  layer().appendChild(el);
  position(el, anchor, align);
  requestAnimationFrame(() => el.classList.add('is-open'));
  anchor?.setAttribute('aria-expanded', 'true');
  if (input) input.focus();
  else if (matchMedia('(pointer: fine)').matches) setActive(0);

  const outside = (e) => { if (!el.contains(e.target) && !anchor?.contains(e.target)) closeMenu(); };
  const onResize = () => closeMenu();
  const onEscape = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    if (anchor?.isConnected) anchor.focus();
  };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onEscape, true);
  activeMenu = {
    el, anchor,
    cleanup: () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onEscape, true);
    },
  };
}

function position(el, anchor, align) {
  const r = anchor.getBoundingClientRect();
  const m = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let top = r.bottom + 6;
  let originY = 'top';
  if (top + m.height > vh - 12 && r.top - m.height - 6 > 12) {
    top = r.top - m.height - 6;
    originY = 'bottom';
  }
  let left = align === 'end' ? r.right - m.width : r.left;
  left = Math.max(12, Math.min(left, vw - m.width - 12));
  el.style.top = `${Math.max(12, top)}px`;
  el.style.left = `${left}px`;
  const originX = Math.min(Math.max(r.left + r.width / 2 - left, 0), m.width);
  el.style.transformOrigin = `${originX}px ${originY}`;
}

// ---------- sheet (small centered dialog for short forms) ----------

export function openSheet(html, { onMount, label = 'Dialog' } = {}) {
  closeMenu();
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', label);
  sheet.innerHTML = html;
  layer().append(back, sheet);
  const prevFocus = document.activeElement;
  requestAnimationFrame(() => { back.classList.add('is-open'); sheet.classList.add('is-open'); });

  function close() {
    document.removeEventListener('keydown', onKey, true);
    back.classList.remove('is-open');
    sheet.classList.remove('is-open');
    setTimeout(() => { back.remove(); sheet.remove(); }, 220);
    prevFocus?.focus?.();
  }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  onMount?.(sheet, close);
  const first = sheet.querySelector('input, textarea, button.btn-primary');
  first?.focus();
  return close;
}

export function setBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle('is-loading', busy);
}
