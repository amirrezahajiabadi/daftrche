/* ═══ Task Repository (Data Access Layer) ═══
   Single source of truth for all task reads and mutations.
   Guarantees:
     · Sync-ready metadata envelope: updatedAt (epoch ms), version (integer >= 1), deletedAt (epoch ms | null)
     · Synchronous read models for zero UI latency
     · Safe write methods returning { ok: true, record } or { ok: false, error }
     · Automatic persistence scheduling and reactive bus event notifications
*/

import { state, normalizeTask } from './state.js';
import { saveTasks } from './store.js';
import { notify } from './bus.js';
import { parseDurationMin, parseTimeRange, reorderSubset } from './utils.js';

/**
 * Returns all active (non-deleted) tasks.
 * @returns {Array<Object>}
 */
export function getActiveTasks() {
  const list = Array.isArray(state.tasks) ? state.tasks : [];
  return list.filter(t => t && !t.deletedAt);
}

/**
 * Returns all tasks including tombstones (for backup, sync, and GC).
 * @returns {Array<Object>}
 */
export function getAllTasksIncludingDeleted() {
  return Array.isArray(state.tasks) ? state.tasks : [];
}

/**
 * Returns a single task by ID. Defaults to active tasks only.
 * @param {string} id
 * @param {Object} [options]
 * @param {boolean} [options.includeDeleted=false]
 * @returns {Object|null}
 */
export function getTaskById(id, { includeDeleted = false } = {}) {
  if (!id) return null;
  const list = Array.isArray(state.tasks) ? state.tasks : [];
  return list.find(t => t && t.id === id && (includeDeleted || !t.deletedAt)) || null;
}

/**
 * Creates a new task with initial envelope (version 1, deletedAt null, updatedAt now).
 * @param {Object} data
 * @returns {{ ok: boolean, record?: Object, error?: string }}
 */
export function createTask(data = {}) {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Invalid task payload' };
  }
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text) {
    return { ok: false, error: 'Task text is required' };
  }

  const now = Date.now();
  const raw = {
    id: data.id || (now + '' + Math.random().toString(16).slice(2)),
    text,
    done: Boolean(data.done),
    p: ['low', 'mid', 'high'].includes(data.p) ? data.p : 'mid',
    cat: typeof data.cat === 'string' && data.cat.trim() ? data.cat.trim() : 'misc',
    dueDate: data.dueDate || null,
    durationMin: parseDurationMin(data.durationMin),
    created: Number(data.created) || now,
    doneAt: data.done ? (Number(data.doneAt) || now) : null,
    notify: Boolean(data.notify),
    notifiedStatus: ['none', 'soon', 'overdue'].includes(data.notifiedStatus) ? data.notifiedStatus : 'none',
    updatedAt: now,
    version: 1,
    rev: 1,
    deletedAt: null,
  };

  const span = parseTimeRange(data.timeFrom, data.timeTo);
  raw.timeFrom = span ? span.from : null;
  raw.timeTo = span ? span.to : null;

  const task = normalizeTask(raw);
  if (!task) {
    return { ok: false, error: 'Failed to normalize task' };
  }

  if (!Array.isArray(state.tasks)) state.tasks = [];
  state.tasks.unshift(task);

  saveTasks(state.tasks);
  notify();

  return { ok: true, record: task };
}

/**
 * Updates an existing task by ID with a partial patch.
 * Bumps version and updates updatedAt.
 * @param {string} id
 * @param {Object} patch
 * @returns {{ ok: boolean, record?: Object, error?: string }}
 */
export function updateTask(id, patch = {}) {
  if (!id || !patch || typeof patch !== 'object') {
    return { ok: false, error: 'Invalid update arguments' };
  }

  const task = getTaskById(id, { includeDeleted: true });
  if (!task) {
    return { ok: false, error: 'Task not found' };
  }

  if ('text' in patch && typeof patch.text === 'string') {
    const trimmed = patch.text.trim();
    if (trimmed) task.text = trimmed;
  }

  if ('p' in patch && ['low', 'mid', 'high'].includes(patch.p)) {
    task.p = patch.p;
  }

  if ('cat' in patch && typeof patch.cat === 'string') {
    task.cat = patch.cat.trim() || 'misc';
  }

  if ('dueDate' in patch) {
    const prevDue = task.dueDate;
    task.dueDate = patch.dueDate || null;
    if (prevDue !== task.dueDate && !('notifiedStatus' in patch)) {
      task.notifiedStatus = 'none';
    }
  }

  if ('durationMin' in patch) {
    task.durationMin = parseDurationMin(patch.durationMin);
  }

  if ('timeFrom' in patch || 'timeTo' in patch) {
    const from = 'timeFrom' in patch ? patch.timeFrom : task.timeFrom;
    const to = 'timeTo' in patch ? patch.timeTo : task.timeTo;
    const span = parseTimeRange(from, to);
    task.timeFrom = span ? span.from : null;
    task.timeTo = span ? span.to : null;
  }

  if ('done' in patch) {
    const nextDone = Boolean(patch.done);
    if (task.done !== nextDone) {
      task.done = nextDone;
      task.doneAt = nextDone ? (Number(patch.doneAt) || Date.now()) : null;
    }
  } else if ('doneAt' in patch) {
    task.doneAt = task.done ? (Number(patch.doneAt) || Date.now()) : null;
  }

  if ('notify' in patch) {
    task.notify = Boolean(patch.notify);
  }
  if ('notifiedStatus' in patch && ['none', 'soon', 'overdue'].includes(patch.notifiedStatus)) {
    task.notifiedStatus = patch.notifiedStatus;
  }

  const now = Date.now();
  task.updatedAt = now;
  const currentVersion = Number.isInteger(Number(task.version ?? task.rev)) ? Number(task.version ?? task.rev) : 1;
  task.version = currentVersion + 1;
  task.rev = task.version;

  saveTasks(state.tasks);
  notify();

  return { ok: true, record: task };
}

