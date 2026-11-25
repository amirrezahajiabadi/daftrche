/* ═══ Sprint 3.2 Tests: Journal Page, Memories, Photos, Wind-Down & Backup ═══ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_JOURNAL_TITLE,
  MAX_JOURNAL_TEXT,
  MAX_JOURNAL_PHOTOS,
  DAILY_PROMPTS,
  JOURNAL_TEMPLATES,
  normalizeJournalEntry,
  normalizeJournalPhotos,
  getDailyPrompt,
  findPastMemories,
  filterJournalTimeline,
  groupJournalByJalaliMonth,
  computeJournalStats,
  mergeJournals,
  buildWindDownSummary,
} from '../js/journal-logic.js';
import { projectJournalForSync, SYNC_KINDS, validateSyncEnvelope, createSyncEnvelope, projectTaskForSync } from '../js/sync-projection.js';
import { collectBackup, parseBackup, applyBackup, mergeBackup } from '../js/backup.js';
import { STORAGE_KEYS } from '../js/constants.js';
import { jalaliToDate } from '../js/jalali.js';
import { dayKey } from '../js/utils.js';

class FakeStorage {
  constructor(init = {}) {
    this.map = new Map(Object.entries(init));
  }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

test('normalizeJournalEntry & normalizeJournalPhotos: validates title, text, and capped photos', () => {
  assert.equal(normalizeJournalEntry(null, '2026-11-25'), null);
  assert.equal(normalizeJournalEntry({ text: 'سلام' }, 'invalid-date'), null);

  const partial = normalizeJournalEntry({ text: 'روز خوبی بود' }, '2026-11-25');
  assert.equal(partial.dateKey, '2026-11-25');
  assert.equal(partial.title, '');
  assert.equal(partial.text, 'روز خوبی بود');
  assert.deepEqual(partial.photos, []);
  assert.equal(partial.promptId, null);
  assert.equal(partial.mood, null);
  assert.equal(partial.version, 1);
  assert.ok(Number.isFinite(partial.updatedAt) && partial.updatedAt > 0);

  const longTitle = 'ع'.repeat(MAX_JOURNAL_TITLE + 30);
  const longText = 'آ'.repeat(MAX_JOURNAL_TEXT + 400);
  const photosInput = [
    { id: 'jp-1', width: 800, height: 600, mime: 'image/jpeg', createdAt: 100 },
    { id: 'jp-1', width: 999, height: 999 }, // duplicate id dropped
    { id: '', width: 100 },                  // invalid id dropped
    { id: 'jp-2', width: 1000, height: 800, mime: 'image/webp', createdAt: 200 },
    { id: 'jp-3', width: 500, height: 500 },
    { id: 'jp-4', width: 400, height: 400 },
    { id: 'jp-5', width: 300, height: 300 }, // exceeds MAX_JOURNAL_PHOTOS (4)
  ];
  const clamped = normalizeJournalEntry({
    dateKey: '2026-11-25',
    title: '  ' + longTitle + '  ',
    text: longText,
    photos: photosInput,
    promptId: ' p02 ',
    mood: 4,
    updatedAt: 1700000000000,
    version: 3,
  });
  assert.equal(clamped.title.length, MAX_JOURNAL_TITLE);
  assert.equal(clamped.text.length, MAX_JOURNAL_TEXT);
  assert.equal(clamped.photos.length, MAX_JOURNAL_PHOTOS);
  assert.deepEqual(clamped.photos.map(p => p.id), ['jp-1', 'jp-2', 'jp-3', 'jp-4']);
  assert.equal(clamped.promptId, 'p02');
  assert.equal(clamped.mood, 4);
  assert.equal(clamped.updatedAt, 1700000000000);
  assert.equal(clamped.version, 3);

  assert.deepEqual(normalizeJournalPhotos('not-array'), []);
});

test('getDailyPrompt: deterministic per dateKey and cycles smoothly with offset', () => {
  assert.ok(DAILY_PROMPTS.length >= 12);
  const a1 = getDailyPrompt('2026-11-25', 0);
  const a2 = getDailyPrompt('2026-11-25', 0);
  assert.deepEqual(a1, a2);

  const seenIds = new Set();
  for (let i = 0; i < DAILY_PROMPTS.length; i++) {
    seenIds.add(getDailyPrompt('2026-11-25', i).id);
  }
  assert.equal(seenIds.size, DAILY_PROMPTS.length);
  assert.deepEqual(getDailyPrompt('2026-11-25', DAILY_PROMPTS.length), a1);
  assert.deepEqual(getDailyPrompt('2026-11-25', -DAILY_PROMPTS.length), a1);
});

test('findPastMemories: matches Jalali 1-year and 1-month entries, photo-only entries, and closest fallback', () => {
  const todayKey = dayKey(jalaliToDate(1405, 9, 4));
  const oneMonthKey = dayKey(jalaliToDate(1405, 8, 4));
  const oneYearKey = dayKey(jalaliToDate(1404, 9, 4));

  const map = {
    [todayKey]: { text: 'امروز', updatedAt: 300, version: 1 },
    [oneMonthKey]: { title: 'سفر کوتاه', text: '', photos: [{ id: 'jp-a' }], updatedAt: 200, version: 1 },
    [oneYearKey]: { text: 'یک سال پیش خیلی یاد گرفتم', updatedAt: 100, version: 1 },
  };

  const memories = findPastMemories(map, todayKey);
  assert.equal(memories.length, 2);
  assert.equal(memories[0].relation, 'one-year');
  assert.equal(memories[1].relation, 'one-month');
  assert.equal(memories[1].photos.length, 1);

  const farv31 = dayKey(jalaliToDate(1405, 1, 31));
  const esfand29 = dayKey(jalaliToDate(1404, 12, 29));
  const clampMemories = findPastMemories({
    [esfand29]: { text: 'پایان سال', updatedAt: 50, version: 1 },
  }, farv31);
  assert.equal(clampMemories.length, 1);
  assert.equal(clampMemories[0].relation, 'one-month');
  assert.equal(clampMemories[0].dateKey, esfand29);

  const fallback = findPastMemories({
    '2026-11-20': { text: 'پنج روز پیش', updatedAt: 100, version: 1 },
    '2026-11-05': { text: 'قدیمی‌تر', updatedAt: 90, version: 1 },
    '2026-11-28': { text: 'آینده نباید بیاد', updatedAt: 999, version: 1 },
  }, '2026-11-25');
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].relation, 'past');
  assert.equal(fallback[0].dateKey, '2026-11-20');

  assert.deepEqual(findPastMemories({ [oneMonthKey]: { text: '   ', updatedAt: 10, version: 1 } }, todayKey), []);
});

test('filterJournalTimeline: orders newest first, normalizes Persian search, and filters photosOnly', () => {
  const map = {
    '2026-11-20': { title: 'پياده روي', text: 'عصر پاییزی', updatedAt: 100, version: 1 },
    '2026-11-24': { title: 'کوهنوردی', text: 'عکس از قله', photos: [{ id: 'jp-1' }], updatedAt: 200, version: 1 },
    '2026-11-25': { text: '   ', updatedAt: 300, version: 1 }, // blank entry excluded
  };

  const all = filterJournalTimeline(map);
  assert.deepEqual(all.map(e => e.dateKey), ['2026-11-24', '2026-11-20']);

  // Arabic yeh matches normalized Persian yeh
  const searched = filterJournalTimeline(map, { query: 'پیاده' });
  assert.deepEqual(searched.map(e => e.dateKey), ['2026-11-20']);

  const withPhotos = filterJournalTimeline(map, { photosOnly: true });
  assert.deepEqual(withPhotos.map(e => e.dateKey), ['2026-11-24']);
});

test('mergeJournals: resolves conflicts by version then updatedAt including title and photos', () => {
  const local = {
    '2026-11-20': { title: 'محلی', text: 'نسخه محلی بالاتر', version: 3, updatedAt: 100 },
    '2026-11-21': { text: 'قدیمی‌تر', version: 2, updatedAt: 100 },
    '2026-11-22': { text: 'تساوی کامل با محلی', version: 2, updatedAt: 500 },
  };
  const incoming = {
    '2026-11-20': { text: 'ورودی پایین‌تر', version: 2, updatedAt: 9999 },
    '2026-11-21': { title: 'جدید', text: 'ورودی جدیدتر', photos: [{ id: 'jp-x' }], version: 2, updatedAt: 300 },
    '2026-11-22': { text: 'تساوی کامل با ورودی', version: 2, updatedAt: 500 },
    '2026-11-24': { text: 'فقط ورودی', version: 1, updatedAt: 200 },
  };

  const merged = mergeJournals(local, incoming);
  assert.equal(merged['2026-11-20'].title, 'محلی');
  assert.equal(merged['2026-11-21'].title, 'جدید');
  assert.equal(merged['2026-11-21'].photos.length, 1);
  assert.equal(merged['2026-11-22'].text, 'تساوی کامل با محلی');
  assert.equal(merged['2026-11-24'].text, 'فقط ورودی');
});

test('buildWindDownSummary & UI labels: removes "آرام" from Wind-Down and handles all task states', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('پایان روز آرام'));
  assert.ok(html.includes('پایان روز'));

  const zeroEmpty = buildWindDownSummary({ todayTasks: [], focusMinutes: 0, dateKey: '2026-11-25' });
  assert.equal(zeroEmpty.completedCount, 0);
  assert.equal(zeroEmpty.remainingTasks.length, 0);
  assert.ok(zeroEmpty.message.length > 10);

  const partial = buildWindDownSummary({
    todayTasks: [
      { id: '1', text: 'کار اول', done: true },
      { id: '2', text: 'کار دوم', done: false },
    ],
    focusMinutes: 45,
    dateKey: '2026-11-25',
  });
  assert.equal(partial.completedCount, 1);
  assert.equal(partial.remainingTasks.length, 1);

  const allDone = buildWindDownSummary({
    todayTasks: [{ id: '1', text: 'کار اول', done: true }],
    focusMinutes: 60,
    dateKey: '2026-11-25',
  });
  assert.equal(allDone.completedCount, 1);
  assert.equal(allDone.remainingTasks.length, 0);
  assert.match(allDone.message, /آفرین/);
});

test('Backup round-trip & merge preserves daftarche-journal with title/photos and sync projection works', () => {
  const journalKey = STORAGE_KEYS.journal;
  const src = new FakeStorage({
    [journalKey]: JSON.stringify({
      '2026-11-24': {
        title: 'پاییز',
        text: 'یادداشت دیروز',
        photos: [{ id: 'jp-1', width: 800, height: 600, mime: 'image/jpeg', createdAt: 150 }],
        mood: 4,
        version: 2,
        updatedAt: 200,
      },
    }),
  });

  const exported = collectBackup(src, { release: '3.5.0' });
  const parsed = parseBackup(JSON.stringify(exported));
  assert.equal(parsed.ok, true);
  assert.ok(journalKey in parsed.backup.data);

  const dest = new FakeStorage({
    [journalKey]: JSON.stringify({
      '2026-11-24': { text: 'نسخه قدیمی‌تر', mood: 2, version: 1, updatedAt: 100 },
      '2026-11-25': { text: 'یادداشت امروز', mood: 5, version: 1, updatedAt: 300 },
    }),
  });
  const merged = mergeBackup(dest, parsed.backup);
  assert.equal(merged.ok, true);
  const after = JSON.parse(dest.getItem(journalKey));
  assert.equal(after['2026-11-24'].title, 'پاییز');
  assert.equal(after['2026-11-24'].photos[0].id, 'jp-1');
  assert.equal(after['2026-11-25'].text, 'یادداشت امروز');

  const appliedStorage = new FakeStorage();
  const applied = applyBackup(appliedStorage, parsed.backup);
  assert.equal(applied.ok, true);
  assert.equal(JSON.parse(appliedStorage.getItem(journalKey))['2026-11-24'].title, 'پاییز');

  const projected = projectJournalForSync({
    title: 'عنوان',
    text: 'خاطره',
    photos: [{ id: 'jp-1', width: 640, height: 480 }],
    mood: 5,
    promptId: 'p01',
    version: 2,
    updatedAt: 500,
    starred: true,
  }, '2026-11-25');
  assert.equal(projected.id, '2026-11-25');
  assert.equal(projected.title, 'عنوان');
  assert.equal(projected.photos.length, 1);
  assert.equal(projected.starred, true);
  assert.deepEqual(SYNC_KINDS, ['task', 'book']);
  const env = createSyncEnvelope({ kind: 'task', entityId: 't1', action: 'upsert', rev: 1, payload: projectTaskForSync({ id: 't1', text: 'تست' }) });
  assert.deepEqual(validateSyncEnvelope(env), { valid: true });
});

test('starred memories, templates, mood/starred filtering, Jalali month grouping & calm stats', () => {
  assert.ok(Array.isArray(JOURNAL_TEMPLATES) && JOURNAL_TEMPLATES.length >= 3);

  const map = {
    '2026-11-25': { title: 'آذر ۱', text: 'روز عالی', mood: 5, starred: true, version: 1, updatedAt: 500 },
    '2026-11-24': { title: 'آذر ۲', text: 'روز آرام', mood: 4, photos: [{ id: 'p1' }], version: 1, updatedAt: 400 },
    '2026-10-28': { title: 'آبان ۱', text: 'سفر کوتاه', mood: 5, starred: false, version: 1, updatedAt: 300 },
  };

  const starredOnly = filterJournalTimeline(map, { starredOnly: true });
  assert.deepEqual(starredOnly.map(e => e.dateKey), ['2026-11-25']);

  const mood5Only = filterJournalTimeline(map, { mood: 5 });
  assert.deepEqual(mood5Only.map(e => e.dateKey), ['2026-11-25', '2026-10-28']);

  const all = filterJournalTimeline(map);
  const grouped = groupJournalByJalaliMonth(all);
  assert.equal(grouped.length, 2);
  assert.match(grouped[0].label, /آذر/);
  assert.equal(grouped[0].items.length, 2);
  assert.match(grouped[1].label, /آبان/);
  assert.equal(grouped[1].items.length, 1);

  const stats = computeJournalStats(map, '2026-11-25');
  assert.deepEqual(stats, {
    totalEntries: 3,
    totalPhotos: 1,
    starredCount: 1,
    streakDays: 2,
  });

  // Backward compatibility with legacy entries missing starred field
  const leg = normalizeJournalEntry({ text: 'قدیمی' }, '2026-11-01');
  assert.equal(leg.starred, false);

  // Mood picker lives exclusively in Journal (#page-journal), not #page-today
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('امروز چه حالی داری؟'));
  assert.ok(!html.includes('mood-sec'));
  assert.ok(html.includes('id="journalMoodPicker"'));
});
