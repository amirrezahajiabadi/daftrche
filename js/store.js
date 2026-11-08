/* ═══ Storage Layer (localStorage for now — Supabase will replace it later) ═══ */

import { STORAGE_KEYS } from './constants.js';

/* ── Guarded writes ──
   localStorage.setItem throws when the quota is full, when storage is disabled
   (some private modes) or when the browser is under pressure. Left unguarded,
   the throw escaped into whatever handler was saving — and the person lost the
   change without ever being told. Every write in the app now goes through
   safeSet: it never throws, it answers true/false, and on failure it announces
   the problem once on `window` (js/storagewarn.js shows it) so the loss is
   visible instead of silent. Reads are guarded separately by readJSON below. */
export const STORAGE_ERROR_EVENT = 'daftarche:storage-error';

function reportStorageError(key, error) {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  try { window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: { key, error } })); }
  catch { /* nothing more can be done */ }
}

export function safeSet(key, value) {
  dirtySlices.delete(key);
  try { localStorage.setItem(key, value); return true; }
  catch (error) { reportStorageError(key, error); return false; }
}

export function safeRemove(key) {
  dirtySlices.delete(key);
  try { localStorage.removeItem(key); return true; }
  catch (error) { reportStorageError(key, error); return false; }
}

/* Asks the browser to keep this origin's storage (localStorage *and* the IndexedDB
   that holds the PDFs) out of the pool it may clear when the device runs short
   on space. Best effort and silent: a browser that has no such call, or that
   declines, simply leaves things as they were. The two doors that put data in —
   adding a task and importing a book — both ask, because a person who only ever
   imports books would otherwise never trigger the request. */
export function requestPersistentStorage() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      return Promise.resolve(navigator.storage.persist()).catch(() => false);
    }
  } catch { /* nothing more can be done */ }
  return Promise.resolve(false);
}

/* ═══ Centralized Persistence Manager & Debounced Idle Writes ═══
   When a user accumulates thousands of tasks, focus logs, and records over months,
   calling JSON.stringify and writing synchronously to localStorage on every user
   interaction freezes the main thread (causing UI lag and dropped frames).

   The persistence manager tracks dirty state slices in-memory so UI interactions
   respond in 0ms, deferring serialization and disk writes to requestIdleCallback
   (with a 300ms fallback timeout for iOS/Safari and Node test environments).

   Guarantees:
   1. 0ms interaction latency: in-memory state is updated immediately.
   2. Zero data loss: visibilitychange (tab background/minimize), pagehide, and
      beforeunload immediately flush any pending saves synchronously.
   3. Immediate in-memory consistency: readJSON/readString check dirty slices first,
      giving callers instantaneous access to the latest unwritten state.
   4. Dirty-slice isolation: updating tasks only serializes the tasks slice,
      leaving focus logs, books, ledger, and settings untouched. */

const dirtySlices = new Map();
let idleHandle = null;
let timeoutHandle = null;
let isFlushing = false;

function scheduleIdleFlush() {
  if (idleHandle !== null || timeoutHandle !== null) return;

  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    idleHandle = window.requestIdleCallback(() => {
      idleHandle = null;
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      flushPending();
    }, { timeout: 1000 });
  }

  // Fallback for Safari/iOS or when idle callback takes too long / Node test harness
  timeoutHandle = setTimeout(() => {
    if (idleHandle !== null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
      try { window.cancelIdleCallback(idleHandle); } catch { /* ignore */ }
      idleHandle = null;
    }
    timeoutHandle = null;
    flushPending();
  }, 300);
}

export function scheduleSave(key, value, serializer) {
  dirtySlices.set(key, { value, serializer });
  scheduleIdleFlush();
  return true;
}

export function isDirty(key) {
  if (key === undefined) return dirtySlices.size > 0;
  return dirtySlices.has(key);
}

export function resetPending() {
  if (idleHandle !== null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
    try { window.cancelIdleCallback(idleHandle); } catch { /* ignore */ }
  }
  idleHandle = null;
  if (timeoutHandle !== null) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
  dirtySlices.clear();
}

