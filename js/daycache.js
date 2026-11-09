/* ═══ Incremental Daily Aggregation Cache (DayCache) ═══
   Maintains an in-memory indexed cache of completed tasks, created tasks,
   focus minutes, reading stats, and moods grouped by date key (YYYY-MM-DD).

   - Historical days (< today) are immutable during normal usage and computed once.
   - Today's bucket is recomputed incrementally on user actions (0ms UI latency).
   - Analytical queries (Stats 7d..1y, Weekly, Badges, Ledger) aggregate in O(days)
     rather than scanning thousands of raw records in O(N).
*/

import { state } from './state.js';
import { dayKey } from './utils.js';
import { getHistory } from './focushistory.js';
import { getBooks, bookComplete } from './library.js';
import { readJSON } from './store.js';
import { STORAGE_KEYS } from './constants.js';
import { subscribe } from './bus.js';

let historicalBuckets = new Map();
let todayBucket = null;
let cachedTodayKey = '';
let cacheVersion = 1;

let isHistoricalDirty = true;
let isTodayDirty = true;

// State tracking for tests or direct state modifications
let trackedTasksLen = -1;
let trackedHistoryLen = -1;
let trackedMoodsLen = -1;
let trackedTasksDoneCount = -1;
let trackedOpenedLen = -1;
let trackedBooksFp = '';

const validTs = t => Number.isFinite(t) && t > 0;
const pos = n => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0);
const isKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);

function getLedgerDays() {
  const raw = readJSON(STORAGE_KEYS.ledger, null);
  if (!raw || typeof raw !== 'object' || !raw.days || typeof raw.days !== 'object') {
    return {};
  }
  return raw.days;
}

export function createEmptyBucket(key) {
  return {
    key,
    done: 0,
    created: 0,
    dated: 0,
    onTime: 0,
    late: 0,
    morning: 0,
    cats: {},        // { [catKey]: count }
    focusMin: 0,
    sessions: 0,
    focusHard: 0,
    focusDawn: 0,
    readMin: 0,
    pages: 0,
    marks: 0,
    mood: 0,
    opened: 0,
  };
}

function checkDirectStateChanges(now) {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  let doneCount = 0;
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i]?.done) doneCount++;
  }
  const historyLen = getHistory().length;
  const moodsLen = state.moods && typeof state.moods === 'object' ? Object.keys(state.moods).length : 0;
  const openedLen = Array.isArray(state.history) ? state.history.length : 0;
  const books = getBooks();
  let booksFp = books.length + ':';
  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    if (!b) continue;
    booksFp += (b.id || '') + ((b.highlights?.length || 0) + (b.notes?.length || 0)) + ':';
    for (const [k, s] of Object.entries(b.stats || {})) {
      booksFp += k + (s?.minutes || 0) + (s?.pages || 0) + ',';
    }
  }

  if (tasks.length !== trackedTasksLen ||
      doneCount !== trackedTasksDoneCount ||
      historyLen !== trackedHistoryLen ||
      moodsLen !== trackedMoodsLen ||
      openedLen !== trackedOpenedLen ||
      booksFp !== trackedBooksFp) {
    isHistoricalDirty = true;
    isTodayDirty = true;
    historicalBuckets.clear();
    trackedTasksLen = tasks.length;
    trackedTasksDoneCount = doneCount;
    trackedHistoryLen = historyLen;
    trackedMoodsLen = moodsLen;
    trackedOpenedLen = openedLen;
    trackedBooksFp = booksFp;
    cacheVersion++;
  }
}

function populateBucketFromTask(b, t, isDoneRecord) {
  if (isDoneRecord && t.done) {
    b.done++;
    const cat = typeof t.cat === 'string' && t.cat ? t.cat : 'misc';
    b.cats[cat] = (b.cats[cat] || 0) + 1;
    if (isKey(t.dueDate)) {
      b.dated++;
      if (b.key <= t.dueDate) b.onTime++;
      else b.late++;
    }
    const ts = Number(t.doneAt);
    if (validTs(ts) && new Date(ts).getHours() < 7) {
      b.morning++;
    }
  }
}

