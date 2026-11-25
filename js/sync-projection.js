/* ═══ Selective Sync Data Projection & Wire Contract ═══
   Defines the pure projection and envelope contracts for selective cloud sync.
   Guarantees:
     · Zero DOM dependencies — 100% testable in Node.js
     · Strict exclusion of device-local transient state (e.g. notifiedStatus)
     · Strict exclusion of binary/blob data (PDF files, covers)
     · Pure validation of change envelopes
*/

import { normalizeSubtasks, normalizeRepeat } from './task-recurrence.js';
import { normalizeJournalEntry } from './journal-logic.js';

export const SYNC_KINDS = Object.freeze(['task', 'book']);
export const SYNC_ACTIONS = Object.freeze(['upsert', 'delete']);

/**
 * Projects a local task record into a clean, syncable wire payload.
 * Strictly excludes device-local transient state such as notifiedStatus.
 * @param {Object} task
 * @returns {Object|null}
 */
export function projectTaskForSync(task) {
  if (!task || typeof task !== 'object') return null;

  const now = Date.now();
  const version = Number.isInteger(Number(task.version ?? task.rev))
    ? Math.max(1, Number(task.version ?? task.rev))
    : 1;

  return {
    id: String(task.id || ''),
    text: typeof task.text === 'string' ? task.text.trim() : '',
    done: Boolean(task.done),
    p: ['low', 'mid', 'high'].includes(task.p) ? task.p : 'mid',
    cat: typeof task.cat === 'string' && task.cat.trim() ? task.cat.trim() : 'misc',
    dueDate: task.dueDate ? String(task.dueDate) : null,
    durationMin: Number.isInteger(Number(task.durationMin)) && Number(task.durationMin) > 0
      ? Number(task.durationMin)
      : null,
    timeFrom: task.timeFrom ? String(task.timeFrom) : null,
    timeTo: task.timeTo ? String(task.timeTo) : null,
    created: Number(task.created) || now,
    doneAt: task.done ? (Number(task.doneAt) || now) : null,
    notify: Boolean(task.notify),
    repeat: normalizeRepeat(task.repeat),
    subtasks: normalizeSubtasks(task.subtasks),
    courseId: typeof task.courseId === 'string' && task.courseId.trim() ? task.courseId.trim() : null,
    updatedAt: Number(task.updatedAt) || now,
    version,
    deletedAt: task.deletedAt ? (Number(task.deletedAt) || now) : null,
  };
}

/**
 * Projects a book record into a lightweight reading progress payload.
 * Never includes binary PDF blobs or large base64 data.
 * @param {Object} book
 * @returns {Object|null}
 */
export function projectBookProgressForSync(book) {
  if (!book || typeof book !== 'object') return null;

  const now = Date.now();
  const currentPage = Number.isFinite(Number(book.currentPage ?? book.lastPage))
    ? Math.max(1, Math.floor(Number(book.currentPage ?? book.lastPage)))
    : 1;
  const totalPages = Number.isFinite(Number(book.totalPages ?? book.numPages))
    ? Math.max(0, Math.floor(Number(book.totalPages ?? book.numPages)))
    : 0;

  let dailyGoal = null;
  if (book.dailyGoal !== undefined) {
    dailyGoal = Number.isFinite(Number(book.dailyGoal)) && Number(book.dailyGoal) > 0
      ? Math.floor(Number(book.dailyGoal))
      : null;
  } else if (book.goal && typeof book.goal === 'object') {
    dailyGoal = Number.isFinite(Number(book.goal.pagesPerDay)) && Number(book.goal.pagesPerDay) > 0
      ? Math.floor(Number(book.goal.pagesPerDay))
      : null;
  }

  return {
    id: String(book.id || ''),
    title: typeof book.title === 'string' ? book.title.trim() : '',
    currentPage,
    totalPages,
    dailyGoal,
    courseId: typeof book.courseId === 'string' && book.courseId.trim() ? book.courseId.trim() : null,
    updatedAt: Number(book.updatedAt ?? book.lastReadAt) || now,
    deletedAt: book.deletedAt ? (Number(book.deletedAt) || now) : null,
  };
}

/**
 * Projects a daily journal entry into a clean, cloud-sync-ready payload.
 * Preserves existing 'task' | 'book' envelope validation untouched.
 * @param {Object} entry
 * @param {string} [dateKey]
 * @returns {Object|null}
 */
export function projectJournalForSync(entry, dateKey) {
  const norm = normalizeJournalEntry(entry, dateKey);
  if (!norm) return null;
  return {
    id: norm.dateKey,
    dateKey: norm.dateKey,
    title: norm.title,
    text: norm.text,
    photos: norm.photos,
    promptId: norm.promptId,
    mood: norm.mood,
    starred: Boolean(norm.starred),
    updatedAt: norm.updatedAt,
    version: norm.version,
    deletedAt: entry.deletedAt ? (Number(entry.deletedAt) || Date.now()) : null,
  };
}

/**
 * Creates a normalized change envelope for an outgoing sync mutation.
 * @param {Object} options
 * @param {string} options.kind 'task' | 'book'
 * @param {string} options.entityId
 * @param {string} options.action 'upsert' | 'delete'
 * @param {number} [options.rev=1]
 * @param {Object} options.payload
 * @param {string} [options.opId]
 * @param {number} [options.ts]
 * @returns {Object}
 */
export function createSyncEnvelope({
  kind,
  entityId,
  action,
  rev = 1,
  payload = {},
  opId = null,
  ts = null,
}) {
  const now = Date.now();
  const validAction = action === 'delete' ? 'delete' : 'upsert';
  const cleanOpId = opId || `${now}-${Math.random().toString(16).slice(2, 10)}`;

  return {
    opId: String(cleanOpId),
    kind: String(kind),
    entityId: String(entityId),
    action: validAction,
    rev: Number.isInteger(Number(rev)) && Number(rev) >= 1 ? Number(rev) : 1,
    ts: Number(ts) || now,
    payload: payload && typeof payload === 'object' ? payload : {},
  };
}

/**
 * Validates a change envelope wire contract.
 * @param {any} envelope
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateSyncEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { valid: false, error: 'Envelope must be an object' };
  }

  if (typeof envelope.opId !== 'string' || !envelope.opId.trim()) {
    return { valid: false, error: 'Invalid or missing opId' };
  }

  if (!SYNC_KINDS.includes(envelope.kind)) {
    return { valid: false, error: `Invalid kind: ${envelope.kind}. Expected one of: ${SYNC_KINDS.join(', ')}` };
  }

  if (typeof envelope.entityId !== 'string' || !envelope.entityId.trim()) {
    return { valid: false, error: 'Invalid or missing entityId' };
  }

  if (!SYNC_ACTIONS.includes(envelope.action)) {
    return { valid: false, error: `Invalid action: ${envelope.action}. Expected one of: ${SYNC_ACTIONS.join(', ')}` };
  }

  const rev = Number(envelope.rev);
  if (!Number.isInteger(rev) || rev < 1) {
    return { valid: false, error: 'rev must be a positive integer >= 1' };
  }

  const ts = Number(envelope.ts);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { valid: false, error: 'ts must be a valid timestamp' };
  }

  if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
    return { valid: false, error: 'payload must be an object' };
  }

  // Payload must contain entity id
  if (envelope.payload.id !== undefined && String(envelope.payload.id) !== envelope.entityId) {
    return { valid: false, error: 'payload.id does not match entityId' };
  }

  return { valid: true };
}
