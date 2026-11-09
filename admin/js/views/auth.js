import { api, isStandalone } from '../api.js';
import { esc, icon } from '../util.js';
import { setBusy } from '../ui.js';

const visual = `
  <div class="auth-visual">
    <img class="auth-bg" src="/admin/img/boardroom.webp" alt="" width="1000" height="1000">
    <img class="auth-logo" src="/assets/images/SPVH LOGO WHITE_2.png" alt="SPVH" width="948" height="330">
    <div class="auth-copy">
      <h1>The SPVH team workspace</h1>
      <p>Who is working on what, what needs a decision, and where Sujay or Karan are needed to move work forward.</p>
    </div>
  </div>`;

export function renderAuth(root, { mode = 'signin', onSignedIn, notice } = {}) {
  let current = mode;
  let first = true;
  let needsCode = false;

  function draw(extra = {}, animate = false) {
    root.innerHTML = `<div class="auth">${visual}<div class="auth-panel${first || animate ? ' is-enter' : ''}">${panel(current, extra)}</div></div>`;
    first = false;
    bind();
  }

  function panel(m, { error, info, email = '' } = {}) {
    if (m === 'sent') {
      return `<div class="auth-form auth-success">
        <div class="seal">${icon('paper-plane-tilt', { fill: true })}</div>
        <h2>Request sent</h2>
        <p>Sujay or Karan will review your request. Once it's approved, you can sign in with the email and password you just set.</p>
        <button class="btn btn-secondary" data-go="signin" type="button">Back to sign in</button>
      </div>`;
    }
    const message = error
      ? `<div class="notice ${error.code === 'pending' ? 'is-warn' : 'is-error'}" role="alert">${icon(error.code === 'pending' ? 'hourglass-medium' : 'warning-circle', { fill: true })}<span>${esc(error.message)}</span></div>`
      : info
        ? `<div class="notice">${icon('info', { fill: true })}<span>${esc(info)}</span></div>`
        : '';

    if (m === 'signup') {
      return `<div class="auth-form">
        <h2>Request access</h2>
        <p class="lede">Tell us who you are. Sujay or Karan will approve your account.</p>
        ${message}
        <form novalidate>
          <div class="field"><label class="label" for="su-name">Full name</label>
            <input class="input" id="su-name" name="name" autocomplete="name" required></div>
          <div class="field"><label class="label" for="su-email">Work email</label>
            <input class="input" id="su-email" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(email)}"></div>
          ${needsCode ? `<div class="field"><label class="label" for="su-code">Owner setup code</label>
            <input class="input" id="su-code" name="setup_code" type="password" autocomplete="off" required>
            <span class="hint">The private code stored in Cloudflare for Sujay and Karan.</span></div>` : ''}
          <div class="field-row">
            <div class="field"><label class="label" for="su-title">Designation</label>
              <input class="input" id="su-title" name="title" autocomplete="organization-title" placeholder="e.g. Research Analyst"></div>
            <div class="field"><label class="label" for="su-phone">Phone <span class="opt">(optional)</span></label>
              <input class="input" id="su-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel"></div>
          </div>
          <div class="field"><label class="label" for="su-note">What will you work on?</label>
            <textarea class="input" id="su-note" name="note" rows="3" placeholder="Your team, role, and what you need access for"></textarea></div>
          <div class="field"><label class="label" for="su-pass">Create a password</label>
            <div class="input-wrap"><input class="input" id="su-pass" name="password" type="password" autocomplete="new-password" minlength="8" required>
            <button class="icon-btn" type="button" data-reveal aria-label="Show password">${icon('eye')}</button></div>
            <span class="hint">At least 8 characters.</span></div>
          <button class="btn btn-primary btn-block" type="submit">Request access</button>
        </form>
        <p class="auth-switch">Already approved? <button type="button" data-go="signin">Sign in</button></p>
      </div>`;
    }

    return `<div class="auth-form">
      <h2>Sign in</h2>
      <p class="lede">${isStandalone() ? 'You will stay signed in on this device until you sign out.' : 'Welcome back. Sign in to see your work.'}</p>
      ${message}
      <form novalidate>
        <div class="field"><label class="label" for="si-email">Email</label>
          <input class="input" id="si-email" name="email" type="email" autocomplete="username" inputmode="email" required value="${esc(email)}"></div>
        <div class="field"><label class="label" for="si-pass">Password</label>
          <div class="input-wrap"><input class="input" id="si-pass" name="password" type="password" autocomplete="current-password" required>
          <button class="icon-btn" type="button" data-reveal aria-label="Show password">${icon('eye')}</button></div></div>
        <button class="btn btn-primary btn-block" type="submit">Sign in</button>
      </form>
      <p class="auth-switch">New to the team? <button type="button" data-go="signup">Request access</button></p>
    </div>`;
  }

  function bind() {
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
      const email = root.querySelector('input[name="email"]')?.value || '';
      current = b.dataset.go;
      draw({ email }, true);
      root.querySelector('input')?.focus();
    }));
    root.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
      const input = b.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.innerHTML = icon(show ? 'eye-slash' : 'eye');
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    }));
    const form = root.querySelector('form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const btn = form.querySelector('button[type="submit"]');
      const fieldError = validate(current, data);
      if (fieldError) {
        draw({ error: { message: fieldError }, email: data.email });
        restore(data);
        return;
      }
      setBusy(btn, true);
      try {
        if (current === 'signup') {
          const res = await api('auth/signup', { method: 'POST', body: { ...data, remember: isStandalone() } });
          if (res.status === 'approved') return onSignedIn();
          current = 'sent';
          draw({}, true);
        } else {
          await api('auth/login', { method: 'POST', body: { email: data.email, password: data.password, remember: isStandalone() } });
          onSignedIn();
        }
      } catch (err) {
        if (err.code === 'owner_code') needsCode = true;
        draw({ error: { message: err.message, code: err.code }, email: data.email });
        restore(data);
        if (err.code === 'owner_code') root.querySelector('[name="setup_code"]')?.focus();
      }
    });
  }

  function restore(data) {
    for (const [k, v] of Object.entries(data)) {
      const el = root.querySelector(`[name="${k}"]`);
      if (el) el.value = v;
    }
    root.querySelector('[name="password"]')?.focus();
  }

  draw(notice ? { info: notice } : {});
}

function validate(mode, d) {
  if (!d.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return 'Enter a valid email address.';
  if (!d.password) return 'Enter your password.';
  if (mode === 'signup') {
    if (!d.name || d.name.trim().length < 2) return 'Enter your full name.';
    if (d.password.length < 8) return 'Your password needs at least 8 characters.';
  }
  return null;
}
