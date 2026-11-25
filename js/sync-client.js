/* ═══ Client-Side Two-Way Sync Runner (Push / Pull / Merge) ═══
   Guarantees:
     · Zero network calls and zero overhead in guest mode
     · Single-flight lock preventing concurrent overlapping syncs
     · In-flight outbox safety (ackBatch called ONLY after 200 OK)
     · Zero echo loop (remote merges update state/storage without enqueueing outbox)
     · Graceful 401 handling preserving all local user data */

import {
  getAuthState,
  clearAuthSession,
  getSyncCursor,
  setSyncCursor,
  setLastSyncAt,
  getApiBaseUrl,
  resolveFetch,
  getClientBuild,
} from './auth-client.js';
import { isSyncEnabled, peekBatch, ackBatch } from './outbox.js';
import { state, normalizeTask } from './state.js';
import { saveTasks, scheduleSave, readJSON, readString, safeSet, flushPending } from './store.js';
import { pickTask } from './backup.js';
import { invalidateAllBuckets } from './daycache.js';
import { notify } from './bus.js';
import { reloadBooks } from './library.js';
import { purgeOldTombstones } from './taskrepo.js';

export const LAST_GC_AT_KEY = 'daftarche_last_gc_at_v1';
const GC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TOMBSTONE_MAX_AGE_DAYS = 30;
const BOOKS_META_KEY = 'daftarche-books-meta';
const PUSH_BATCH_LIMIT = 50;
const PULL_BATCH_LIMIT = 100;

let isSyncing = false;
let syncConfig = { apiBaseUrl: undefined, fetchImpl: undefined };
let triggersInitialized = false;

/**
 * Configures default API base URL or fetch implementation for sync calls.
 * @param {Object} [options]
 */
export function configureSync({ apiBaseUrl, fetchImpl } = {}) {
  if (apiBaseUrl !== undefined) syncConfig.apiBaseUrl = apiBaseUrl;
  if (fetchImpl !== undefined) syncConfig.fetchImpl = fetchImpl;
}

export function isSyncRunning() {
  return isSyncing;
}

function isOnline(options) {
  if (options && options.ignoreOnlineCheck) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return true;
}

function emitSyncUpdated(detail = {}) {
  notify();
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('daftarche:sync-updated', { detail }));
    } catch {
      // ignore
    }
  }
}

/**
 * Merges an incoming remote task payload with a local task record using
 * tombstone/version/updatedAt rules and preserving device-local notifiedStatus.
 * @param {Object|null} local
 * @param {Object} incoming
 * @returns {Object}
 */
export function mergeRemoteTask(local, incoming) {
  if (!local) {
    return normalizeTask(incoming);
  }

  const localDeleted = Number.isFinite(Number(local.deletedAt)) && Number(local.deletedAt) > 0;
  const incomingDeleted = Number.isFinite(Number(incoming.deletedAt)) && Number(incoming.deletedAt) > 0;

  let winner;
  if (localDeleted || incomingDeleted) {
    winner = pickTask(local, incoming);
  } else {
    const localVer = Number(local.version ?? local.rev) || 1;
    const incomingVer = Number(incoming.version ?? incoming.rev) || 1;
    if (incomingVer > localVer) {
      winner = incoming;
    } else if (localVer > incomingVer) {
      winner = local;
    } else {
      const localUp = Number(local.updatedAt) || 0;
      const incomingUp = Number(incoming.updatedAt) || 0;
      if (local.done !== incoming.done) {
        winner = pickTask(local, incoming);
      } else if (incomingUp > localUp) {
        winner = incoming;
      } else {
        winner = pickTask(local, incoming);
      }
    }
  }

  const merged = normalizeTask(winner);
  if (local.notifiedStatus && ['none', 'soon', 'overdue'].includes(local.notifiedStatus)) {
    merged.notifiedStatus = local.notifiedStatus;
  }
  return merged;
}

function mergeRemoteBook(localBooks, change) {
  const payload = change.payload;
  if (!payload || typeof payload !== 'object' || !payload.id) return false;
  const idx = localBooks.findIndex(b => b && b.id === payload.id);

  if (idx >= 0) {
    const local = localBooks[idx];
    const localUpdated = Number(local.updatedAt ?? local.lastReadAt) || 0;
    const remoteUpdated = Number(payload.updatedAt) || 0;

    const nextPage = Math.max(Number(local.lastPage) || 1, Number(payload.currentPage) || 1);
    const nextNumPages = Math.max(Number(local.numPages) || 0, Number(payload.totalPages) || 0);
    const nextUpdated = Math.max(localUpdated, remoteUpdated);

    let changed = false;
    if (nextPage !== local.lastPage) {
      local.lastPage = nextPage;
      changed = true;
    }
    if (nextNumPages !== local.numPages) {
      local.numPages = nextNumPages;
      changed = true;
    }
    if (nextUpdated > localUpdated) {
      local.updatedAt = nextUpdated;
      changed = true;
    }
    if (payload.dailyGoal && (!local.goal?.pagesPerDay || remoteUpdated > localUpdated)) {
      local.goal = { ...(local.goal && typeof local.goal === 'object' ? local.goal : { type: 'daily' }), pagesPerDay: Number(payload.dailyGoal) };
      changed = true;
    }
    if (change.action === 'delete' && payload.deletedAt) {
      local.deletedAt = Number(payload.deletedAt);
      changed = true;
    }
    return changed;
  }

  if (change.action === 'upsert') {
    localBooks.push({
      id: String(payload.id),
      title: typeof payload.title === 'string' ? payload.title : '',
      addedAt: Number(payload.updatedAt) || Date.now(),
      numPages: Number(payload.totalPages) || 0,
      lastPage: Number(payload.currentPage) || 1,
      goal: payload.dailyGoal ? { type: 'daily', pagesPerDay: Number(payload.dailyGoal) } : null,
      updatedAt: Number(payload.updatedAt) || Date.now(),
      stats: {},
      highlights: [],
      notes: [],
      completedPages: [],
    });
    return true;
  }

  return false;
}

