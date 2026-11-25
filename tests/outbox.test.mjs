/* ═══ Client-Side Sync Outbox Unit Tests ═══
   Verifies:
     · Guest-first zero overhead guard (zero writes, zero queueing when sync is disabled)
     · Coalescing logic (deduplication of multiple offline mutations, tombstone preservation)
     · Outbox batch lifecycle (peekBatch, ackBatch, clearOutbox, getPendingCount)
     · TaskRepo integration (enqueueing upsert/delete envelopes on task mutations)
     · Backward compatibility (hydrateTasks does not contaminate outbox)
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSyncEnabled,
  setSyncEnabled,
  appendChange,
  peekBatch,
  ackBatch,
  getPendingCount,
  clearOutbox,
  coalesceEntries,
  OUTBOX_STORAGE_KEY,
  SYNC_ENABLED_KEY,
} from '../js/outbox.js';

import { createSyncEnvelope } from '../js/sync-projection.js';
import { state } from '../js/state.js';
import {
  createTask,
  updateTask,
  toggleTaskDone,
  softDeleteTask,
  restoreTask,
  hydrateTasks,
} from '../js/taskrepo.js';

class FakeStorage {
  constructor(init = {}) { this.map = new Map(Object.entries(init)); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] || null; }
}

const setupStorage = () => {
  globalThis.localStorage = new FakeStorage();
  clearOutbox();
  setSyncEnabled(false);
  state.tasks = [];
};

test('Guest Mode Guard: sync is disabled by default and mutations are strict no-ops', () => {
  setupStorage();

  assert.equal(isSyncEnabled(), false);

  const env = createSyncEnvelope({
    kind: 'task',
    entityId: 't-1',
    action: 'upsert',
    rev: 1,
    payload: { id: 't-1', text: 'کاری تستی' },
  });

  const res = appendChange(env);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'sync_disabled');
  assert.equal(getPendingCount(), 0);
  assert.deepEqual(peekBatch(), []);

  const ack = ackBatch(['any-op']);
  assert.equal(ack.ok, true);
  assert.equal(ack.removedCount, 0);

  // localStorage must remain untouched
  assert.equal(localStorage.getItem(OUTBOX_STORAGE_KEY), null);
});

test('Logged-in Mode: enqueues valid envelopes and bounds queue', () => {
  setupStorage();
  setSyncEnabled(true);
  assert.equal(isSyncEnabled(), true);

  // Rejects invalid envelope
  const invalid = appendChange({ kind: 'task' });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.error);

  // Appends valid envelope
  const env1 = createSyncEnvelope({
    kind: 'task',
    entityId: 'task-10',
    action: 'upsert',
    rev: 1,
    payload: { id: 'task-10', text: 'وظیفه یک' },
  });

  const res1 = appendChange(env1);
  assert.equal(res1.ok, true);
  assert.equal(res1.count, 1);
  assert.equal(getPendingCount(), 1);

  const batch = peekBatch();
  assert.equal(batch.length, 1);
  assert.equal(batch[0].entityId, 'task-10');
  assert.equal(batch[0].rev, 1);

  // Stored in localStorage
  const stored = JSON.parse(localStorage.getItem(OUTBOX_STORAGE_KEY));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].entityId, 'task-10');
});

test('coalesceEntries: pure function compacts mutations and preserves latest state', () => {
  const entries = [
    { opId: 'op1', kind: 'task', entityId: 't-1', action: 'upsert', rev: 1, ts: 1000, payload: { id: 't-1', text: 'نسخه ۱' } },
    { opId: 'op2', kind: 'task', entityId: 't-2', action: 'upsert', rev: 1, ts: 1005, payload: { id: 't-2', text: 'وظیفه دو' } },
    { opId: 'op3', kind: 'task', entityId: 't-1', action: 'upsert', rev: 2, ts: 1010, payload: { id: 't-1', text: 'نسخه ۲ ویرایش شده' } },
    { opId: 'op4', kind: 'task', entityId: 't-1', action: 'delete', rev: 3, ts: 1020, payload: { id: 't-1', deletedAt: 1020 } },
  ];

  const coalesced = coalesceEntries(entries);
  assert.equal(coalesced.length, 2);

  // t-1 must be coalesced into the latest delete action at rev 3
  const t1 = coalesced.find(e => e.entityId === 't-1');
  assert.ok(t1);
  assert.equal(t1.opId, 'op4');
  assert.equal(t1.action, 'delete');
  assert.equal(t1.rev, 3);
  assert.equal(t1.ts, 1020);
  assert.equal(t1.payload.deletedAt, 1020);

  // t-2 remains untouched
  const t2 = coalesced.find(e => e.entityId === 't-2');
  assert.ok(t2);
  assert.equal(t2.opId, 'op2');
  assert.equal(t2.action, 'upsert');
  assert.equal(t2.rev, 1);
});

test('coalesceEntries: restoring a deleted task updates action back to upsert with higher rev', () => {
  const entries = [
    { opId: 'op1', kind: 'task', entityId: 't-1', action: 'delete', rev: 2, ts: 2000, payload: { id: 't-1', deletedAt: 2000 } },
    { opId: 'op2', kind: 'task', entityId: 't-1', action: 'upsert', rev: 3, ts: 2050, payload: { id: 't-1', text: 'بازگردانی شد', deletedAt: null } },
  ];

  const coalesced = coalesceEntries(entries);
  assert.equal(coalesced.length, 1);
  assert.equal(coalesced[0].action, 'upsert');
  assert.equal(coalesced[0].rev, 3);
  assert.equal(coalesced[0].payload.text, 'بازگردانی شد');
});

test('peekBatch and ackBatch: handles in-flight batch acknowledgement correctly', () => {
  setupStorage();
  setSyncEnabled(true);

  const env1 = createSyncEnvelope({ kind: 'task', entityId: 't-1', action: 'upsert', rev: 1, opId: 'op-1', payload: { id: 't-1' } });
  const env2 = createSyncEnvelope({ kind: 'task', entityId: 't-2', action: 'upsert', rev: 1, opId: 'op-2', payload: { id: 't-2' } });
  const env3 = createSyncEnvelope({ kind: 'book', entityId: 'b-1', action: 'upsert', rev: 1, opId: 'op-3', payload: { id: 'b-1' } });

  appendChange(env1);
  appendChange(env2);
  appendChange(env3);

  assert.equal(getPendingCount(), 3);

  // Peek batch with limit 2
  const peeked = peekBatch(2);
  assert.equal(peeked.length, 2);
  assert.equal(peeked[0].opId, 'op-1');
  assert.equal(peeked[1].opId, 'op-2');

  // Ack first batch
  const ackRes = ackBatch(['op-1', 'op-2']);
  assert.equal(ackRes.ok, true);
  assert.equal(ackRes.removedCount, 2);
  assert.equal(ackRes.remainingCount, 1);
  assert.equal(getPendingCount(), 1);

  const remaining = peekBatch();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].opId, 'op-3');

  // Clear outbox
  clearOutbox();
  assert.equal(getPendingCount(), 0);
});

test('TaskRepo + Outbox: task mutations enqueue sync envelopes when sync is enabled', () => {
  setupStorage();
  setSyncEnabled(true);

  // 1. Create task
  const createRes = createTask({ text: 'یادگیری معماری', p: 'high', cat: 'study' });
  assert.equal(createRes.ok, true);
  const taskId = createRes.record.id;

  assert.equal(getPendingCount(), 1);
  let batch = peekBatch();
  assert.equal(batch[0].entityId, taskId);
  assert.equal(batch[0].action, 'upsert');
  assert.equal(batch[0].rev, 1);
  assert.equal(batch[0].payload.text, 'یادگیری معماری');

  // 2. Update task -> coalesces into latest rev (rev 2)
  const updateRes = updateTask(taskId, { text: 'یادگیری معماری نرم‌افزار', p: 'low' });
  assert.equal(updateRes.ok, true);
  assert.equal(getPendingCount(), 1); // coalesced!

  batch = peekBatch();
  assert.equal(batch[0].rev, 2);
  assert.equal(batch[0].payload.text, 'یادگیری معماری نرم‌افزار');
  assert.equal(batch[0].payload.p, 'low');

  // 3. Toggle task done -> coalesces into rev 3
  toggleTaskDone(taskId, true);
  assert.equal(getPendingCount(), 1);
  batch = peekBatch();
  assert.equal(batch[0].rev, 3);
  assert.equal(batch[0].payload.done, true);

  // 4. Soft delete task -> coalesces into delete action (rev 4)
  softDeleteTask(taskId);
  assert.equal(getPendingCount(), 1);
  batch = peekBatch();
  assert.equal(batch[0].action, 'delete');
  assert.equal(batch[0].rev, 4);
  assert.ok(batch[0].payload.deletedAt > 0);

  // 5. Restore task -> coalesces into upsert action (rev 5)
  restoreTask(taskId);
  assert.equal(getPendingCount(), 1);
  batch = peekBatch();
  assert.equal(batch[0].action, 'upsert');
  assert.equal(batch[0].rev, 5);
  assert.equal(batch[0].payload.deletedAt, null);
});

test('TaskRepo + Outbox: guest mode generates zero outbox entries', () => {
  setupStorage();
  setSyncEnabled(false);

  const res = createTask({ text: 'کار کاربر مهمان' });
  assert.equal(res.ok, true);
  const taskId = res.record.id;

  updateTask(taskId, { text: 'ویرایش کاربر مهمان' });
  softDeleteTask(taskId);
  restoreTask(taskId);

  assert.equal(getPendingCount(), 0);
  assert.deepEqual(peekBatch(), []);
});

test('TaskRepo + Outbox: hydrateTasks does NOT enqueue changes into outbox', () => {
  setupStorage();
  setSyncEnabled(true);

  const rawTasks = [
    { id: 'h-1', text: 'وظیفه یک از پشتیبان', done: false, version: 1, updatedAt: 1000 },
    { id: 'h-2', text: 'وظیفه دو از پشتیبان', done: true, version: 2, updatedAt: 2000 },
  ];

  hydrateTasks(rawTasks);
  assert.equal(state.tasks.length, 2);
  // Zero outbox operations
  assert.equal(getPendingCount(), 0);
});
