/* ═══ Journal, Time Capsule & End-of-Day Wind-Down Logic ═══
   Zero DOM dependencies — 100% deterministic & Node-testable.
   Includes:
     · Journal entry normalization (title <= 120, text <= 5000, photos <= 4, promptId, mood, updatedAt, version)
     · Optional curated Persian reflection prompts (getDailyPrompt)
     · Jalali-aware Time Capsule lookup (findPastMemories: 1 month, 1 year, or closest past)
     · Searchable timeline filtering (filterJournalTimeline)
     · Conflict-free backup merging (mergeJournals: version then updatedAt)
     · End-of-Day Wind-Down summary builder (buildWindDownSummary)
*/

import { dateToJalali, jalaliToDate, jalaliDaysInMonth, formatJalaliDate, JALALI_MONTHS } from './jalali.js';
import { dayKey, shiftKey, faNum, normalizeFa } from './utils.js';

export const MAX_JOURNAL_TITLE = 120;
export const MAX_JOURNAL_TEXT = 5000;
export const MAX_JOURNAL_PHOTOS = 4;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 864e5;

export const JOURNAL_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'tpl-three-good',
    label: '۳ چیز خوب امروز',
    title: 'سه اتفاق خوب امروز',
    body: '۱. \n۲. \n۳. ',
  }),
  Object.freeze({
    id: 'tpl-gratitude',
    label: 'قدردانی کوتاه',
    title: 'امروز بابت چه چیزی قدردانم؟',
    body: 'امروز دلم می‌خواد بابت ... شکرگزار باشم، چون ...',
  }),
  Object.freeze({
    id: 'tpl-release',
    label: 'سبک‌کردن ذهن',
    title: 'چیزهایی که از ذهنم رها می‌کنم',
    body: 'چیزی که الان ذهنم رو درگیر کرده:\nقدم خیلی کوچیکی که فردا برمی‌دارم:\n',
  }),
]);

export const DAILY_PROMPTS = Object.freeze([
  Object.freeze({ id: 'p01', text: 'امروز چه اتفاق کوچیکی حالت رو بهتر کرد؟' }),
  Object.freeze({ id: 'p02', text: 'چه کاری رو امروز با وجود سختیش جلو بردی؟' }),
  Object.freeze({ id: 'p03', text: 'فردا می‌خوای به چه چیزی بیشتر توجه کنی؟' }),
  Object.freeze({ id: 'p04', text: 'یک چیز ساده که همین الان بابتش قدردانی چیه؟' }),
  Object.freeze({ id: 'p05', text: 'امروز چی انرژی بیشتری ازت گرفت و چی دوباره شارژت کرد؟' }),
  Object.freeze({ id: 'p06', text: 'اگر قرار بود امروز رو با یک جمله به خاطر بسپاری، چی می‌نوشتی؟' }),
  Object.freeze({ id: 'p07', text: 'کدوم نگرانیِ امروز رو می‌تونی با خیال راحت بذاری زمین؟' }),
  Object.freeze({ id: 'p08', text: 'امروز چه نکتهٔ تازه‌ای دربارهٔ خودت یا کارهات متوجه شدی؟' }),
  Object.freeze({ id: 'p09', text: 'کی یا چی امروز باعث شد لبخند کوچیکی بزنی؟' }),
  Object.freeze({ id: 'p10', text: 'بابت چه تلاشی در روزهای اخیر به خودت افتخار می‌کنی؟' }),
  Object.freeze({ id: 'p11', text: 'الان بدنت و ذهنت بیشتر به چه استراحتی نیاز دارن؟' }),
  Object.freeze({ id: 'p12', text: 'چه مرزی امروز تونستی برای وقت یا تمرکزت نگه داری؟' }),
  Object.freeze({ id: 'p13', text: 'کدوم کار ناتمام امروز واقعاً مهمه و کدومش می‌تونه صبر کنه؟' }),
  Object.freeze({ id: 'p14', text: 'برای فردا یک قدم خیلی کوچیک و قابل انجام چیه؟' }),
]);

/**
 * Parses a valid YYYY-MM-DD key into a local Date.
 * @param {string} key
 * @returns {Date|null}
 */
function parseDayKey(key) {
  if (typeof key !== 'string' || !DAY_KEY_RE.test(key)) return null;
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dayKey(dt) !== key) return null;
  return dt;
}

/**
 * Safely normalizes attached photo metadata (IDs stored in IndexedDB).
 * @param {Array} list
 * @returns {Array<{ id: string, width: number|null, height: number|null, mime: string, createdAt: number }>}
 */
