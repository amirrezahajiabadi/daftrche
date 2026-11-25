/* ═══ Client-Side Guest-First Auth & Session Manager ═══
   Handles optional passwordless OTP authentication, Bearer token storage,
   and sync cursor persistence. Zero network calls for guests. */

import { safeSet, safeRemove, readString } from './store.js';
import { setSyncEnabled } from './outbox.js';
import { notify } from './bus.js';

export const AUTH_STORAGE_KEY = 'daftarche_auth_v1';
export const SYNC_CURSOR_KEY = 'daftarche_sync_cursor_v1';
export const LAST_SYNC_AT_KEY = 'daftarche_last_sync_at_v1';

let configuredBaseUrl = '';
let configuredFetch = null;

/**
 * Configures global API base URL and/or fetch implementation (useful for testing).
 * @param {Object} [options]
 * @param {string} [options.apiBaseUrl]
 * @param {typeof fetch} [options.fetchImpl]
 */
export function configureAuth({ apiBaseUrl, fetchImpl } = {}) {
  if (typeof apiBaseUrl === 'string') {
    configuredBaseUrl = apiBaseUrl.replace(/\/+$/, '');
  }
  if (typeof fetchImpl === 'function' || fetchImpl === null) {
    configuredFetch = fetchImpl;
  }
}

export function getApiBaseUrl(overrideBase) {
  if (typeof overrideBase === 'string') {
    return overrideBase.replace(/\/+$/, '');
  }
  if (configuredBaseUrl) return configuredBaseUrl;
  if (typeof globalThis !== 'undefined' && typeof globalThis.__DAFTARCHE_API_BASE__ === 'string') {
    return globalThis.__DAFTARCHE_API_BASE__.replace(/\/+$/, '');
  }
  return '';
}

export function resolveFetch(overrideFetch) {
  if (typeof overrideFetch === 'function') return overrideFetch;
  if (typeof configuredFetch === 'function') return configuredFetch;
  if (typeof fetch === 'function') return fetch.bind(globalThis);
  throw new Error('fetch is not available');
}

export function getClientBuild() {
  if (typeof self !== 'undefined' && self.DAFTARCHE_BUILD) {
    return String(self.DAFTARCHE_BUILD);
  }
  return 'v230';
}

function emitAuthChanged() {
  notify();
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('daftarche:auth-changed', { detail: getAuthState() }));
    } catch {
      // ignore
    }
  }
}

/**
 * Reads current session state from localStorage via store.js.
 * @returns {{ isLoggedIn: boolean, user: { id: string, identifier: string } | null, token: string | null }}
 */
export function getAuthState() {
  const raw = readString(AUTH_STORAGE_KEY, '');
  if (!raw) return { isLoggedIn: false, user: null, token: null };
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.token === 'string' &&
      parsed.token &&
      parsed.user &&
      typeof parsed.user.id === 'string' &&
      typeof parsed.user.identifier === 'string'
    ) {
      return {
        isLoggedIn: true,
        user: { id: parsed.user.id, identifier: parsed.user.identifier },
        token: parsed.token,
      };
    }
  } catch {
    // ignore corrupt auth entry
  }
  return { isLoggedIn: false, user: null, token: null };
}

export function getSyncCursor() {
  const raw = readString(SYNC_CURSOR_KEY, '0');
  const num = Number(raw);
  return Number.isInteger(num) && num >= 0 ? num : 0;
}

export function setSyncCursor(cursor) {
  const val = Number.isInteger(Number(cursor)) && Number(cursor) >= 0 ? Number(cursor) : 0;
  return safeSet(SYNC_CURSOR_KEY, String(val));
}