export function flushPending() {
  if (isFlushing || dirtySlices.size === 0) return true;
  isFlushing = true;

  if (idleHandle !== null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
    try { window.cancelIdleCallback(idleHandle); } catch { /* ignore */ }
  }
  idleHandle = null;
  if (timeoutHandle !== null) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }

  let allOk = true;
  const entries = Array.from(dirtySlices.entries());
  dirtySlices.clear();

  for (const [key, entry] of entries) {
    const { value, serializer } = entry;
    if (value === null || value === undefined) {
      if (!safeRemove(key)) allOk = false;
      continue;
    }
    let serialized;
    try {
      if (typeof serializer === 'function') {
        serialized = serializer(value);
      } else if (typeof value === 'string') {
        serialized = value;
      } else {
        serialized = JSON.stringify(value);
      }
      if (!safeSet(key, serialized)) {
        allOk = false;
      }
    } catch (error) {
      reportStorageError(key, error);
      allOk = false;
    }
  }

  isFlushing = false;
  return allOk;
}

// Hook lifecycle flush on page background / close / navigate away
if (typeof window !== 'undefined') {
  const onFlushLifecycle = () => flushPending();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPending();
    });
  }
  window.addEventListener('pagehide', onFlushLifecycle);
  window.addEventListener('beforeunload', onFlushLifecycle);
}

// Expose internal reset for test harness isolation
if (typeof globalThis !== 'undefined') {
  globalThis.__DAFTARCHE_RESET_PENDING__ = resetPending;
  globalThis.__DAFTARCHE_CLEAR_DIRTY__ = key => dirtySlices.delete(key);
}

/* The wipe behind «همهٔ داده‌ها» in settings. Guarded like every other
   write, so a browser that refuses storage reports the failure instead of
   throwing out of a click handler with half the action already done. */
export function clearAll() {
  resetPending();
  try { localStorage.clear(); return true; }
  catch (error) { reportStorageError(null, error); return false; }
}

/* Guarded read of one stored value: a corrupt entry falls back instead of
   throwing, so a malformed value can never take an import down at module
   evaluation time. Checks dirty slices first for 0ms in-memory latency. */
export const readJSON = (key, fallback) => {
  if (dirtySlices.has(key)) {
    const entry = dirtySlices.get(key);
    if (entry.value === null || entry.value === undefined) return fallback;
    return entry.value ?? fallback;
  }
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};

/* Guarded read of a raw string. Checks dirty slices first for 0ms in-memory latency. */
export const readString = (key, fallback = '') => {
  if (dirtySlices.has(key)) {
    const entry = dirtySlices.get(key);
    if (entry.value === null || entry.value === undefined) return fallback;
    return String(entry.value);
  }
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch { return fallback; }
};

const read = readJSON;

/* ═══ Transparent Migration: Legacy Formats → Sharded Storage ═══
   If a user comes from an older version that stored monolithic state or legacy keys,
   migrate each slice into its proper dedicated key without data loss. */
