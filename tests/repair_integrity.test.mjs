/* ═══ Repair & Storage Refactor Integrity Tests ═══
   Verifies all root-cause bug fixes from the /boost audit:
   1. Debounced persistence flush during backup export
   2. Shard migration during backup apply / merge
   3. Complete in-memory state hydration after restore
   4. DayCache invalidation on global notifications and library reading progress
   5. clearDoneTasks handling tasks regardless of active filter tab or scroll chunk
*/

import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ls } from './_env.mjs';

import { state } from '../js/state.js';
import { STORAGE_KEYS } from '../js/constants.js';
import {
  scheduleSave, flushPending, migrateStorage,
} from '../js/store.js';
import {
  collectBackup, parseBackup, applyBackup, mergeBackup,
} from '../js/backup.js';
import {
  getDayBucket, invalidateDayCache, invalidateAllBuckets,
} from '../js/daycache.js';
import { clearDoneTasks } from '../js/tasks.js';
import { reloadBooks } from '../js/library.js';
import { hydrateStateAfterRestore } from '../js/settings.js';

test('backup export: flushPending is called so dirty debounced slices are written before collectBackup', () => {
  ls.clear();
  // Modify tasks in state and schedule debounced save
  state.tasks = [{ id: 'test-1', text: 'کار تستی تست‌پشتیبان', done: false }];
  scheduleSave(STORAGE_KEYS.tasks, state.tasks);

  // Directly checking ls before flushPending would show it's pending (or null in real storage)
  // collectBackup should internally invoke flushPending()
  const backup = collectBackup(ls);
  assert.ok(backup.data[STORAGE_KEYS.tasks], 'Backup must contain tasks even if persistence was debounced');
  const restoredTasks = JSON.parse(backup.data[STORAGE_KEYS.tasks]);
  assert.equal(restoredTasks.length, 1);
  assert.equal(restoredTasks[0].id, 'test-1');
});

test('backup apply & merge: migrateStorage is invoked so legacy monolithic backups shard cleanly', () => {
  ls.clear();
  const legacyBackupObj = {
    app: 'daftarche',
    format: 1,
    exportedAt: new Date().toISOString(),
    data: {
      'daftarche-state': JSON.stringify({
        tasks: [
          { id: 'leg-1', text: 'کار قدیمی ۱', done: true },
          { id: 'leg-2', text: 'کار قدیمی ۲', done: false },
        ],
        userName: 'کاربر قدیمی',
      }),
    },
  };

  const res = applyBackup(ls, legacyBackupObj);
  assert.equal(res.ok, true);
  // After applyBackup, migrateStorage should have migrated 'daftarche-state' into STORAGE_KEYS.tasks
  const shardedTasks = ls.getItem(STORAGE_KEYS.tasks);
  assert.ok(shardedTasks, 'applyBackup must trigger migrateStorage to create sharded tasks');
  const tasksArr = JSON.parse(shardedTasks);
  assert.equal(tasksArr.length, 2);
  assert.equal(tasksArr[0].id, 'leg-1');
});

test('hydrateStateAfterRestore: synchronizes in-memory state slices from storage after backup restore', () => {
  ls.clear();
  const newTasks = [{ id: 'hyd-1', text: 'کار هیدراته شده', done: false }];
  const newBooks = [{ id: 'book-1', title: 'کتاب تست', pages: 100, stats: {} }];
  ls.setItem(STORAGE_KEYS.tasks, JSON.stringify(newTasks));
  ls.setItem('daftarche-books-meta', JSON.stringify(newBooks));
  ls.setItem(STORAGE_KEYS.name, 'نام جدید');

  hydrateStateAfterRestore();

  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].id, 'hyd-1');
  assert.equal(state.userName, 'نام جدید');
});

test('clearDoneTasks: removes all done tasks from state.tasks even if not in the active DOM filter', () => {
  state.tasks = [
    { id: 'cd-1', text: 'کار ناتمام', done: false },
    { id: 'cd-2', text: 'کار انجام‌شده ۱', done: true },
    { id: 'cd-3', text: 'کار انجام‌شده ۲', done: true },
  ];
  state.filter = 'active'; // Filter is set to active (so done tasks might not be visible in DOM)

  clearDoneTasks();

  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].id, 'cd-1');
  assert.equal(state.tasks[0].done, false);
});