export function getLastSyncAt() {
  const raw = readString(LAST_SYNC_AT_KEY, '');
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function setLastSyncAt(ts) {
  const val = Number(ts);
  if (!Number.isFinite(val) || val <= 0) return safeRemove(LAST_SYNC_AT_KEY);
  return safeSet(LAST_SYNC_AT_KEY, String(Math.floor(val)));
}

/**
 * Clears auth token, cursor, and disables sync while preserving all local user data.
 */
export function clearAuthSession() {
  safeRemove(AUTH_STORAGE_KEY);
  safeRemove(SYNC_CURSOR_KEY);
  safeRemove(LAST_SYNC_AT_KEY);
  setSyncEnabled(false);
  emitAuthChanged();
}

async function requestJson(path, { method = 'POST', body, token, apiBaseUrl, fetchImpl } = {}) {
  const fetchFn = resolveFetch(fetchImpl);
  const base = getApiBaseUrl(apiBaseUrl);
  const headers = {
    'X-Client-Build': getClientBuild(),
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetchFn(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: 'ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی کنید.',
      networkError: true,
      cause: err,
    };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return {
    ok: Boolean(res.ok && data && data.ok !== false),
    status: res.status,
    data,
    error: (data && data.error) || (res.ok ? '' : 'خطای سرور'),
  };
}

/**
 * Requests a 6-digit OTP code for an email or Iranian mobile number.
 * @param {string} identifier
 * @param {Object} [options]
 */
export async function requestOtp(identifier, options = {}) {
  const res = await requestJson('/api/auth/request-otp', {
    method: 'POST',
    body: { identifier },
    apiBaseUrl: options.apiBaseUrl,
    fetchImpl: options.fetchImpl,
  });

  if (!res.ok) {
    return { ok: false, status: res.status, error: res.error, networkError: Boolean(res.networkError) };
  }

  return {
    ok: true,
    identifier: res.data.identifier,
    expiresInSec: res.data.expiresInSec,
  };
}

/**
 * Verifies an OTP code, stores the Bearer token, and activates cloud sync.
 * @param {string} identifier
 * @param {string} code
 * @param {string} [deviceName='web']
 * @param {Object} [options]
 */
export async function verifyOtp(identifier, code, deviceName = 'web', options = {}) {
  const res = await requestJson('/api/auth/verify-otp', {
    method: 'POST',
    body: { identifier, code, deviceName },
    apiBaseUrl: options.apiBaseUrl,
    fetchImpl: options.fetchImpl,
  });

  if (!res.ok || !res.data?.token || !res.data?.user) {
    return { ok: false, status: res.status, error: res.error || 'تأیید کد ناموفق بود' };
  }

  safeSet(AUTH_STORAGE_KEY, JSON.stringify({
    token: res.data.token,
    user: {
      id: String(res.data.user.id),
      identifier: String(res.data.user.identifier),
    },
  }));
  setSyncEnabled(true);
  emitAuthChanged();

  return {
    ok: true,
    token: res.data.token,
    user: res.data.user,
  };
}

/**
 * Validates the current session against GET /api/auth/me.
 * Gracefully clears session on 401 without removing local user data.
 * @param {Object} [options]
 */
export async function fetchMe(options = {}) {
  const { isLoggedIn, token } = getAuthState();
  if (!isLoggedIn || !token) {
    return { ok: false, status: 401, error: 'وارد حساب کاربری نشده‌اید' };
  }

  const res = await requestJson('/api/auth/me', {
    method: 'GET',
    token,
    apiBaseUrl: options.apiBaseUrl,
    fetchImpl: options.fetchImpl,
  });

  if (res.status === 401) {
    clearAuthSession();
    return { ok: false, status: 401, unauthorized: true, error: res.error };
  }

  if (!res.ok || !res.data?.user) {
    return { ok: false, status: res.status, error: res.error };
  }

  return { ok: true, user: res.data.user };
}

/**
 * Logs out of cloud sync (best-effort server revoke), clears token & cursor,
 * disables outbox queueing, and keeps all local tasks and books intact.
 * @param {Object} [options]
 */
export async function logout(options = {}) {
  const { token } = getAuthState();
  if (token) {
    await requestJson('/api/auth/logout', {
      method: 'POST',
      token,
      apiBaseUrl: options.apiBaseUrl,
      fetchImpl: options.fetchImpl,
    }).catch(() => {});
  }

  clearAuthSession();
  return { ok: true };
}

export const authClient = {
  configureAuth,
  getAuthState,
  getSyncCursor,
  setSyncCursor,
  getLastSyncAt,
  setLastSyncAt,
  clearAuthSession,
  requestOtp,
  verifyOtp,
  fetchMe,
  logout,
};
