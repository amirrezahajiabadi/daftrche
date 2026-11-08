/* ═══ Phase 3: Stats Memoization, Indexing & Lazy Tab Evaluation Tests ═══ */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ls } from './_env.mjs';

const { state } = await import('../js/state.js');
const { dayKey, shiftKey } = await import('../js/utils.js');
const {
  getDayBucket, getAllDayBuckets, getDayCacheVersion, invalidateDayCache, invalidateAllBuckets,
} = await import('../js/daycache.js');
const { computeStats } = await import('../js/stats.js');
const { collectTotals } = await import('../js/ledger.js');

const TODAY = new Date();
const TODAY_STR = dayKey(TODAY);
const YESTERDAY_STR = shiftKey(TODAY_STR, -1);
const TWO_DAYS_AGO_STR = shiftKey(TODAY_STR, -2);

beforeEach(() => {
  ls.clear();
  invalidateAllBuckets();
  state.tasks.length = 0;
  state.history.length = 0;
  for (const k of Object.keys(state.moods)) delete state.moods[k];
});

test('DayCache groups tasks by date key and preserves historical immutability', () => {
  const tsYesterday = new Date(YESTERDAY_STR + 'T12:00:00').getTime();
  const tsToday = new Date(TODAY_STR + 'T10:00:00').getTime();

  state.tasks.push(
    { id: 't1', text: 'کار دیروز', done: true, doneAt: tsYesterday, cat: 'work', dueDate: YESTERDAY_STR },
    { id: 't2', text: 'کار امروز', done: true, doneAt: tsToday, cat: 'study', dueDate: TODAY_STR },
    { id: 't3', text: 'کار ناتمام', done: false, created: tsToday, cat: 'work' },
  );

  const bucketYesterday = getDayBucket(YESTERDAY_STR, TODAY);
  assert.equal(bucketYesterday.done, 1);
  assert.equal(bucketYesterday.dated, 1);
  assert.equal(bucketYesterday.onTime, 1);
  assert.equal(bucketYesterday.cats.work, 1);

  const bucketToday = getDayBucket(TODAY_STR, TODAY);
  assert.equal(bucketToday.done, 1);
  assert.equal(bucketToday.created, 1);
  assert.equal(bucketToday.cats.study, 1);

  const v1 = getDayCacheVersion(TODAY);

  // Add another task today
  state.tasks.push({ id: 't4', text: 'کار دوم امروز', done: true, doneAt: tsToday + 1000, cat: 'study' });
  invalidateDayCache(TODAY_STR);

  const bucketTodayUpdated = getDayBucket(TODAY_STR, TODAY);
  assert.equal(bucketTodayUpdated.done, 2);
  assert.equal(bucketTodayUpdated.cats.study, 2);

  // Historical day was not re-read or mutated
  const bucketYesterdayAfter = getDayBucket(YESTERDAY_STR, TODAY);
  assert.equal(bucketYesterdayAfter.done, 1);
  assert.ok(getDayCacheVersion(TODAY) > v1);
});

test('computeStats runs in O(days) from daily aggregation cache with memoization', () => {
  const tsTwoDaysAgo = new Date(TWO_DAYS_AGO_STR + 'T09:00:00').getTime();
  const tsYesterday = new Date(YESTERDAY_STR + 'T14:00:00').getTime();
  const tsToday = new Date(TODAY_STR + 'T11:00:00').getTime();

  state.tasks.push(
    { id: 't1', text: 'T1', done: true, doneAt: tsTwoDaysAgo, cat: 'work', dueDate: TWO_DAYS_AGO_STR },
    { id: 't2', text: 'T2', done: true, doneAt: tsYesterday, cat: 'work', dueDate: YESTERDAY_STR },
    { id: 't3', text: 'T3', done: true, doneAt: tsToday, cat: 'study', dueDate: TODAY_STR },
  );

  const stats1 = computeStats('week', TODAY.getTime());
  assert.ok(stats1);
  assert.equal(stats1.headline.done, 3);
  assert.equal(stats1.headline.activeDays, 3);
  assert.equal(stats1.timing.onTime, 3);

  // Subsequent call without state changes returns the exact same memoized object reference
  const stats2 = computeStats('week', TODAY.getTime());
  assert.equal(stats1, stats2, 'computeStats should return memoized model instance');

  // Invalidate and verify new model
  state.tasks.push({ id: 't4', text: 'T4', done: true, doneAt: tsToday + 500, cat: 'work' });
  invalidateDayCache(TODAY_STR);

  const stats3 = computeStats('week', TODAY.getTime());
  assert.notEqual(stats1, stats3, 'computeStats should recompute after invalidation');
  assert.equal(stats3.headline.done, 4);
});

test('collectTotals computes 100% accurate streak and totals from cached day buckets', () => {
  const tsYesterday = new Date(YESTERDAY_STR + 'T12:00:00').getTime();
  const tsToday = new Date(TODAY_STR + 'T06:00:00').getTime(); // early morning before 07:00

  state.tasks.push(
    { id: 't1', text: 'کار ۱', done: true, doneAt: tsYesterday, cat: 'life', dueDate: YESTERDAY_STR },
    { id: 't2', text: 'کار ۲ صبح زود', done: true, doneAt: tsToday, cat: 'life', dueDate: TODAY_STR },
  );
  state.moods[TODAY_STR] = 4;
  state.history.push(TODAY_STR);

  const totals = collectTotals(TODAY);
  assert.equal(totals.totals.done, 2);
  assert.equal(totals.totals.task.morning, 1, 'task finished before 07:00 must count in morning total');
  assert.equal(totals.totals.task.onTime, 2);
  assert.equal(totals.totals.task.dated, 2);
  assert.equal(totals.streak.current, 2, 'streak must be 2 consecutive active days');
  assert.equal(totals.totals.mood.days, 1);
});