test('DayCache invalidation: invalidateDayCache() without arguments invalidates both today and history', () => {
  invalidateAllBuckets();
  const today = new Date();
  state.tasks = [
    { id: 'dc-1', text: 'کار روزانه', done: true, doneAt: Date.now(), dueDate: '2026-11-09' },
  ];

  const bucket1 = getDayBucket('2026-11-09', today);
  assert.equal(bucket1.done, 1);

  // Invalidate globally
  invalidateDayCache();

  // Change task done count
  state.tasks[0].done = false;
  state.tasks[0].doneAt = null;

  const bucket2 = getDayBucket('2026-11-09', today);
  assert.equal(bucket2.done, 0);
});

test('legacy mergeBackup: merges unversioned daftarche-tasks into non-empty device without losing either side', () => {
  ls.clear();
  ls.setItem(STORAGE_KEYS.tasks, JSON.stringify([{ id: 'local-1', text: 'کار فعلی' }]));
  const legacyBackup = {
    app: 'daftarche',
    format: 1,
    exportedAt: new Date().toISOString(),
    data: {
      'daftarche-tasks': JSON.stringify([{ id: 'leg-1', text: 'کار قدیمی از نسخه قبل' }]),
    },
  };
  const res = mergeBackup(ls, legacyBackup);
  assert.equal(res.ok, true);
  const tasks = JSON.parse(ls.getItem(STORAGE_KEYS.tasks));
  assert.equal(tasks.length, 2);
  const ids = tasks.map(t => t.id);
  assert.ok(ids.includes('local-1') && ids.includes('leg-1'), 'Both local and legacy tasks must be preserved');
});

test('migrateStorage: merges partially migrated shards on-disk into sharded storage without dropping records', () => {
  ls.clear();
  ls.setItem(STORAGE_KEYS.tasks, JSON.stringify([{ id: 'cur-1', text: 'کار کنونی' }]));
  ls.setItem('daftarche-tasks', JSON.stringify([{ id: 'old-1', text: 'کار جامانده' }]));
  ls.setItem(STORAGE_KEYS.history, JSON.stringify(['2026-11-08']));
  ls.setItem('daftarche-state', JSON.stringify({
    history: ['2026-11-07'],
    moods: { '2026-11-07': 4 },
  }));

  const migrated = migrateStorage(ls);
  assert.equal(migrated, true);

  const tasks = JSON.parse(ls.getItem(STORAGE_KEYS.tasks));
  assert.equal(tasks.length, 2);
  assert.ok(tasks.some(t => t.id === 'cur-1') && tasks.some(t => t.id === 'old-1'));

  const history = JSON.parse(ls.getItem(STORAGE_KEYS.history));
  assert.equal(history.length, 2);
  assert.ok(history.includes('2026-11-08') && history.includes('2026-11-07'));

  assert.equal(ls.getItem('daftarche-tasks'), null);
  assert.equal(ls.getItem('daftarche-state'), null);
});

test('storage loaders: corrupted or invalid JSON in storage returns safe array/object fallbacks', async () => {
  const { loadHistory, loadMoods, loadFocusHistory, loadTasks } = await import('../js/store.js');
  ls.clear();
  // Malformed type shapes in storage
  ls.setItem(STORAGE_KEYS.tasks, '{"notAnArray":true}');
  ls.setItem(STORAGE_KEYS.history, '{"notAnArray":true}');
  ls.setItem(STORAGE_KEYS.moods, '["notAnObject"]');
  ls.setItem(STORAGE_KEYS.focusHistory, '"notAnArray"');

  assert.equal(loadTasks(), null);
  assert.deepEqual(loadHistory(), []);
  assert.deepEqual(loadMoods(), {});
  assert.deepEqual(loadFocusHistory(), []);
});