export function migrateStorage(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return false;
  try {
    // 1. Monolithic single-key storage migrations
    const legacyKeys = ['daftarche-state', 'daftarche_state', 'daftarche_app_state', 'daftarche-all', 'daftarche-store'];
    for (const legacyKey of legacyKeys) {
      const raw = storage.getItem(legacyKey);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.tasks) && !storage.getItem(STORAGE_KEYS.tasks)) {
            storage.setItem(STORAGE_KEYS.tasks, JSON.stringify(parsed.tasks));
          }
          if (Array.isArray(parsed.history) && !storage.getItem(STORAGE_KEYS.history)) {
            storage.setItem(STORAGE_KEYS.history, JSON.stringify(parsed.history));
          }
          if (parsed.moods && typeof parsed.moods === 'object' && !storage.getItem(STORAGE_KEYS.moods)) {
            storage.setItem(STORAGE_KEYS.moods, JSON.stringify(parsed.moods));
          }
          if (Array.isArray(parsed.focusHistory) && !storage.getItem(STORAGE_KEYS.focusHistory)) {
            storage.setItem(STORAGE_KEYS.focusHistory, JSON.stringify(parsed.focusHistory));
          }
          if (Array.isArray(parsed.books) && !storage.getItem('daftarche-books-meta')) {
            storage.setItem('daftarche-books-meta', JSON.stringify(parsed.books));
          }
          if (typeof parsed.userName === 'string' && !storage.getItem(STORAGE_KEYS.name)) {
            storage.setItem(STORAGE_KEYS.name, parsed.userName);
          }
          if (typeof parsed.theme === 'string' && !storage.getItem(STORAGE_KEYS.theme)) {
            storage.setItem(STORAGE_KEYS.theme, parsed.theme);
          }
          if (parsed.ledger && typeof parsed.ledger === 'object' && !storage.getItem(STORAGE_KEYS.ledger)) {
            storage.setItem(STORAGE_KEYS.ledger, JSON.stringify(parsed.ledger));
          }
          if (parsed.achievements && typeof parsed.achievements === 'object' && !storage.getItem(STORAGE_KEYS.achievements)) {
            storage.setItem(STORAGE_KEYS.achievements, JSON.stringify(parsed.achievements));
          }
        }
        storage.removeItem(legacyKey);
      } catch { /* keep going */ }
    }

    // 2. Unversioned task keys
    const rawOldTasks = storage.getItem('daftarche-tasks');
    if (rawOldTasks && !storage.getItem(STORAGE_KEYS.tasks)) {
      storage.setItem(STORAGE_KEYS.tasks, rawOldTasks);
      storage.removeItem('daftarche-tasks');
    }

    return true;
  } catch {
    return false;
  }
}

if (typeof localStorage !== 'undefined') {
  try { migrateStorage(localStorage); } catch { /* ignore */ }
}

export const loadTasks   = ()    => read(STORAGE_KEYS.tasks, null);
export const saveTasks   = (t, { sync = false } = {}) => {
  if (sync) {
    dirtySlices.delete(STORAGE_KEYS.tasks);
    return safeSet(STORAGE_KEYS.tasks, JSON.stringify(t));
  }
  return scheduleSave(STORAGE_KEYS.tasks, t);
};

export const loadName    = ()    => readString(STORAGE_KEYS.name);
export const saveName    = v    => scheduleSave(STORAGE_KEYS.name, v);

export const loadHistory = ()    => read(STORAGE_KEYS.history, []);
export const saveHistory = h    => scheduleSave(STORAGE_KEYS.history, h);

export const loadMoods   = ()    => read(STORAGE_KEYS.moods, {});
export const saveMoods   = m    => scheduleSave(STORAGE_KEYS.moods, m);

export const loadPomo    = ()    => Number(readString(STORAGE_KEYS.pomo)) || 25;
export const savePomo    = v    => scheduleSave(STORAGE_KEYS.pomo, String(v));

/* Active/paused focus session — survives reload; source of truth for the timer */
export const loadSession = ()    => read(STORAGE_KEYS.session, null);
export const saveSession = s    => scheduleSave(STORAGE_KEYS.session, s ? s : '');
export const clearSession = ()   => safeRemove(STORAGE_KEYS.session);

/* Completed focus sessions archive (newest first, capped) */
export const loadFocusHistory = ()  => read(STORAGE_KEYS.focusHistory, []);
export const saveFocusHistory = h  => scheduleSave(STORAGE_KEYS.focusHistory, h);

/* The stats window the reader last chose. A view preference, not data — if it
   is missing or unreadable the stats page falls back to its default range. */
export const loadStatsRange = ()    => readString(STORAGE_KEYS.statsRange);
export const saveStatsRange = key   => scheduleSave(STORAGE_KEYS.statsRange, key);

/* The share card's template — a colour and a layout. A view preference like the
   stats range, not data: an unreadable value falls back to the default pair in
   js/sharecard.js, which is also where the keys are defined. */
export const loadCardStyle = ()    => read(STORAGE_KEYS.cardStyle, null);
export const saveCardStyle = style => scheduleSave(STORAGE_KEYS.cardStyle, style);

