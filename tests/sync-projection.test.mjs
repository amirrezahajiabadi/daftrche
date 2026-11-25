/* ═══ Selective Sync Data Projection & Wire Contract Tests ═══
   Verifies:
     · projectTaskForSync preserves syncable fields and strictly excludes device-local state
     · projectBookProgressForSync projects reading progress and excludes blobs/covers
     · createSyncEnvelope creates valid normalized envelopes
     · validateSyncEnvelope validates correct contracts and rejects malformed inputs
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SYNC_KINDS,
  SYNC_ACTIONS,
  projectTaskForSync,
  projectBookProgressForSync,
  createSyncEnvelope,
  validateSyncEnvelope,
} from '../js/sync-projection.js';

test('SYNC_KINDS and SYNC_ACTIONS: define frozen wire constants', () => {
  assert.deepEqual(SYNC_KINDS, ['task', 'book']);
  assert.deepEqual(SYNC_ACTIONS, ['upsert', 'delete']);
  assert.ok(Object.isFrozen(SYNC_KINDS));
  assert.ok(Object.isFrozen(SYNC_ACTIONS));
});

test('projectTaskForSync: preserves syncable fields and strips notifiedStatus', () => {
  const localTask = {
    id: 't-101',
    text: '  خرید کتاب جدید  ',
    done: true,
    p: 'high',
    cat: 'learning',
    dueDate: '1405-01-15',
    durationMin: 45,
    timeFrom: '10:00',
    timeTo: '11:00',
    created: 1700000000000,
    doneAt: 1700001000000,
    notify: true,
    notifiedStatus: 'overdue', // Device-local transient status
    updatedAt: 1700002000000,
    version: 3,
    rev: 3,
    deletedAt: null,
    extraRandomField: 'ignore me',
  };

  const projected = projectTaskForSync(localTask);
  assert.ok(projected);
  assert.equal(projected.id, 't-101');
  assert.equal(projected.text, 'خرید کتاب جدید');
  assert.equal(projected.done, true);
  assert.equal(projected.p, 'high');
  assert.equal(projected.cat, 'learning');
  assert.equal(projected.dueDate, '1405-01-15');
  assert.equal(projected.durationMin, 45);
  assert.equal(projected.timeFrom, '10:00');
  assert.equal(projected.timeTo, '11:00');
  assert.equal(projected.created, 1700000000000);
  assert.equal(projected.doneAt, 1700001000000);
  assert.equal(projected.notify, true);
  assert.equal(projected.updatedAt, 1700002000000);
  assert.equal(projected.version, 3);
  assert.equal(projected.deletedAt, null);

  // STRICT RULE: notifiedStatus MUST NOT leak into wire projection
  assert.equal('notifiedStatus' in projected, false);
  assert.equal('extraRandomField' in projected, false);
});

test('projectTaskForSync: handles edge cases and default values gracefully', () => {
  assert.equal(projectTaskForSync(null), null);
  assert.equal(projectTaskForSync('not an object'), null);

  const minimalTask = { id: 't-202' };
  const projected = projectTaskForSync(minimalTask);
  assert.ok(projected);
  assert.equal(projected.id, 't-202');
  assert.equal(projected.text, '');
  assert.equal(projected.done, false);
  assert.equal(projected.p, 'mid');
  assert.equal(projected.cat, 'misc');
  assert.equal(projected.dueDate, null);
  assert.equal(projected.durationMin, null);
  assert.equal(projected.timeFrom, null);
  assert.equal(projected.timeTo, null);
  assert.equal(projected.doneAt, null);
  assert.equal(projected.notify, false);
  assert.equal(projected.version, 1);
  assert.equal(projected.deletedAt, null);
  assert.ok(projected.created > 0);
  assert.ok(projected.updatedAt > 0);
});

test('projectBookProgressForSync: extracts reading progress and strictly excludes blobs/covers', () => {
  const localBook = {
    id: 'book-99',
    title: '  اصول طراحی نرم‌افزار  ',
    currentPage: 42,
    totalPages: 320,
    dailyGoal: 15,
    pdfBlob: new Uint8Array([1, 2, 3]), // Binary PDF content
    coverImage: 'data:image/png;base64,iVBORw0KGgo...', // Large base64 thumbnail
    lastReadAt: 1710000000000,
    updatedAt: 1710000000000,
    deletedAt: null,
  };

  const projected = projectBookProgressForSync(localBook);
  assert.ok(projected);
  assert.equal(projected.id, 'book-99');
  assert.equal(projected.title, 'اصول طراحی نرم‌افزار');
  assert.equal(projected.currentPage, 42);
  assert.equal(projected.totalPages, 320);
  assert.equal(projected.dailyGoal, 15);
  assert.equal(projected.updatedAt, 1710000000000);
  assert.equal(projected.deletedAt, null);

  // STRICT RULE: Binary or large blob data MUST NOT leak into wire projection
  assert.equal('pdfBlob' in projected, false);
  assert.equal('coverImage' in projected, false);
});

test('projectBookProgressForSync: handles alternate field names and goal object', () => {
  const altBook = {
    id: 'b-55',
    lastPage: 12,
    numPages: 100,
    goal: { pagesPerDay: 8 },
  };

  const projected = projectBookProgressForSync(altBook);
  assert.ok(projected);
  assert.equal(projected.currentPage, 12);
  assert.equal(projected.totalPages, 100);
  assert.equal(projected.dailyGoal, 8);

  assert.equal(projectBookProgressForSync(null), null);
});

test('createSyncEnvelope: generates valid normalized envelopes', () => {
  const payload = { id: 'task-1', text: 'کاری برای همگام‌سازی' };
  const env = createSyncEnvelope({
    kind: 'task',
    entityId: 'task-1',
    action: 'upsert',
    rev: 2,
    payload,
  });

  assert.ok(env);
  assert.ok(typeof env.opId === 'string' && env.opId.length > 5);
  assert.equal(env.kind, 'task');
  assert.equal(env.entityId, 'task-1');
  assert.equal(env.action, 'upsert');
  assert.equal(env.rev, 2);
  assert.ok(Number.isFinite(env.ts) && env.ts > 0);
  assert.deepEqual(env.payload, payload);

  const delEnv = createSyncEnvelope({
    kind: 'task',
    entityId: 'task-1',
    action: 'delete',
    rev: 3,
    payload: { id: 'task-1', deletedAt: 1710000000 },
  });
  assert.equal(delEnv.action, 'delete');
});

test('validateSyncEnvelope: verifies wire contract and rejects malformed inputs', () => {
  const validTask = {
    opId: 'op-12345',
    kind: 'task',
    entityId: 't-1',
    action: 'upsert',
    rev: 1,
    ts: 1700000000000,
    payload: { id: 't-1', text: 'سلام' },
  };

  assert.deepEqual(validateSyncEnvelope(validTask), { valid: true });

  // Non-object
  assert.equal(validateSyncEnvelope(null).valid, false);
  assert.equal(validateSyncEnvelope([]).valid, false);

  // Missing or empty opId
  assert.equal(validateSyncEnvelope({ ...validTask, opId: '' }).valid, false);
  assert.equal(validateSyncEnvelope({ ...validTask, opId: null }).valid, false);

  // Invalid kind
  assert.equal(validateSyncEnvelope({ ...validTask, kind: 'unknown' }).valid, false);
  assert.equal(validateSyncEnvelope({ ...validTask, kind: 'note' }).valid, false);

  // Missing entityId
  assert.equal(validateSyncEnvelope({ ...validTask, entityId: '' }).valid, false);

  // Invalid action
  assert.equal(validateSyncEnvelope({ ...validTask, action: 'patch' }).valid, false);

  // Invalid rev
  assert.equal(validateSyncEnvelope({ ...validTask, rev: 0 }).valid, false);
  assert.equal(validateSyncEnvelope({ ...validTask, rev: -2 }).valid, false);
  assert.equal(validateSyncEnvelope({ ...validTask, rev: 'two' }).valid, false);

  // Invalid ts
  assert.equal(validateSyncEnvelope({ ...validTask, ts: 0 }).valid, false);

  // Invalid payload
  assert.equal(validateSyncEnvelope({ ...validTask, payload: null }).valid, false);
  assert.equal(validateSyncEnvelope({ ...validTask, payload: [1, 2] }).valid, false);

  // Mismatched payload.id and entityId
  assert.equal(validateSyncEnvelope({ ...validTask, payload: { id: 'different-id' } }).valid, false);
});
