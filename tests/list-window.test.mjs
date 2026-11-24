/* ═══ Unit Tests for List Windowing & Progressive Rendering (js/list-window.js) ═══ */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_BATCH_SIZE,
  MIN_BATCH_SIZE,
  MAX_BATCH_SIZE,
  clampBatchSize,
  computeWindowSlice,
  getNextBatchRange,
  getNextBatchSlice,
  canAppendMore,
  createListWindowState,
} from '../js/list-window.js';

test('clampBatchSize: enforces bounds and falls back safely', () => {
  assert.equal(clampBatchSize(50), 50);
  assert.equal(clampBatchSize(5, 10, 100, 50), 10, 'Clamps below min');
  assert.equal(clampBatchSize(500, 10, 100, 50), 100, 'Clamps above max');
  assert.equal(clampBatchSize('35'), 35, 'Parses numeric string');
  assert.equal(clampBatchSize(NaN), DEFAULT_BATCH_SIZE, 'Fallback on NaN');
  assert.equal(clampBatchSize(null), DEFAULT_BATCH_SIZE, 'Fallback on null');
  assert.equal(clampBatchSize(-10), DEFAULT_BATCH_SIZE, 'Fallback on negative');
});

test('computeWindowSlice: initial slice and window calculation', () => {
  const items = Array.from({ length: 120 }, (_, i) => ({ id: `task-${i + 1}`, text: `Task ${i + 1}` }));

  // Initial render with default batch size (50)
  const initial = computeWindowSlice(items, 0, 50);
  assert.equal(initial.slice.length, 50);
  assert.equal(initial.startIndex, 0);
  assert.equal(initial.endIndex, 50);
  assert.equal(initial.renderedCount, 50);
  assert.equal(initial.totalCount, 120);
  assert.equal(initial.hasMore, true);
  assert.equal(initial.remainingCount, 70);
  assert.equal(initial.nextBatchSize, 50);

  // Subsequent render with renderedCount = 100
  const mid = computeWindowSlice(items, 100, 50);
  assert.equal(mid.slice.length, 100);
  assert.equal(mid.endIndex, 100);
  assert.equal(mid.hasMore, true);
  assert.equal(mid.remainingCount, 20);
  assert.equal(mid.nextBatchSize, 20, 'Next batch size is capped to remaining');

  // Fully rendered with renderedCount >= total
  const full = computeWindowSlice(items, 120, 50);
  assert.equal(full.slice.length, 120);
  assert.equal(full.hasMore, false);
  assert.equal(full.remainingCount, 0);
  assert.equal(full.nextBatchSize, 0);

  // Beyond total clamps to total
  const beyond = computeWindowSlice(items, 200, 50);
  assert.equal(beyond.slice.length, 120);
  assert.equal(beyond.renderedCount, 120);
  assert.equal(beyond.hasMore, false);
});

test('computeWindowSlice: handles empty lists and non-array inputs gracefully', () => {
  const empty = computeWindowSlice([], 0, 50);
  assert.deepEqual(empty.slice, []);
  assert.equal(empty.renderedCount, 0);
  assert.equal(empty.totalCount, 0);
  assert.equal(empty.hasMore, false);
  assert.equal(empty.remainingCount, 0);

  const nonArray = computeWindowSlice(null, 10, 50);
  assert.deepEqual(nonArray.slice, []);
  assert.equal(nonArray.totalCount, 0);
  assert.equal(nonArray.hasMore, false);
});

test('getNextBatchRange & getNextBatchSlice: incremental chunks extraction', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

  // Chunk 1: rendered 0, batch 3 -> ['a', 'b', 'c']
  const r1 = getNextBatchRange(0, items.length, 3);
  assert.equal(r1.startIndex, 0);
  assert.equal(r1.endIndex, 3);
  assert.equal(r1.size, 3);
  assert.equal(r1.hasMoreAfter, true);
  assert.deepEqual(getNextBatchSlice(items, 0, 3), ['a', 'b', 'c']);

  // Chunk 2: rendered 3, batch 3 -> ['d', 'e', 'f']
  const r2 = getNextBatchRange(3, items.length, 3);
  assert.equal(r2.startIndex, 3);
  assert.equal(r2.endIndex, 6);
  assert.equal(r2.size, 3);
  assert.equal(r2.hasMoreAfter, true);
  assert.deepEqual(getNextBatchSlice(items, 3, 3), ['d', 'e', 'f']);

  // Chunk 3: rendered 6, batch 3 -> ['g'] (only 1 remaining)
  const r3 = getNextBatchRange(6, items.length, 3);
  assert.equal(r3.startIndex, 6);
  assert.equal(r3.endIndex, 7);
  assert.equal(r3.size, 1);
  assert.equal(r3.hasMoreAfter, false);
  assert.deepEqual(getNextBatchSlice(items, 6, 3), ['g']);

  // Beyond end: rendered 7, batch 3 -> empty
  const rEnd = getNextBatchRange(7, items.length, 3);
  assert.equal(rEnd.size, 0);
  assert.equal(rEnd.hasMoreAfter, false);
  assert.deepEqual(getNextBatchSlice(items, 7, 3), []);
});

test('canAppendMore: determines pagination state accurately', () => {
  assert.equal(canAppendMore(0, 10), true);
  assert.equal(canAppendMore(5, 10), true);
  assert.equal(canAppendMore(10, 10), false);
  assert.equal(canAppendMore(15, 10), false);
  assert.equal(canAppendMore(0, 0), false);
  assert.equal(canAppendMore(null, 10), true);
});

test('createListWindowState: encapsulates progressive expansion and filter reset', () => {
  const windowState = createListWindowState({ initialBatchSize: 20, batchSize: 20 });
  const items = Array.from({ length: 55 }, (_, i) => i);

  assert.equal(windowState.getRenderedCount(), 20);
  assert.equal(windowState.getVisibleSlice(items).length, 20);
  assert.equal(windowState.hasMore(items), true);
  assert.equal(windowState.remaining(items), 35);

  // First expansion -> 40 items
  const exp1 = windowState.expand(items);
  assert.equal(exp1.newCount, 40);
  assert.equal(exp1.hasMore, true);
  assert.equal(windowState.getVisibleSlice(items).length, 40);

  // Second expansion -> 55 items (end reached)
  const exp2 = windowState.expand(items);
  assert.equal(exp2.newCount, 55);
  assert.equal(exp2.hasMore, false);
  assert.equal(windowState.remaining(items), 0);
  assert.equal(windowState.getVisibleSlice(items).length, 55);

  // Filter or search changed -> reset restores initial batch
  windowState.reset();
  assert.equal(windowState.getRenderedCount(), 20);
  assert.equal(windowState.getVisibleSlice(items).length, 20);
  assert.equal(windowState.hasMore(items), true);
});
