import { api, isStandalone } from './api.js';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 'ready' | 'needs-install' (iPhone/iPad not on home screen) | 'unsupported' */
export function pushSupport() {
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ready';
}

const toBytes = (b64) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function registration() {
  return navigator.serviceWorker.ready;
}

/** 'on' | 'off' | 'blocked' | 'unsupported' | 'needs-install' */
export async function pushStatus() {
  const support = pushSupport();
  if (support !== 'ready') return support;
  if (Notification.permission === 'denied') return 'blocked';
  const sub = await (await registration()).pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied'
    ? 'Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.'
    : 'Notifications weren’t allowed.');
  const { key, enabled } = await api('push/key');
  if (!enabled) throw new Error('Notifications aren’t switched on for the workspace yet. Ask Karan to add the VAPID_PRIVATE_KEY secret in Cloudflare.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
  await api('push/subscribe', { method: 'POST', body: sub.toJSON() });
}

export async function disablePush() {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await api('push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

export const testPush = () => api('push/test', { method: 'POST', body: {} });

/** Keep the server's copy of this device's subscription tied to whoever is signed in. */
export async function syncPush() {
  try {
    if (pushSupport() !== 'ready' || Notification.permission !== 'granted') return;
    const sub = await (await registration()).pushManager.getSubscription();
    if (sub) await api('push/subscribe', { method: 'POST', body: sub.toJSON() });
  } catch { /* retried on next start */ }
}

/** Number on the home-screen icon (iOS 16.4+, Android, desktop PWAs). */
export function setBadge(n) {
  try {
    const p = n > 0 ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.();
    p?.catch?.(() => {});
  } catch { /* not supported */ }
}

export const pushState = { status: null };
export async function refreshPushStatus() {
  try { pushState.status = await pushStatus(); } catch { pushState.status = 'unsupported'; }
  return pushState.status;
}

export const PUSH_COPY = {
  'needs-install': 'On iPhone and iPad, notifications work once the workspace is on your home screen. Tap Share, then “Add to Home Screen”, open it from there and turn notifications on.',
  unsupported: 'This browser can’t show notifications. Try Chrome, Edge or Safari, or the app on your phone.',
  blocked: 'Notifications are blocked for this site. Allow them in your browser’s site settings (or Settings, Notifications on iPhone), then come back here.',
};