/**
 * Applies pulled remote changes directly to local state & storage WITHOUT
 * enqueueing them back into js/outbox.js (zero echo loop).
 * @param {Array<Object>} changes
 * @returns {{ tasksApplied: number, booksApplied: number }}
 */
export function applyRemoteChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { tasksApplied: 0, booksApplied: 0 };
  }

  if (!Array.isArray(state.tasks)) state.tasks = [];
  const taskIndexById = new Map();
  for (let i = 0; i < state.tasks.length; i++) {
    const t = state.tasks[i];
    if (t && t.id) taskIndexById.set(t.id, i);
  }

  let tasksApplied = 0;
  let booksApplied = 0;
  let booksList = null;

  for (const ch of changes) {
    if (!ch || typeof ch !== 'object' || !ch.payload) continue;

    if (ch.kind === 'task') {
      const incoming = {
        ...ch.payload,
        id: String(ch.payload.id || ch.entityId),
        version: Number(ch.rev) || Number(ch.payload.version) || 1,
        rev: Number(ch.rev) || Number(ch.payload.rev) || 1,
        updatedAt: Number(ch.payload.updatedAt) || Number(ch.ts) || Date.now(),
        deletedAt: ch.action === 'delete'
          ? (Number(ch.payload.deletedAt) || Number(ch.ts) || Date.now())
          : (ch.payload.deletedAt ? Number(ch.payload.deletedAt) : null),
      };

      const existingIdx = taskIndexById.get(incoming.id);
      if (existingIdx !== undefined) {
        state.tasks[existingIdx] = mergeRemoteTask(state.tasks[existingIdx], incoming);
      } else {
        const normalized = normalizeTask(incoming);
        if (normalized) {
          taskIndexById.set(normalized.id, state.tasks.length);
          state.tasks.push(normalized);
        }
      }
      tasksApplied++;
    } else if (ch.kind === 'book') {
      if (booksList === null) {
        const stored = readJSON(BOOKS_META_KEY, []);
        booksList = Array.isArray(stored) ? stored.map(b => ({ ...b })) : [];
      }
      if (mergeRemoteBook(booksList, ch)) {
        booksApplied++;
      }
    }
  }

  if (tasksApplied > 0) {
    saveTasks(state.tasks);
    invalidateAllBuckets();
  }

  if (booksApplied > 0 && booksList !== null) {
    scheduleSave(BOOKS_META_KEY, booksList);
  }

  if (tasksApplied > 0 || booksApplied > 0) {
    flushPending();
    if (booksApplied > 0) {
      try { reloadBooks(); } catch { /* ignore */ }
    }
    emitSyncUpdated({ tasksApplied, booksApplied });
  }

  return { tasksApplied, booksApplied };
}

async function syncFetch(path, body, token, options = {}) {
  const fetchFn = resolveFetch(options.fetchImpl ?? syncConfig.fetchImpl);
  const base = getApiBaseUrl(options.apiBaseUrl ?? syncConfig.apiBaseUrl);
  const res = await fetchFn(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Client-Build': getClientBuild(),
    },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { res, data };
}

/**
 * Pushes all coalesced pending entries from js/outbox.js to POST /api/sync/push.
 * @param {Object} [options]
 */
export async function pushPendingChanges(options = {}) {
  const { isLoggedIn, token } = getAuthState();
  if (!isSyncEnabled() || !isLoggedIn || !token) {
    return { ok: true, skipped: true, reason: 'guest', pushed: 0 };
  }
  if (!isOnline(options)) {
    return { ok: true, skipped: true, reason: 'offline', pushed: 0 };
  }

  let pushed = 0;
  let serverCursor = getSyncCursor();

  while (true) {
    const batch = peekBatch(PUSH_BATCH_LIMIT);
    if (!batch.length) break;

    let res;
    let data;
    try {
      ({ res, data } = await syncFetch('/api/sync/push', { changes: batch }, token, options));
    } catch {
      return { ok: false, networkError: true, error: 'خطا در اتصال هنگام ارسال تغییرات', pushed };
    }

    if (res.status === 401) {
      clearAuthSession();
      return { ok: false, unauthorized: true, status: 401, pushed };
    }

    if (!res.ok || !data || !data.ok) {
      return {
        ok: false,
        status: res.status,
        error: (data && data.error) || 'ارسال تغییرات ناموفق بود',
        pushed,
      };
    }

    const ackedIds = Array.isArray(data.ackedOpIds) ? data.ackedOpIds : [];
    const ackRes = ackBatch(ackedIds);
    pushed += ackRes.removedCount;
    if (Number.isInteger(Number(data.serverCursor))) {
      serverCursor = Number(data.serverCursor);
    }

    if (ackRes.removedCount === 0) break;
  }

  return { ok: true, pushed, serverCursor };
}

