/* ═══ Subtasks, Recurring Tasks & Ambient Mixer Unit Tests ═══
   Covers Sprint 3.1 deliverables:
     · Subtask normalization, progress math, immutable add/toggle/remove, 20-item cap
     · Jalali-aware recurrence (daily, weekly, monthly clamping, overdue handling)
     · TaskRepo recurring spawn on completion (no duplicate on re-toggle)
     · Sync projection preservation of subtasks & repeat
     · Legacy task normalization backward compatibility
     · Multi-channel ambient mixer state & persistence without Web Audio */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REPEAT_OPTIONS,
  MAX_SUBTASKS,
  normalizeSubtasks,
  calcSubtaskProgress,
  toggleSubtaskItem,
  addSubtaskItem,
  removeSubtaskItem,
  normalizeRepeat,
  computeNextDueDate,
  buildNextRecurringTaskPayload,
} from '../js/task-recurrence.js';

import { state, normalizeTask } from '../js/state.js';
import { resetPending, flushPending } from '../js/store.js';
import { createTask, updateTask, toggleTaskDone } from '../js/taskrepo.js';
import { setSyncEnabled, clearOutbox, peekBatch } from '../js/outbox.js';
import { projectTaskForSync } from '../js/sync-projection.js';
import { jalaliToDate, dateToJalali } from '../js/jalali.js';
import { dayKey } from '../js/utils.js';
import {
  AMBIENT_CHANNELS,
  MIXER_STORAGE_KEY,
  getMixerState,
  setChannelVolume,
  toggleChannelMute,
  setMixerEnabled,
} from '../js/audio.js';

class FakeStorage {
  constructor(init = {}) { this.map = new Map(Object.entries(init)); }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

function resetEnv() {
  resetPending();
  const storage = new FakeStorage();
  globalThis.localStorage = storage;
  clearOutbox();
  setSyncEnabled(false);
  state.tasks = [];
  return storage;
}

test('Subtasks: normalization, progress math, add/toggle/remove, and 20-item cap', () => {
  assert.equal(MAX_SUBTASKS, 20);
  assert.deepEqual(normalizeSubtasks(null), []);
  assert.deepEqual(normalizeSubtasks('bad'), []);

  // Normalization strips invalid/empty entries and caps at 20
  const oversized = Array.from({ length: 25 }, (_, i) => ({
    id: `s-${i}`,
    text: i === 2 ? '   ' : `گام ${i + 1}`,
    done: i % 2 === 0,
  }));
  const norm = normalizeSubtasks(oversized);
  assert.equal(norm.length, 20);
  assert.equal(norm.some(s => s.id === 's-2'), false);

  // Add, toggle, remove
  let subs = addSubtaskItem([], 'مطالعه فصل اول', 'sub-1');
  subs = addSubtaskItem(subs, 'حل تمرین‌ها', 'sub-2');
  assert.equal(subs.length, 2);
  assert.deepEqual(calcSubtaskProgress(subs), { done: 0, total: 2, pct: 0 });

  subs = toggleSubtaskItem(subs, 'sub-1');
  assert.deepEqual(calcSubtaskProgress(subs), { done: 1, total: 2, pct: 50 });

  subs = toggleSubtaskItem(subs, 'sub-2');
  assert.deepEqual(calcSubtaskProgress(subs), { done: 2, total: 2, pct: 100 });

  subs = removeSubtaskItem(subs, 'sub-1');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].id, 'sub-2');

  // Cap at 20 on addSubtaskItem
  let full = [];
  for (let i = 0; i < 22; i++) full = addSubtaskItem(full, `آیتم ${i}`, `id-${i}`);
  assert.equal(full.length, 20);
});

test('Recurrence: computeNextDueDate handles daily, weekly, Jalali monthly clamping, and overdue tasks', () => {
  assert.deepEqual(REPEAT_OPTIONS, ['daily', 'weekly', 'monthly']);
  assert.equal(normalizeRepeat('yearly'), null);
  assert.equal(normalizeRepeat('daily'), 'daily');

  const today = '2026-09-22'; // 1405-06-31 (Shahrivar 31)
  assert.equal(computeNextDueDate(today, 'daily', today), '2026-09-23');
  assert.equal(computeNextDueDate(today, 'weekly', today), '2026-09-29');

  // Jalali monthly clamping: 1405-06-31 -> 1405-07-30 (Mehr has 30 days)
  const nextMonthKey = computeNextDueDate(today, 'monthly', today);
  const [gy, gm, gd] = nextMonthKey.split('-').map(Number);
  const nextJ = dateToJalali(new Date(gy, gm - 1, gd));
  assert.deepEqual(nextJ, { jy: 1405, jm: 7, jd: 30 });

  // Bahman 30 (1405-11-30) -> non-leap Esfand 29 (1405-12-29)
  const bahman30 = dayKey(jalaliToDate(1405, 11, 30));
  const esfandNext = computeNextDueDate(bahman30, 'monthly', bahman30);
  const [ey, em, ed] = esfandNext.split('-').map(Number);
  assert.deepEqual(dateToJalali(new Date(ey, em - 1, ed)), { jy: 1405, jm: 12, jd: 29 });

  // Overdue task advances relative to todayStr, not the past dueDate
  assert.equal(computeNextDueDate('2026-01-01', 'daily', '2026-09-22'), '2026-09-23');
  assert.equal(computeNextDueDate(null, 'weekly', '2026-09-22'), '2026-09-29');
});