/**
 * Toggles or sets completion status for a task.
 * @param {string} id
 * @param {boolean} [forcedState]
 * @returns {{ ok: boolean, record?: Object, error?: string }}
 */
export function toggleTaskDone(id, forcedState) {
  const task = getTaskById(id);
  if (!task) return { ok: false, error: 'Task not found' };
  const next = typeof forcedState === 'boolean' ? forcedState : !task.done;
  return updateTask(id, { done: next });
}

/**
 * Soft-deletes a task by setting deletedAt timestamp (tombstone).
 * The task is preserved in state.tasks for sync and undo, but hidden from active views.
 * @param {string} id
 * @returns {{ ok: boolean, record?: Object, error?: string }}
 */
export function softDeleteTask(id) {
  const task = getTaskById(id, { includeDeleted: true });
  if (!task) return { ok: false, error: 'Task not found' };
  if (task.deletedAt) return { ok: true, record: task };

  const now = Date.now();
  task.deletedAt = now;
  task.updatedAt = now;
  const currentVersion = Number.isInteger(Number(task.version ?? task.rev)) ? Number(task.version ?? task.rev) : 1;
  task.version = currentVersion + 1;
  task.rev = task.version;

  saveTasks(state.tasks);
  notify();

  return { ok: true, record: task };
}

/**
 * Restores a soft-deleted task by clearing its tombstone.
 * @param {string} id
 * @returns {{ ok: boolean, record?: Object, error?: string }}
 */
export function restoreTask(id) {
  const task = getTaskById(id, { includeDeleted: true });
  if (!task) return { ok: false, error: 'Task not found' };
  if (!task.deletedAt) return { ok: true, record: task };

  const now = Date.now();
  task.deletedAt = null;
  task.updatedAt = now;
  const currentVersion = Number.isInteger(Number(task.version ?? task.rev)) ? Number(task.version ?? task.rev) : 1;
  task.version = currentVersion + 1;
  task.rev = task.version;

  saveTasks(state.tasks);
  notify();

  return { ok: true, record: task };
}

/**
 * Reorders tasks using explicit order of IDs while preserving hidden/tombstone items.
 * @param {Array<string>} orderedIds
 * @returns {{ ok: boolean, records: Array<Object> }}
 */
export function reorderTasks(orderedIds) {
  if (!Array.isArray(orderedIds)) return { ok: false, error: 'orderedIds must be an array' };
  state.tasks = reorderSubset(Array.isArray(state.tasks) ? state.tasks : [], orderedIds);
  saveTasks(state.tasks);
  notify();
  return { ok: true, records: getActiveTasks() };
}

/**
 * Garbage-collects tombstones older than maxAgeDays.
 * @param {number} [maxAgeDays=30]
 * @returns {{ ok: boolean, purgedCount: number }}
 */
export function purgeOldTombstones(maxAgeDays = 30) {
  const days = Number.isFinite(Number(maxAgeDays)) && Number(maxAgeDays) > 0 ? Number(maxAgeDays) : 30;
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const initial = Array.isArray(state.tasks) ? state.tasks.length : 0;
  if (!initial) return { ok: true, purgedCount: 0 };

  state.tasks = state.tasks.filter(t => !t || !t.deletedAt || t.deletedAt >= cutoff);
  const purgedCount = initial - state.tasks.length;
  if (purgedCount > 0) {
    saveTasks(state.tasks);
    notify();
  }
  return { ok: true, purgedCount };
}

/**
 * Rehydrates tasks from backup or storage, ensuring all records are properly normalized.
 * @param {Array<Object>} tasks
 * @returns {{ ok: boolean, records: Array<Object> }}
 */
export function hydrateTasks(tasks) {
  state.tasks = Array.isArray(tasks) ? tasks.map(normalizeTask).filter(Boolean) : [];
  return { ok: true, records: state.tasks };
}

// Aliases matching proposed Repository Contracts
export const all = getActiveTasks;
export const get = getTaskById;
export const create = createTask;
export const update = updateTask;
export const setDone = (id, done) => updateTask(id, { done: Boolean(done) });
export const reorder = reorderTasks;

export const taskRepo = {
  getActiveTasks,
  getAllTasksIncludingDeleted,
  getTaskById,
  createTask,
  updateTask,
  toggleTaskDone,
  softDeleteTask,
  restoreTask,
  reorderTasks,
  purgeOldTombstones,
  hydrateTasks,
  all,
  get,
  create,
  update,
  setDone,
  reorder,
};
