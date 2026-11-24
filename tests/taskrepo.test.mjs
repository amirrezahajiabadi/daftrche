/* ═══ Task Repository & Soft-Delete Unit Tests ═══
   Verifies:
     · Sync-ready metadata envelope (updatedAt, version/rev, deletedAt)
     · CRUD operations (createTask, updateTask, toggleTaskDone)
     · Soft delete (tombstones) and restore
     · Active vs deleted queries (getActiveTasks, getAllTasksIncludingDeleted, getTaskById)
     · Tombstone garbage collection (purgeOldTombstones)
     · Legacy task envelope migration
     · Backup merge engine tombstone resolution
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import { state, normalizeTask } from '../js/state.js';
import {
  taskRepo,
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
  hydrateTasks
} from '../js/taskrepo.js';
import { mergeBackup } from '../js/backup.js';

class FakeStorage {
  constructor(init = {}) { this.map = new Map(Object.entries(init)); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] || null; }
}

const resetTasks = () => {
  state.tasks = [];
};

test('createTask: initializes metadata envelope (updatedAt, version 1, deletedAt null)', () => {
  resetTasks();
  const res = createTask({ text: 'کار اول', p: 'high', cat: 'work' });

  assert.equal(res.ok, true);
  assert.ok(res.record);
  assert.equal(res.record.text, 'کار اول');
  assert.equal(res.record.p, 'high');
  assert.equal(res.record.cat, 'work');
  assert.equal(res.record.done, false);
  assert.equal(res.record.deletedAt, null);
  assert.equal(res.record.version, 1);
  assert.equal(res.record.rev, 1);
  assert.ok(Number.isFinite(res.record.updatedAt) && res.record.updatedAt > 0);
  assert.ok(Number.isFinite(res.record.created) && res.record.created > 0);

  // Present in active tasks
  assert.equal(getActiveTasks().length, 1);
  assert.equal(getActiveTasks()[0].id, res.record.id);
});

test('createTask: rejects empty or invalid payload', () => {
  resetTasks();
  assert.equal(createTask(null).ok, false);
  assert.equal(createTask({}).ok, false);
  assert.equal(createTask({ text: '   ' }).ok, false);
  assert.equal(getActiveTasks().length, 0);
});

test('updateTask: increments version and stamps updatedAt', () => {
  resetTasks();
  const created = createTask({ text: 'کار قابل ویرایش' }).record;
  const initialVersion = created.version;
  const initialUpdatedAt = created.updatedAt;

  // Small delay to verify timestamp strictly increases or matches now
  const t1 = Date.now() + 10;
  const updated = updateTask(created.id, { text: 'کار ویرایش‌شده', p: 'low', cat: 'home' }).record;

  assert.equal(updated.text, 'کار ویرایش‌شده');
  assert.equal(updated.p, 'low');
  assert.equal(updated.cat, 'home');
  assert.equal(updated.version, initialVersion + 1);
  assert.equal(updated.rev, initialVersion + 1);
  assert.ok(updated.updatedAt >= initialUpdatedAt);

  // Update again
  const updated2 = updateTask(created.id, { durationMin: 45 }).record;
  assert.equal(updated2.durationMin, 45);
  assert.equal(updated2.version, initialVersion + 2);
  assert.equal(updated2.rev, initialVersion + 2);
});

test('updateTask: changes completion and sets/clears doneAt', () => {
  resetTasks();
  const task = createTask({ text: 'تست تیک خوردن' }).record;
  assert.equal(task.done, false);
  assert.equal(task.doneAt, null);

  const doneRes = updateTask(task.id, { done: true });
  assert.equal(doneRes.ok, true);
  assert.equal(doneRes.record.done, true);
  assert.ok(Number.isFinite(doneRes.record.doneAt) && doneRes.record.doneAt > 0);

  const undoneRes = updateTask(task.id, { done: false });
  assert.equal(undoneRes.ok, true);
  assert.equal(undoneRes.record.done, false);
  assert.equal(undoneRes.record.doneAt, null);
});

test('updateTask: resets notifiedStatus to none when dueDate changes', () => {
  resetTasks();
  const task = createTask({ text: 'کار دارای موعد', dueDate: '2026-10-01', notifiedStatus: 'soon' }).record;
  assert.equal(task.notifiedStatus, 'soon');

  const updated = updateTask(task.id, { dueDate: '2026-10-02' }).record;
  assert.equal(updated.dueDate, '2026-10-02');
  assert.equal(updated.notifiedStatus, 'none');
});

test('updateTask: returns error for non-existent id', () => {
  resetTasks();
  const res = updateTask('non-existent-id', { text: 'x' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'Task not found');
});

test('toggleTaskDone: toggles completion state cleanly', () => {
  resetTasks();
  const task = createTask({ text: 'تست تاگل' }).record;
  assert.equal(task.done, false);

  toggleTaskDone(task.id);
  assert.equal(getTaskById(task.id).done, true);

  toggleTaskDone(task.id);
  assert.equal(getTaskById(task.id).done, false);

  // Forced state
  toggleTaskDone(task.id, true);
  assert.equal(getTaskById(task.id).done, true);
});

test('softDeleteTask: creates a tombstone and hides from getActiveTasks', () => {
  resetTasks();
  const t1 = createTask({ text: 'کار یک' }).record;
  const t2 = createTask({ text: 'کار دو' }).record;
  assert.equal(getActiveTasks().length, 2);

  const delRes = softDeleteTask(t1.id);
  assert.equal(delRes.ok, true);
  assert.ok(Number.isFinite(delRes.record.deletedAt) && delRes.record.deletedAt > 0);
  assert.equal(delRes.record.version, 2);
  assert.equal(delRes.record.rev, 2);

  // Active tasks only return t2
  const active = getActiveTasks();
  assert.equal(active.length, 1);
  assert.equal(active[0].id, t2.id);

  // All tasks still contain both
  const all = getAllTasksIncludingDeleted();
  assert.equal(all.length, 2);

  // getTaskById default excludes deleted
  assert.equal(getTaskById(t1.id), null);
  // getTaskById with includeDeleted finds tombstone
  assert.equal(getTaskById(t1.id, { includeDeleted: true }).id, t1.id);

  // Idempotent
  const delAgain = softDeleteTask(t1.id);
  assert.equal(delAgain.ok, true);
  assert.equal(delAgain.record.version, 2); // Not incremented again
});

test('restoreTask: clears tombstone and brings task back to active list', () => {
  resetTasks();
  const task = createTask({ text: 'کار قابل بازگشت' }).record;
  softDeleteTask(task.id);
  assert.equal(getActiveTasks().length, 0);

  const res = restoreTask(task.id);
  assert.equal(res.ok, true);
  assert.equal(res.record.deletedAt, null);
  assert.equal(res.record.version, 3); // 1 (create) -> 2 (soft delete) -> 3 (restore)
  assert.equal(res.record.rev, 3);

  // Now active again
  assert.equal(getActiveTasks().length, 1);
  assert.equal(getTaskById(task.id).text, 'کار قابل بازگشت');

  // Idempotent restore
  const resAgain = restoreTask(task.id);
  assert.equal(resAgain.ok, true);
  assert.equal(resAgain.record.version, 3);
});

test('reorderTasks: preserves order and keeps tombstones', () => {
  resetTasks();
  const t1 = createTask({ text: 'کار ۱' }).record;
  const t2 = createTask({ text: 'کار ۲' }).record;
  const t3 = createTask({ text: 'کار ۳' }).record;

  // Soft-delete t2
  softDeleteTask(t2.id);

  // Reorder t3 before t1
  const reorderRes = reorderTasks([t3.id, t1.id]);
  assert.equal(reorderRes.ok, true);
  assert.deepEqual(reorderRes.records.map(t => t.id), [t3.id, t1.id]);

  // t2 is still preserved in state.tasks
  const all = getAllTasksIncludingDeleted();
  assert.ok(all.some(t => t.id === t2.id));
});

test('purgeOldTombstones: garbage collects tombstones older than maxAgeDays', () => {
  resetTasks();
  const oldTime = Date.now() - (35 * 24 * 60 * 60 * 1000); // 35 days ago
  const recentTime = Date.now() - (5 * 24 * 60 * 60 * 1000); // 5 days ago

  const oldTombstone = normalizeTask({ id: 'old-tomb', text: 'حذف‌شده ۳۵ روز پیش', deletedAt: oldTime, version: 2 });
  const recentTombstone = normalizeTask({ id: 'recent-tomb', text: 'حذف‌شده ۵ روز پیش', deletedAt: recentTime, version: 2 });
  const activeTask = normalizeTask({ id: 'active', text: 'کار زنده', deletedAt: null, version: 1 });

  state.tasks = [oldTombstone, recentTombstone, activeTask];
  assert.equal(getAllTasksIncludingDeleted().length, 3);

  const purgeRes = purgeOldTombstones(30);
  assert.equal(purgeRes.ok, true);
  assert.equal(purgeRes.purgedCount, 1);

  const remaining = getAllTasksIncludingDeleted();
  assert.equal(remaining.length, 2);
  assert.equal(remaining.some(t => t.id === 'old-tomb'), false);
  assert.equal(remaining.some(t => t.id === 'recent-tomb'), true);
  assert.equal(remaining.some(t => t.id === 'active'), true);
});

test('hydrateTasks: loads and normalizes tasks batch', () => {
  resetTasks();
  const incoming = [
    { id: 'h1', text: 'هیدراته ۱' },
    { id: 'h2', text: 'هیدراته ۲', deletedAt: 1000 }
  ];
  const res = hydrateTasks(incoming);
  assert.equal(res.ok, true);
  assert.equal(state.tasks.length, 2);
  assert.equal(state.tasks[0].version, 1);
  assert.equal(state.tasks[1].version, 1);
  assert.equal(getActiveTasks().length, 1);
  assert.equal(getActiveTasks()[0].id, 'h1');
});

test('legacy migration: unversioned tasks receive valid envelope defaults', () => {
  const legacyTask = { id: 'leg-1', text: 'کار قدیمی بدون متادیتا', done: false, created: 1000 };
  const normalized = normalizeTask(legacyTask);

  assert.equal(normalized.id, 'leg-1');
  assert.equal(normalized.version, 1);
  assert.equal(normalized.rev, 1);
  assert.equal(normalized.updatedAt, 1000);
  assert.equal(normalized.deletedAt, null);
});

test('backup merge: tombstone resolution respects version and updatedAt', () => {
  const BACKUP_APP = 'daftarche';

  // Scenario 1: Incoming tombstone with higher version beats older local active task
  const dst1 = new FakeStorage({
    'daftarche-v1': JSON.stringify([{ id: 'task-sync-1', text: 'کار در دستگاه محلی', done: false, version: 1, updatedAt: 1000, deletedAt: null }])
  });
  const backup1 = {
    app: BACKUP_APP,
    format: 1,
    data: {
      'daftarche-v1': JSON.stringify([{ id: 'task-sync-1', text: 'کار در دستگاه محلی', done: false, version: 2, updatedAt: 2000, deletedAt: 2000 }])
    }
  };
  mergeBackup(dst1, backup1);
  const res1 = JSON.parse(dst1.getItem('daftarche-v1'));
  assert.equal(res1.length, 1);
  assert.equal(res1[0].deletedAt, 2000);
  assert.equal(res1[0].version, 2);

  // Scenario 2: Local active task with higher version beats older incoming tombstone
  const dst2 = new FakeStorage({
    'daftarche-v1': JSON.stringify([{ id: 'task-sync-2', text: 'کار بازیابی شده', done: false, version: 3, updatedAt: 3000, deletedAt: null }])
  });
  const backup2 = {
    app: BACKUP_APP,
    format: 1,
    data: {
      'daftarche-v1': JSON.stringify([{ id: 'task-sync-2', text: 'کار حذف شده', done: false, version: 2, updatedAt: 2000, deletedAt: 2000 }])
    }
  };
  mergeBackup(dst2, backup2);
  const res2 = JSON.parse(dst2.getItem('daftarche-v1'));
  assert.equal(res2.length, 1);
  assert.equal(res2[0].deletedAt, null);
  assert.equal(res2[0].version, 3);
});