export function normalizeJournalPhotos(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const width = Number.isFinite(Number(item.width)) && Number(item.width) > 0 ? Math.round(Number(item.width)) : null;
    const height = Number.isFinite(Number(item.height)) && Number(item.height) > 0 ? Math.round(Number(item.height)) : null;
    const mime = typeof item.mime === 'string' && item.mime.startsWith('image/') ? item.mime : 'image/jpeg';
    const createdAt = Number.isFinite(Number(item.createdAt)) && Number(item.createdAt) > 0
      ? Math.floor(Number(item.createdAt))
      : Date.now();
    out.push({ id, width, height, mime, createdAt });
    if (out.length >= MAX_JOURNAL_PHOTOS) break;
  }
  return out;
}

/**
 * Safely normalizes a journal entry object for a given YYYY-MM-DD dateKey.
 * @param {Object} entry
 * @param {string} [dateKey]
 * @returns {Object|null}
 */
export function normalizeJournalEntry(entry, dateKey) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

  const key = (typeof dateKey === 'string' && DAY_KEY_RE.test(dateKey))
    ? dateKey
    : (typeof entry.dateKey === 'string' && DAY_KEY_RE.test(entry.dateKey) ? entry.dateKey : null);
  if (!key) return null;

  const rawTitle = typeof entry.title === 'string' ? entry.title.trim() : '';
  const title = rawTitle.length > MAX_JOURNAL_TITLE ? rawTitle.slice(0, MAX_JOURNAL_TITLE) : rawTitle;

  const rawText = typeof entry.text === 'string' ? entry.text : '';
  const text = rawText.length > MAX_JOURNAL_TEXT ? rawText.slice(0, MAX_JOURNAL_TEXT) : rawText;

  const photos = normalizeJournalPhotos(entry.photos);

  const promptId = typeof entry.promptId === 'string' && entry.promptId.trim()
    ? entry.promptId.trim()
    : null;

  const rawMood = Number(entry.mood);
  const mood = Number.isInteger(rawMood) && rawMood >= 1 && rawMood <= 5 ? rawMood : null;

  const rawUpdated = Number(entry.updatedAt);
  const updatedAt = Number.isFinite(rawUpdated) && rawUpdated > 0
    ? Math.floor(rawUpdated)
    : Date.now();

  const rawVersion = Number(entry.version);
  const version = Number.isInteger(rawVersion) && rawVersion >= 1 ? rawVersion : 1;

  return {
    dateKey: key,
    title,
    text,
    photos,
    promptId,
    mood,
    starred: Boolean(entry.starred),
    updatedAt,
    version,
  };
}

/**
 * Normalizes a journal map ({ [dateKey]: entry }) safely.
 * @param {Object} map
 * @returns {Object}
 */
export function normalizeJournalMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    if (!DAY_KEY_RE.test(k)) continue;
    const norm = normalizeJournalEntry(v, k);
    if (norm) out[k] = norm;
  }
  return out;
}

/**
 * True when an entry holds meaningful user content (title, text, or photos).
 * @param {Object} entry
 * @returns {boolean}
 */
export function hasJournalContent(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return Boolean(
    (typeof entry.title === 'string' && entry.title.trim()) ||
    (typeof entry.text === 'string' && entry.text.trim()) ||
    (Array.isArray(entry.photos) && entry.photos.length > 0)
  );
}

/**
 * Deterministically picks an optional reflection prompt based on dateKey and offset.
 * @param {string} dateKey
 * @param {number} [offset=0]
 * @returns {{ id: string, text: string }}
 */
