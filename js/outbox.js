/* ═══ Client-Side Sync Outbox ═══
   Guarantees:
     · Zero overhead for guests: when sync is disabled, zero writes and zero computation
     · Coalescing / deduplication: offline mutations on the same entity are compacted to latest rev
     · Resilient persistence: backed by localStorage under 'daftarche_outbox_v1' with Quota safety
     · Batch lifecycle: peekBatch(limit) and ackBatch(opIds) for reliable wire delivery
*/

import { validateSyncEnvelope } from './sync-projection.js';

export const OUTBOX_STORAGE_KEY = 'daftarche_outbox_v1';
export const SYNC_ENABLED_KEY = 'daftarche_sync_enabled';
export const MAX_OUTBOX_ENTRIES = 500;

let inMemorySyncEnabled = null;
let inMemoryQueue = [];

/**
 * Checks whether selective cloud sync is enabled for the current user.
 * Guests always return false (default).
 * @returns {boolean}
 */
export function isSyncEnabled() {
  try {
    if (typeof localStorage !== 'undefined') {
      const val = localStorage.getItem(SYNC_ENABLED_KEY);
      return val === 'true';
    }
  } catch {
    // ignore
  }
  return inMemorySyncEnabled === true;
}

/**
 * Enables or disables selective cloud sync.
 * @param {boolean} enabled
 */
export function setSyncEnabled(enabled) {
  const val = Boolean(enabled);
  inMemorySyncEnabled = val;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SYNC_ENABLED_KEY, String(val));
    }
  } catch {
    // ignore
  }
}

/**
 * Reads raw outbox queue from storage or in-memory fallback.
 * @returns {Array<Object>}
 */
function readOutbox() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        inMemoryQueue = parsed;
        return parsed;
      }
      return [];
    }
  } catch (err) {
    console.warn('[outbox] Failed to read outbox from localStorage', err);
  }
  return inMemoryQueue;
}

/**
 * Writes outbox queue to storage with bounding and quota safety.
 * @param {Array<Object>} entries
 */
function writeOutbox(entries) {
  const bounded = entries.slice(-MAX_OUTBOX_ENTRIES);
  inMemoryQueue = bounded;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(bounded));
    }
  } catch (err) {
    console.warn('[outbox] Failed to write outbox to localStorage (quota exceeded or disabled)', err);
  }
}

/**
 * Pure function that coalesces multiple mutations for the same entity into the latest state.
 * Preserves action ('delete' vs 'upsert'), takes the highest revision, and latest timestamp.
 * @param {Array<Object>} entries
 * @returns {Array<Object>}
 */
export function coalesceEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const map = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !entry.kind || !entry.entityId) continue;
    const key = `${entry.kind}:${entry.entityId}`;

    if (!map.has(key)) {
      map.set(key, { ...entry });
    } else {
      const existing = map.get(key);
      const existingRev = Number(existing.rev) || 1;
      const newRev = Number(entry.rev) || 1;

      if (newRev >= existingRev) {
        map.set(key, {
          ...existing,
          ...entry,
          rev: newRev,
          ts: Math.max(Number(existing.ts) || 0, Number(entry.ts) || 0),
        });
      } else {
        map.set(key, {
          ...entry,
          ...existing,
          rev: existingRev,
          ts: Math.max(Number(existing.ts) || 0, Number(entry.ts) || 0),
        });
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Enqueues a validated change envelope into the outbox.
 * If sync is disabled (guest mode), this is a strict no-op with zero storage overhead.
 * @param {Object} envelope
 * @returns {{ ok: boolean, count?: number, error?: string, reason?: string }}
 */
export function appendChange(envelope) {
  if (!isSyncEnabled()) {
    return { ok: false, reason: 'sync_disabled' };
  }
  if (!envelope || typeof envelope !== 'object') {
    return { ok: false, error: 'Invalid envelope' };
  }

  const validation = validateSyncEnvelope(envelope);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const current = readOutbox();
  current.push(envelope);
  const coalesced = coalesceEntries(current);
  writeOutbox(coalesced);
  return { ok: true, count: coalesced.length };
}

/**
 * Peeks up to `limit` coalesced envelopes ready for sync transmission.
 * @param {number} [limit=50]
 * @returns {Array<Object>}
 */
export function peekBatch(limit = 50) {
  if (!isSyncEnabled()) return [];
  const lim = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 50;
  const list = coalesceEntries(readOutbox());
  return list.slice(0, lim);
}

/**
 * Acknowledges successfully synced operation IDs, removing them from the outbox.
 * @param {Array<string>} opIds
 * @returns {{ ok: boolean, removedCount: number, remainingCount: number }}
 */
export function ackBatch(opIds) {
  if (!isSyncEnabled()) return { ok: true, removedCount: 0, remainingCount: 0 };
  if (!Array.isArray(opIds) || opIds.length === 0) {
    return { ok: true, removedCount: 0, remainingCount: readOutbox().length };
  }

  const idSet = new Set(opIds.map(String));
  const current = readOutbox();
  const remaining = current.filter(entry => !idSet.has(String(entry.opId)));
  const removedCount = current.length - remaining.length;
  writeOutbox(remaining);
  return { ok: true, removedCount, remainingCount: remaining.length };
}

/**
 * Returns the current number of pending entries in the outbox.
 * @returns {number}
 */
export function getPendingCount() {
  if (!isSyncEnabled()) return 0;
  return readOutbox().length;
}

/**
 * Clears all pending entries in the outbox.
 */
export function clearOutbox() {
  inMemoryQueue = [];
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(OUTBOX_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export const outbox = {
  isSyncEnabled,
  setSyncEnabled,
  appendChange,
  peekBatch,
  ackBatch,
  getPendingCount,
  clearOutbox,
  coalesceEntries,
};