function buildHistoricalIndex(todayKeyStr) {
  historicalBuckets.clear();
  const tasks = (Array.isArray(state.tasks) ? state.tasks : []).filter(t => t && typeof t === 'object');

  const getOrMake = key => {
    if (!isKey(key)) return null;
    if (key === todayKeyStr) return null; // Today is handled in todayBucket
    let b = historicalBuckets.get(key);
    if (!b) {
      b = createEmptyBucket(key);
      historicalBuckets.set(key, b);
    }
    return b;
  };

  // 1. Tasks: created & done
  for (const t of tasks) {
    const cTs = Number(t.created);
    if (validTs(cTs)) {
      const cKey = dayKey(new Date(cTs));
      const b = getOrMake(cKey);
      if (b) b.created++;
    }
    if (t.done) {
      const dTs = Number(t.doneAt);
      if (validTs(dTs)) {
        const dKey = dayKey(new Date(dTs));
        const b = getOrMake(dKey);
        if (b) populateBucketFromTask(b, t, true);
      }
    }
  }

  // 2. Focus history
  const sessions = getHistory();
  for (const s of sessions) {
    const sTs = Number(s.startedAt);
    if (!validTs(sTs)) continue;
    const sDate = new Date(sTs);
    const sKey = dayKey(sDate);
    const b = getOrMake(sKey);
    if (!b) continue;
    const min = pos(s.actualDurationMin);
    b.sessions++;
    b.focusMin += min;
    if (s.rating === 'hard' && s.taskCompleted) b.focusHard++;
    if (sDate.getHours() < 4) b.focusDawn++;
  }

  // 3. Books: stats & highlights & notes
  const books = getBooks();
  for (const b of books) {
    for (const [k, s] of Object.entries(b.stats && typeof b.stats === 'object' ? b.stats : {})) {
      if (!s || typeof s !== 'object') continue;
      const bucket = getOrMake(k);
      if (bucket) {
        bucket.readMin += pos(s.minutes);
        bucket.pages += pos(s.pages);
      }
    }
    for (const list of [b.highlights, b.notes]) {
      for (const m of (list || [])) {
        const ts = Number(m && m.createdAt);
        if (!validTs(ts)) continue;
        const bucket = getOrMake(dayKey(new Date(ts)));
        if (bucket) bucket.marks++;
      }
    }
  }

  // 4. Moods
  const moods = state.moods && typeof state.moods === 'object' ? state.moods : {};
  for (const [k, v] of Object.entries(moods)) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 5) {
      const b = getOrMake(k);
      if (b) b.mood = n;
    }
  }

  // 5. App opened history
  for (const k of (Array.isArray(state.history) ? state.history : [])) {
    const b = getOrMake(k);
    if (b) b.opened = 1;
  }

  // 6. Ledger floors
  const ledgerDays = getLedgerDays();
  for (const [k, v] of Object.entries(ledgerDays)) {
    const b = getOrMake(k);
    if (b && v && typeof v === 'object') {
      b.done = Math.max(b.done, pos(v.done));
      b.sessions = Math.max(b.sessions, pos(v.sessions));
      b.focusMin = Math.max(b.focusMin, pos(v.focusMin));
    }
  }

  isHistoricalDirty = false;
}