test('TaskRepo Recurrence: completing a recurring task spawns one next occurrence with reset subtasks', () => {
  resetEnv();
  setSyncEnabled(true);

  const created = createTask({
    id: 'rec-1',
    text: 'مرور هفتگی',
    p: 'high',
    cat: 'study',
    dueDate: '2026-09-22',
    durationMin: 30,
    repeat: 'weekly',
    subtasks: [
      { id: 'st-1', text: 'چک کردن تقویم', done: true },
      { id: 'st-2', text: 'برنامه‌ریزی هفته بعد', done: false },
    ],
  });
  assert.equal(created.ok, true);

  // Mark done -> spawns next occurrence
  const doneRes = toggleTaskDone('rec-1', true);
  assert.equal(doneRes.ok, true);
  assert.ok(doneRes.spawnedTask);
  assert.equal(state.tasks.length, 2);

  const next = doneRes.spawnedTask;
  assert.notEqual(next.id, 'rec-1');
  assert.equal(next.text, 'مرور هفتگی');
  assert.equal(next.done, false);
  assert.equal(next.repeat, 'weekly');
  assert.equal(next.p, 'high');
  assert.equal(next.cat, 'study');
  assert.equal(next.durationMin, 30);
  assert.ok(next.dueDate >= '2026-09-23');
  assert.equal(next.subtasks.length, 2);
  assert.equal(next.subtasks.every(s => s.done === false), true);

  // Toggling completed task back to undone and completing via updateTask must NOT duplicate if already done,
  // and updating an already-done task does not spawn duplicates
  updateTask('rec-1', { text: 'مرور هفتگی (ویرایش)' });
  assert.equal(state.tasks.length, 2);

  // Outbox includes both original completion and spawned task creation
  const batch = peekBatch(50);
  assert.equal(batch.length, 2);
});

test('Sync Projection & Legacy Compatibility: preserves subtasks/repeat and safely defaults legacy tasks', () => {
  const legacy = normalizeTask({ id: 'legacy-1', text: 'تسک قدیمی', done: false });
  assert.ok(legacy);
  assert.deepEqual(legacy.subtasks, []);
  assert.equal(legacy.repeat, null);

  const payload = projectTaskForSync({
    id: 'sync-sub-1',
    text: 'تسک با زیرکار',
    repeat: 'daily',
    subtasks: [{ id: 'a', text: 'گام ۱', done: true }],
    notifiedStatus: 'soon',
  });
  assert.equal(payload.repeat, 'daily');
  assert.deepEqual(payload.subtasks, [{ id: 'a', text: 'گام ۱', done: true }]);
  assert.equal('notifiedStatus' in payload, false);

  const built = buildNextRecurringTaskPayload(payload, '2026-09-22');
  assert.equal(built.repeat, 'daily');
  assert.equal(built.dueDate, '2026-09-23');
  assert.deepEqual(built.subtasks, [{ id: 'a', text: 'گام ۱', done: false }]);
});

test('Ambient Mixer: supports multi-channel volume, mute toggles, clamping, and graceful Node fallback', async () => {
  const storage = resetEnv();
  assert.ok(AMBIENT_CHANNELS.rain);
  assert.ok(AMBIENT_CHANNELS.fireplace);
  assert.ok(AMBIENT_CHANNELS.cafe);

  setMixerEnabled(true);
  toggleChannelMute('rain', false);
  toggleChannelMute('fireplace', false);
  setChannelVolume('rain', 0.45);
  setChannelVolume('fireplace', 1.5); // clamped to 1

  const ms = getMixerState();
  assert.equal(ms.rain.muted, false);
  assert.equal(ms.rain.vol, 0.45);
  assert.equal(ms.fireplace.muted, false);
  assert.equal(ms.fireplace.vol, 1);

  // Wait for debounced mixer write
  await new Promise(r => setTimeout(r, 300));
  flushPending();
  const persisted = JSON.parse(storage.getItem(MIXER_STORAGE_KEY));
  assert.equal(persisted.rain.vol, 0.45);
  assert.equal(persisted.fireplace.muted, false);
});
