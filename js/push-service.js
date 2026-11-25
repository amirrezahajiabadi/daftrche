/* ═══ Web Push — background reminder layer ═══
   The local scheduler in js/notifications.js runs inside the open app from a
   task's bell and needs no server. This module is the additive background
   upgrade so reminders keep arriving when the PWA is closed.
   Degrades gracefully: if the browser lacks Push/ServiceWorker support, the
   user is offline, or the server has no VAPID public key configured, all calls
   return cleanly without throwing or blocking the UI. */

import { urlBase64ToUint8Array } from './utils.js';
import { getAuthState, getApiBaseUrl, resolveFetch, getClientBuild } from './auth-client.js';

export const WEB_PUSH_ENABLED = true;

function pushEndpoint(path, apiBaseUrl) {
  const base = getApiBaseUrl(apiBaseUrl);
  return `${base}${path}`;
}

function buildHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Build': getClientBuild(),
  };
  const { isLoggedIn, token } = getAuthState();
  if (isLoggedIn && token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function isOffline(options) {
  if (options && options.ignoreOnlineCheck) return false;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/* ── Capability ──
   Feature detection, never browser sniffing: safe even in non-browser contexts. */
export function pushSupported() {
  return typeof navigator !== 'undefined'
    && typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/* The server may be absent or have VAPID disabled — in that case push is
   quietly unavailable and the local scheduler keeps working alone. */
async function serverAvailable(options = {}) {
  if (isOffline(options)) return null;
  try {
    const fetchFn = resolveFetch(options.fetchImpl);
    const res = await fetchFn(pushEndpoint('/api/push/vapid-public-key', options.apiBaseUrl), {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.enabled === false) return null;
    return typeof data?.publicKey === 'string' && data.publicKey.length > 0 ? data.publicKey : null;
  } catch {
    return null; // no server or offline → feature silently off
  }
}

/* ── Subscription state ── */
export async function getPushSubscription() {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

/* ── Subscribe ──
   MUST be called from inside a user gesture (bell click / settings toggle).
   Resolves with the subscription, or null when push is unavailable/denied. */
export async function enablePush(options = {}) {
  if (!WEB_PUSH_ENABLED) return null;
  if (!pushSupported() || isOffline(options)) return null;

  let permission = Notification.permission;
  if (permission === 'default') {
    try { permission = await Notification.requestPermission(); }
    catch { return null; }
  }
  if (permission !== 'granted') return null;

  try {
    const reg = await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const publicKey = await serverAvailable(options);
      if (!publicKey) return null;
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    }

    const fetchFn = resolveFetch(options.fetchImpl);
    await fetchFn(pushEndpoint('/api/push/subscribe', options.apiBaseUrl), {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(sub.toJSON()),
    }).catch(() => { /* the local layer still works if the backend is down */ });

    return sub;
  } catch {
    return null;
  }
}

/* ── Unsubscribe ──
   Tears the subscription down locally and informs the backend. */
export async function disablePush(options = {}) {
  if (!WEB_PUSH_ENABLED) return;
  if (!pushSupported()) return;
  try {
    const sub = await getPushSubscription();
    if (!sub) return;
    if (!isOffline(options)) {
      const fetchFn = resolveFetch(options.fetchImpl);
      await fetchFn(pushEndpoint('/api/push/unsubscribe', options.apiBaseUrl), {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => { /* backend cleanup is best-effort */ });
    }
    await sub.unsubscribe();
  } catch { /* stay silent */ }
}

/* ── Boot ──
   No prompts, no subscriptions on load. Only resyncs an already-existing
   subscription with the backend. */
export async function syncExistingSubscription(options = {}) {
  if (!WEB_PUSH_ENABLED) return;
  if (!pushSupported() || isOffline(options)) return;
  try {
    const sub = await getPushSubscription();
    if (!sub) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && Notification.permission === 'granted') {
      const fetchFn = resolveFetch(options.fetchImpl);
      await fetchFn(pushEndpoint('/api/push/subscribe', options.apiBaseUrl), {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(sub.toJSON()),
      }).catch(() => { /* server absent — nothing to do */ });
    }
  } catch { /* stay silent */ }
}