function recomputeTodayBucket(todayKeyStr) {
  const b = createEmptyBucket(todayKeyStr);
  const tasks = (Array.isArray(state.tasks) ? state.tasks : []).filter(t => t && typeof t === 'object');

  // Tasks today
  for (const t of tasks) {
    const cTs = Number(t.created);
    if (validTs(cTs) && dayKey(new Date(cTs)) === todayKeyStr) {
      b.created++;
    }
    if (t.done) {
      const dTs = Number(t.doneAt);
      if (validTs(dTs) && dayKey(new Date(dTs)) === todayKeyStr) {
        populateBucketFromTask(b, t, true);
      }
    }
  }

  // Focus today
  const sessions = getHistory();
  for (const s of sessions) {
    const sTs = Number(s.startedAt);
    if (!validTs(sTs)) continue;
    const sDate = new Date(sTs);
    if (dayKey(sDate) === todayKeyStr) {
      const min = pos(s.actualDurationMin);
      b.sessions++;
      b.focusMin += min;
      if (s.rating === 'hard' && s.taskCompleted) b.focusHard++;
      if (sDate.getHours() < 4) b.focusDawn++;
    }
  }

  // Books today
  const books = getBooks();
  for (const book of books) {
    const s = book.stats && typeof book.stats === 'object' ? book.stats[todayKeyStr] : null;
    if (s && typeof s === 'object') {
      b.readMin += pos(s.minutes);
      b.pages += pos(s.pages);
    }
    for (const list of [book.highlights, book.notes]) {
      for (const m of (list || [])) {
        const ts = Number(m && m.createdAt);
        if (validTs(ts) && dayKey(new Date(ts)) === todayKeyStr) {
          b.marks++;
        }
      }
    }
  }

  // Mood today
  if (state.moods && typeof state.moods === 'object') {
    const n = Number(state.moods[todayKeyStr]);
    if (Number.isInteger(n) && n >= 1 && n <= 5) b.mood = n;
  }

  // Opened today
  if (Array.isArray(state.history) && state.history.includes(todayKeyStr)) {
    b.opened = 1;
  }

  // Ledger floors today
  const ledgerDays = getLedgerDays();
  const v = ledgerDays[todayKeyStr];
  if (v && typeof v === 'object') {
    b.done = Math.max(b.done, pos(v.done));
    b.sessions = Math.max(b.sessions, pos(v.sessions));
    b.focusMin = Math.max(b.focusMin, pos(v.focusMin));
  }

  todayBucket = b;
  isTodayDirty = false;
  cacheVersion++;
}

export function ensureCache(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const todayStr = dayKey(d);

  checkDirectStateChanges(d);

  // If calendar day changed (midnight rollover), move old today into historical
  if (todayStr !== cachedTodayKey) {
    if (cachedTodayKey && todayBucket) {
      historicalBuckets.set(cachedTodayKey, todayBucket);
    }
    cachedTodayKey = todayStr;
    isTodayDirty = true;
  }

  if (isHistoricalDirty) {
    buildHistoricalIndex(todayStr);
  }

  if (isTodayDirty || !todayBucket) {
    recomputeTodayBucket(todayStr);
  }
}

export function invalidateDayCache(key) {
  if (!key) {
    isTodayDirty = true;
    isHistoricalDirty = true;
  } else if (key === cachedTodayKey) {
    isTodayDirty = true;
  } else {
    isHistoricalDirty = true;
  }
  cacheVersion++;
}

export function invalidateAllBuckets() {
  isHistoricalDirty = true;
  isTodayDirty = true;
  historicalBuckets.clear();
  todayBucket = null;
  cacheVersion++;
}

export function getDayBucket(key, now = new Date()) {
  ensureCache(now);
  if (key === cachedTodayKey) return todayBucket || createEmptyBucket(key);
  return historicalBuckets.get(key) || createEmptyBucket(key);
}

export function getAllDayBuckets(now = new Date()) {
  ensureCache(now);
  const out = new Map(historicalBuckets);
  if (todayBucket) out.set(cachedTodayKey, todayBucket);
  return out;
}

export function getDayCacheVersion(now = new Date()) {
  ensureCache(now);
  return cacheVersion;
}

// Global subscription to bus notify: keep today's bucket fresh
subscribe(() => {
  invalidateDayCache();
});

// Test hook
if (typeof globalThis !== 'undefined') {
  globalThis.__DAFTARCHE_INVALIDATE_DAYCACHE__ = invalidateAllBuckets;
}