export function getDailyPrompt(dateKey, offset = 0) {
  const len = DAILY_PROMPTS.length;
  const src = typeof dateKey === 'string' && dateKey ? dateKey : '2026-01-01';
  let hash = 2166136261;
  for (let i = 0; i < src.length; i++) {
    hash ^= src.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const baseIdx = (hash >>> 0) % len;
  const step = Number.isFinite(Number(offset)) ? Math.trunc(Number(offset)) : 0;
  const idx = (((baseIdx + step) % len) + len) % len;
  return DAILY_PROMPTS[idx];
}

/**
 * Finds past journal memories for the Time Capsule card («در چنین روزی...»).
 * Checks 1 Jalali year ago and 1 Jalali month ago first; if neither exists,
 * returns the closest valid past memory before todayKey (if any).
 * @param {Object} journalMap
 * @param {string} todayKey
 * @returns {Array<Object>}
 */
export function findPastMemories(journalMap, todayKey) {
  const todayDate = parseDayKey(todayKey);
  if (!todayDate || !journalMap || typeof journalMap !== 'object' || Array.isArray(journalMap)) {
    return [];
  }

  const normalized = normalizeJournalMap(journalMap);
  const jToday = dateToJalali(todayDate);

  const buildCandidateKey = (jy, jm, jd) => {
    if (jy < 1) return null;
    const maxD = jalaliDaysInMonth(jy, jm);
    const clampedD = Math.min(jd, maxD);
    return dayKey(jalaliToDate(jy, jm, clampedD));
  };

  const formatMemory = (entry, relation, label) => {
    const dt = parseDayKey(entry.dateKey);
    const daysAgo = dt ? Math.max(1, Math.round((todayDate - dt) / DAY_MS)) : 0;
    return {
      ...entry,
      relation,
      label,
      daysAgo,
      jalaliDate: dt ? formatJalaliDate(dt) : entry.dateKey,
    };
  };

  const memories = [];
  const seenKeys = new Set();

  // 1. One Jalali year ago
  const oneYearKey = buildCandidateKey(jToday.jy - 1, jToday.jm, jToday.jd);
  if (oneYearKey && oneYearKey < todayKey && hasJournalContent(normalized[oneYearKey])) {
    memories.push(formatMemory(normalized[oneYearKey], 'one-year', 'یک سال پیش در چنین روزی'));
    seenKeys.add(oneYearKey);
  }

  // 2. One Jalali month ago
  const prevJm = jToday.jm === 1 ? 12 : jToday.jm - 1;
  const prevJy = jToday.jm === 1 ? jToday.jy - 1 : jToday.jy;
  const oneMonthKey = buildCandidateKey(prevJy, prevJm, jToday.jd);
  if (
    oneMonthKey &&
    oneMonthKey < todayKey &&
    !seenKeys.has(oneMonthKey) &&
    hasJournalContent(normalized[oneMonthKey])
  ) {
    memories.push(formatMemory(normalized[oneMonthKey], 'one-month', 'یک ماه پیش در چنین روزی'));
    seenKeys.add(oneMonthKey);
  }

  if (memories.length > 0) return memories;

  // 3. Fallback: closest past memory strictly before todayKey
  let closest = null;
  for (const [k, entry] of Object.entries(normalized)) {
    if (k >= todayKey || !hasJournalContent(entry)) continue;
    if (!closest || k > closest.dateKey) {
      closest = entry;
    }
  }
  if (!closest) return [];

  const dt = parseDayKey(closest.dateKey);
  const daysAgo = dt ? Math.max(1, Math.round((todayDate - dt) / DAY_MS)) : 1;
  return [formatMemory(closest, 'past', `یادداشتی از ${faNum(daysAgo)} روز پیش`)];
}

/**
 * Returns journal entries ordered newest-first, filtered by query, photo presence, starred, or mood.
 * @param {Object} journalMap
 * @param {Object} [options]
 * @param {string} [options.query='']
 * @param {boolean} [options.photosOnly=false]
 * @param {boolean} [options.starredOnly=false]
 * @param {number|null} [options.mood=null]
 * @returns {Array<Object>}
 */
export function filterJournalTimeline(journalMap, {
  query = '',
  photosOnly = false,
  starredOnly = false,
  mood = null,
} = {}) {
  const normalized = normalizeJournalMap(journalMap);
  const needle = normalizeFa(String(query || '').trim());
  const moodFilter = Number.isInteger(mood) && mood >= 1 && mood <= 5 ? mood : null;
  const entries = Object.values(normalized).filter(hasJournalContent);

  entries.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  return entries.filter(entry => {
    if (photosOnly && (!entry.photos || entry.photos.length === 0)) return false;
    if (starredOnly && !entry.starred) return false;
    if (moodFilter !== null && entry.mood !== moodFilter) return false;
    if (!needle) return true;
    const haystack = normalizeFa(`${entry.title || ''} ${entry.text || ''}`);
    return haystack.includes(needle);
  }).map(entry => {
    const dt = parseDayKey(entry.dateKey);
    return {
      ...entry,
      jalaliDate: dt ? formatJalaliDate(dt) : entry.dateKey,
    };
  });
}

/**
 * Groups ordered journal entries into Jalali month buckets (e.g. «آذر ۱۴۰۵»).
 * @param {Array<Object>} entries
 * @returns {Array<{ key: string, label: string, items: Array<Object> }>}
 */
export function groupJournalByJalaliMonth(entries) {
  if (!Array.isArray(entries) || !entries.length) return [];
  const groups = [];
  const byKey = new Map();

  for (const entry of entries) {
    const dt = parseDayKey(entry?.dateKey);
    const mKey = dt ? (() => {
      const j = dateToJalali(dt);
      return `${j.jy}-${String(j.jm).padStart(2, '0')}`;
    })() : 'other';
    const label = dt ? (() => {
      const j = dateToJalali(dt);
      return `${JALALI_MONTHS[j.jm - 1]} ${faNum(j.jy)}`;
    })() : 'سایر';

    let bucket = byKey.get(mKey);
    if (!bucket) {
      bucket = { key: mKey, label, items: [] };
      byKey.set(mKey, bucket);
      groups.push(bucket);
    }
    bucket.items.push(entry);
  }
  return groups;
}

/**
 * Computes calm, non-punitive memory stats & writing continuity streak for journalMap.
 * @param {Object} journalMap
 * @param {string} todayKey
 * @returns {{ totalEntries: number, totalPhotos: number, starredCount: number, streakDays: number }}
 */
export function computeJournalStats(journalMap, todayKey) {
  const normalized = normalizeJournalMap(journalMap);
  const validEntries = Object.values(normalized).filter(hasJournalContent);
  let totalPhotos = 0;
  let starredCount = 0;
  const filledKeys = new Set();

  for (const e of validEntries) {
    filledKeys.add(e.dateKey);
    totalPhotos += Array.isArray(e.photos) ? e.photos.length : 0;
    if (e.starred) starredCount += 1;
  }

  let streakDays = 0;
  if (parseDayKey(todayKey) && filledKeys.size > 0) {
    let cursor = filledKeys.has(todayKey) ? todayKey : shiftKey(todayKey, -1);
    while (filledKeys.has(cursor)) {
      streakDays += 1;
      cursor = shiftKey(cursor, -1);
      if (streakDays >= 3650) break;
    }
  }

  return {
    totalEntries: validEntries.length,
    totalPhotos,
    starredCount,
    streakDays,
  };
}

/**
 * Pure conflict-resolution merger for journal maps.
 * Compares version first, then updatedAt; ties keep the local entry.
 * @param {Object} localMap
 * @param {Object} incomingMap
 * @returns {Object}
 */
export function mergeJournals(localMap, incomingMap) {
  const localNorm = normalizeJournalMap(localMap);
  const incomingNorm = normalizeJournalMap(incomingMap);
  const merged = { ...localNorm };

  for (const [key, inc] of Object.entries(incomingNorm)) {
    const cur = merged[key];
    if (!cur) {
      merged[key] = inc;
      continue;
    }
    if (inc.version > cur.version) {
      merged[key] = inc;
    } else if (inc.version === cur.version && inc.updatedAt > cur.updatedAt) {
      merged[key] = inc;
    }
  }
  return merged;
}

/**
 * Builds a warm, guilt-free Persian reflection summary for End-of-Day closure.
 * @param {Object} params
 * @param {Array<Object>} [params.todayTasks=[]]
 * @param {number} [params.focusMinutes=0]
 * @param {string} [params.dateKey='']
 * @returns {{ dateKey: string, completedCount: number, totalCount: number, remainingTasks: Array<Object>, focusMinutes: number, message: string }}
 */
export function buildWindDownSummary({ todayTasks = [], focusMinutes = 0, dateKey = '' } = {}) {
  const active = (Array.isArray(todayTasks) ? todayTasks : []).filter(t => t && !t.deletedAt);
  const completedCount = active.filter(t => Boolean(t.done)).length;
  const remainingTasks = active.filter(t => !t.done);
  const focusMin = Number.isFinite(Number(focusMinutes)) && Number(focusMinutes) > 0
    ? Math.round(Number(focusMinutes))
    : 0;

  let message;
  if (completedCount === 0 && remainingTasks.length === 0) {
    message = focusMin > 0
      ? `امروز ${faNum(focusMin)} دقیقه تمرکز داشتی؛ حتی یک روز خلوت هم بخشی از مسیر پیشرفته.`
      : 'امروزت سبک و بی‌سروصدا گذشت؛ استراحت و رها کردن هم بخش مهمی از مسیرِ توئه. شب خوبی داشته باشی.';
  } else if (completedCount === 0) {
    message = focusMin > 0
      ? `امروز ${faNum(focusMin)} دقیقه وقت گذاشتی و همین تلاش ارزشمنده. لازم نیست همه‌چیز امروز تموم بشه؛ فردا با نفس تازه ادامه می‌دیم.`
      : 'روزهایی که تیکِ کارها کمتره هم کاملاً طبیعین؛ بدون سرزنش به خودت استراحت بده تا فردا با حوصلهٔ تازه شروع کنی.';
  } else if (remainingTasks.length === 0) {
    message = `آفرین! هر ${faNum(completedCount)} کار امروزت رو جمع کردی. حالا وقتشه ذهنت رو آزاد کنی و استراحت خوبی داشته باشی.`;
  } else {
    message = `امروز ${faNum(completedCount)} کار رو به سرانجام رسوندی؛ بقیهٔ کارها می‌تونن به فردا منتقل بشن تا شب با خیال راحت استراحت کنی.`;
  }

  return {
    dateKey: typeof dateKey === 'string' ? dateKey : '',
    completedCount,
    totalCount: completedCount + remainingTasks.length,
    remainingTasks,
    focusMinutes: focusMin,
    message,
  };
}