/* Streak freeze — «مرخصی پیوستگی». On unless it was deliberately turned off,
   so the setting only has to be written down once, when the reader changes it,
   and a missing key (a fresh install, a wiped storage) means the default. */
export const loadFreeze  = ()    => readString(STORAGE_KEYS.freeze, 'on') !== 'off';
export const saveFreeze  = on    => scheduleSave(STORAGE_KEYS.freeze, on ? 'on' : 'off');

/* Unlocked achievements, keyed by id, with the highest tier reached and the day
   it was reached. Read and sanitized by js/achievements.js, which owns the
   shape; this is only the shelf it sits on. */
export const loadAchv    = ()    => read(STORAGE_KEYS.achievements, null);
export const saveAchv    = v     => scheduleSave(STORAGE_KEYS.achievements, v);

export const loadTheme   = ()    => readString(STORAGE_KEYS.theme, null);
export const saveTheme   = t    => scheduleSave(STORAGE_KEYS.theme, t);
export const loadThemeAuto = ()  => readString(STORAGE_KEYS.themeAuto) === 'true';
export const saveThemeAuto = on => scheduleSave(STORAGE_KEYS.themeAuto, on ? 'true' : 'false');

/* The last theme used in each half of the table — { light: 'cream', dark: 'ocean' }.
   It exists so the one-tap switch in the header can return to the dark theme the
   reader actually chose instead of falling back to a fixed one. A view
   preference, not data: unreadable means the first theme of that half. */
export const loadThemeModes = ()    => read(STORAGE_KEYS.themeModes, null);
export const saveThemeModes = m     => scheduleSave(STORAGE_KEYS.themeModes, m);

/* The reader's own birthday, as a Jalali MM-DD with no year — a birthday is
   the same day every year, so a year would only be one more thing to get wrong.
   js/birthday.js owns the shape and refuses anything the calendar could not
   write; this is only the shelf it sits on. Saving null takes the date away
   again, which is why the row has a «پاک کن» that means what it says. */
export const loadBirthday = ()    => read(STORAGE_KEYS.birthday, null);
export const saveBirthday = b     => b ? scheduleSave(STORAGE_KEYS.birthday, b) : scheduleSave(STORAGE_KEYS.birthday, null);

/* The last day the greeting was shown, as a bare MM-DD. It carries no year on
   purpose: nothing about it has to expire, so next year's greeting arrives by
   itself with no cleanup and no year to roll over. Device-local, so js/backup.js
   keeps it out of the file. */
export const loadBirthdaySeen = ()    => readString(STORAGE_KEYS.birthdaySeen);
export const saveBirthdaySeen = key   => scheduleSave(STORAGE_KEYS.birthdaySeen, key || '');

/* The guided tour. This release owns a new marker on purpose: the old
   `daftarche-tour-done` key belongs to the previous tour and must not suppress
   this release's required first visit. «Done» means the reader either walked
   it to the end or skipped it; leaving mid-tour (Escape) writes nothing. */
/* What the reader said they mostly came for («tasks», «books» or «focus»).
   Only ever one of those three; anything else reads as «no answer». */
export const GOALS = ['tasks', 'books', 'focus'];
export const loadGoal = () => { const g = readString(STORAGE_KEYS.goal); return GOALS.includes(g) ? g : ''; };
export const saveGoal = g => (GOALS.includes(g) ? scheduleSave(STORAGE_KEYS.goal, g) : scheduleSave(STORAGE_KEYS.goal, null));
export const loadTourDone = ()    => readString(STORAGE_KEYS.tourDone) === 'yes';
export const saveTourDone   = ()    => scheduleSave(STORAGE_KEYS.tourDone, 'yes');
/* A separate marker is essential: dismissing the automatic offer must never
   count as completing the tour or unlock an achievement reward on next boot. */
export const saveTourAwarded = () => scheduleSave(STORAGE_KEYS.tourAwarded, 'yes');
export const loadTourAwarded = ()    => readString(STORAGE_KEYS.tourAwarded) === 'yes';

export const loadLang = ()           => readString('daftarche-lang', 'fa');
export const saveLang = lang         => scheduleSave('daftarche-lang', lang === 'en' ? 'en' : 'fa');
