/* ═══ Calendar & Planner Sync Enhancements Tests ═══
   Verifies:
   1. Active week highlighting (.pcal-row.has-sel / :has(.pcal-cell.sel))
   2. Desktop 2-column layout (month occasions in col 1 under calendar, day panel in col 2)
   3. Move undo toast markup, close buttons, and translations
   4. Task editing capabilities (applyEdits with time span support)
   5. Hour label generator and logical CSS properties
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './_env.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('calendar CSS: active week row has subtle highlight styles', () => {
  const css = read('css/calendar.css');
  assert.ok(css.includes('.pcal-row.has-sel'), 'has .pcal-row.has-sel selector');
  assert.ok(css.includes(':has(.pcal-cell.sel)'), 'has :has(.pcal-cell.sel) modern selector');
  assert.match(css, /\.pcal-row\.has-sel[^}]*background\s*:\s*color-mix/);
});

test('desktop layout: occasions list sits in column 1 under the calendar, which does not follow the scroll', () => {
  const css = read('css/calendar.css');
  const desktopBlock = css.slice(css.indexOf('@media (min-width:1024px)'));
  assert.ok(desktopBlock.includes('.cal-main{grid-column:1;grid-row:1;min-width:0}'), 'cal-main in col 1 row 1');
  /* The month used to be sticky; it is a page now, so it stays where it is put. */
  assert.ok(!desktopBlock.includes('position:sticky'), 'the calendar must not follow the scroll');
  assert.ok(desktopBlock.includes('.pcal-day{grid-column:2;grid-row:1 / span 2}'), 'pcal-day in col 2 spanning 2 rows');
  assert.ok(desktopBlock.includes('#calMonthList{grid-column:1;grid-row:2}'), 'calMonthList in col 1 row 2 under calendar');
});

test('index.html: moveToast exists with required toast semantics', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="moveToast"'), 'moveToast element exists');
  assert.ok(html.includes('id="moveUndoBtn"'), 'moveUndoBtn button exists');
  assert.ok(html.includes('id="moveToastText"'), 'moveToastText span exists');
  assert.match(html, /<div class="toast"[^>]*id="moveToast"[^>]*role="status"[^>]*hidden>/);
});

test('index.html & css: task edit form includes time span selector', () => {
  const html = read('index.html');
  assert.ok(html.includes('id="teTime"'), 'teTime radio group exists');
  assert.ok(html.includes('id="teTimeCustom"'), 'teTimeCustom section exists');
  assert.ok(html.includes('id="teTimeFrom"'), 'teTimeFrom select exists');
  assert.ok(html.includes('id="teTimeTo"'), 'teTimeTo select exists');
  assert.ok(html.includes('id="teTimeError"'), 'teTimeError indicator exists');

  const css = read('css/tasks.css');
  assert.ok(css.includes('.te-time-custom[hidden]{display:none}'), 'te-time-custom[hidden] is protected');
  assert.ok(css.includes('margin-block-start:2px'), 'uses logical margin-block-start');
});

test('taskedit.js hourLabel formats various day hours correctly', async () => {
  const { hourLabel } = await import('../js/taskedit.js');
  assert.equal(hourLabel(0), '۱۲ شب');
  assert.equal(hourLabel(9 * 60), '۹ صبح');
  assert.equal(hourLabel(12 * 60), '۱۲ ظهر');
  assert.equal(hourLabel(14 * 60), '۲ بعدازظهر');
  assert.equal(hourLabel(18 * 60), '۶ عصر');
  assert.equal(hourLabel(21 * 60), '۹ شب');
});

test('tasks.js applyEdits: updates text, priority, category, due date, duration, and time span', async () => {
  const { applyEdits } = await import('../js/tasks.js');
  const { state } = await import('../js/state.js');

  const task = {
    id: 'test-edit-1',
    text: 'کار اولیه',
    p: 'low',
    cat: 'misc',
    dueDate: '2026-11-12',
    durationMin: null,
    timeFrom: null,
    timeTo: null,
    done: false,
  };
  state.tasks.push(task);

  applyEdits(task, {
    text: 'کار ویرایش‌شده',
    p: 'high',
    cat: 'project',
    dueDate: '2026-11-13',
    durationMin: 45,
    timeFrom: 14 * 60,
    timeTo: 16 * 60,
  });

  assert.equal(task.text, 'کار ویرایش‌شده');
  assert.equal(task.p, 'high');
  assert.equal(task.cat, 'project');
  assert.equal(task.dueDate, '2026-11-13');
  assert.equal(task.durationMin, 45);
  assert.equal(task.timeFrom, 14 * 60);
  assert.equal(task.timeTo, 16 * 60);

  // Invalid span (end before start) must result in null timeFrom/timeTo
  applyEdits(task, {
    text: 'کار بدون بازه معتبر',
    timeFrom: 16 * 60,
    timeTo: 14 * 60,
  });
  assert.equal(task.timeFrom, null);
  assert.equal(task.timeTo, null);

  // Clean up
  state.tasks = state.tasks.filter(t => t.id !== 'test-edit-1');
});

test('tasks.js moveTaskToDay moves task and returns false for unknown task', async () => {
  const { moveTaskToDay } = await import('../js/tasks.js');
  const { state } = await import('../js/state.js');

  const task = {
    id: 'test-move-1',
    text: 'تسک جابه‌جایی',
    dueDate: '2026-11-12',
    done: false,
  };
  state.tasks.push(task);

  const moved = moveTaskToDay('test-move-1', '2026-11-15');
  assert.equal(moved, true);
  assert.equal(task.dueDate, '2026-11-15');

  const unhandled = moveTaskToDay('non-existent-task-id', '2026-11-16');
  assert.equal(unhandled, false);

  // Clean up
  state.tasks = state.tasks.filter(t => t.id !== 'test-move-1');
});