/**
 * Pulls delta changes from POST /api/sync/pull and merges them locally.
 * @param {Object} [options]
 */
export async function pullRemoteChanges(options = {}) {
  const { isLoggedIn, token } = getAuthState();
  if (!isSyncEnabled() || !isLoggedIn || !token) {
    return { ok: true, skipped: true, reason: 'guest', pulled: 0 };
  }
  if (!isOnline(options)) {
    return { ok: true, skipped: true, reason: 'offline', pulled: 0 };
  }

  let cursor = getSyncCursor();
  let pulled = 0;
  let hasMore = true;

  while (hasMore) {
    let res;
    let data;
    try {
      ({ res, data } = await syncFetch('/api/sync/pull', {
        sinceCursor: cursor,
        limit: PULL_BATCH_LIMIT,
      }, token, options));
    } catch {
      return { ok: false, networkError: true, error: 'خطا در اتصال هنگام دریافت تغییرات', pulled };
    }

    if (res.status === 401) {
      clearAuthSession();
      return { ok: false, unauthorized: true, status: 401, pulled };
    }

    if (!res.ok || !data || !data.ok) {
      return {
        ok: false,
        status: res.status,
        error: (data && data.error) || 'دریافت تغییرات ناموفق بود',
        pulled,
      };
    }

    const changes = Array.isArray(data.changes) ? data.changes : [];
    if (changes.length > 0) {
      applyRemoteChanges(changes);
      pulled += changes.length;
    }

    if (Number.isInteger(Number(data.nextCursor)) && Number(data.nextCursor) >= cursor) {
      cursor = Number(data.nextCursor);
      setSyncCursor(cursor);
    }

    hasMore = Boolean(data.hasMore) && changes.length > 0;
  }

  return { ok: true, pulled, cursor };
}

/**
 * Executes a full two-way sync cycle (push then pull) under a single-flight lock.
 * Guest users experience zero network calls.
 * @param {Object} [options]
 */
export async function syncNow(options = {}) {
  const { isLoggedIn, token } = getAuthState();
  if (!isSyncEnabled() || !isLoggedIn || !token) {
    return { ok: true, skipped: true, reason: 'guest' };
  }
  if (!isOnline(options)) {
    return { ok: true, skipped: true, reason: 'offline' };
  }
  if (isSyncing) {
    return { ok: true, skipped: true, reason: 'in_flight' };
  }

  isSyncing = true;
  try {
    const push = await pushPendingChanges(options);
    if (!push.ok) {
      return { ok: false, phase: 'push', ...push };
    }

    const pull = await pullRemoteChanges(options);
    if (!pull.ok) {
      return { ok: false, phase: 'pull', push, ...pull };
    }

    const now = Number(options.now) || Date.now();
    let gcPurged = 0;
    const lastGcAt = Number(readString(LAST_GC_AT_KEY, '0')) || 0;
    if (now - lastGcAt >= GC_INTERVAL_MS) {
      const gcRes = purgeOldTombstones(TOMBSTONE_MAX_AGE_DAYS);
      gcPurged = gcRes && Number.isInteger(gcRes.purgedCount) ? gcRes.purgedCount : 0;
      safeSet(LAST_GC_AT_KEY, String(now));
    }

    setLastSyncAt(now);
    emitSyncUpdated({ pushed: push.pushed, pulled: pull.pulled, cursor: pull.cursor, gcPurged });
    return {
      ok: true,
      pushed: push.pushed,
      pulled: pull.pulled,
      cursor: pull.cursor,
      gcPurged,
    };
  } finally {
    isSyncing = false;
  }
}

/**
 * Registers automatic sync triggers (online event + initial boot sync) when logged in.
 * @param {Object} [options]
 */
export function initSyncTriggers(options = {}) {
  if (triggersInitialized) return;
  triggersInitialized = true;

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => {
      const { isLoggedIn } = getAuthState();
      if (isLoggedIn && isSyncEnabled()) {
        syncNow(options).catch(() => {});
      }
    });
  }

  const { isLoggedIn } = getAuthState();
  if (isLoggedIn && isSyncEnabled() && isOnline(options)) {
    syncNow(options).catch(() => {});
  }
}

export const syncClient = {
  configureSync,
  isSyncRunning,
  mergeRemoteTask,
  applyRemoteChanges,
  pushPendingChanges,
  pullRemoteChanges,
  syncNow,
  initSyncTriggers,
};
