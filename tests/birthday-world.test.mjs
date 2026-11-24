/* ═══ Birthday World (tavalod) Tests (Phase 3) ═══
   Verifies:
   1. tavalod presence in WORLDS and WORLDS_DATA
   2. Data calculations: birthdayMatch, daysLived, nextBirthdayCountdown, birthdayWorldState
   3. Candle state persistence (loadBirthdayCandle, saveBirthdayCandle)
   4. Wish capsule persistence (loadBirthdayWishes, saveBirthdayWishes)
   5. Interactive Birthday World Card rendering:
      - Cake SVG with candles and decorations
      - Flame flickering and smoke puff states
      - Milestone pills (life days, age, countdown)
      - Wish capsule box (view, edit, save)
   6. CSS compliance:
      - Logical properties only (no left/right)
      - Design tokens (--color-* and --tape) without raw hex in components
      - Reduced-motion support (@media and data-motion="reduced")
*/

import './_env.mjs';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ls } from './_env.mjs';

import {
  WORLDS_DATA,
  birthdayMatch,
  daysLived,
  currentAge,
  nextBirthdayCountdown,
  birthdayWorldState,
} from '../js/worlds-data.js';
import { mergeBackup, parseBackup } from '../js/backup.js';
import { WORLDS, RENDER, renderWorld, initWorlds } from '../js/worlds.js';
import {
  loadBirthdayCandle,
  saveBirthdayCandle,
  loadBirthdayWishes,
  saveBirthdayWishes,
  saveBirthday,
} from '../js/store.js';
import { jalaliToDate, jalaliDaysInMonth } from '../js/jalali.js';
import { faNum } from '../js/utils.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

beforeEach(() => {
  ls.clear();
});

test('WORLDS & WORLDS_DATA registry: tavalod is present and configured', () => {
  assert.ok(WORLDS.has('tavalod'), 'WORLDS set includes tavalod');
  assert.ok(RENDER.tavalod, 'RENDER lookup includes tavalod renderer');
  assert.equal(typeof RENDER.tavalod, 'function');

  const meta = WORLDS_DATA.tavalod;
  assert.ok(meta, 'WORLDS_DATA contains tavalod');
  assert.equal(meta.id, 'tavalod');
  assert.equal(meta.title, 'جشن تولد');
  assert.ok(meta.subtitle.length > 0);
  assert.equal(meta.icon, 'cake');
  assert.equal(typeof meta.computeState, 'function');
});

test('birthdayMatch: verifies exact match, common year 29 Esfand and leap year 30 Esfand', () => {
  const bdayStandard = { y: 1375, m: 8, d: 15 };
  assert.equal(birthdayMatch(jalaliToDate(1405, 8, 15), bdayStandard), true);
  assert.equal(birthdayMatch(jalaliToDate(1405, 8, 14), bdayStandard), false);
  assert.equal(birthdayMatch(jalaliToDate(1405, 8, 16), bdayStandard), false);

  // 30 Esfand
  const bday30Esfand = { m: 12, d: 30 };
  assert.equal(birthdayMatch(jalaliToDate(1403, 12, 30), bday30Esfand), true, 'leap year match on day 30');
  assert.equal(birthdayMatch(jalaliToDate(1404, 12, 29), bday30Esfand), true, 'common year match on day 29');
  assert.equal(birthdayMatch(jalaliToDate(1404, 12, 28), bday30Esfand), false);

  // Null/invalid
  assert.equal(birthdayMatch(new Date(), null), false);
});

test('daysLived: accurately calculates days from birth date or returns null if no year', () => {
  const bday = { y: 1375, m: 8, d: 15 };
  const dExact = jalaliToDate(1375, 8, 15);
  assert.equal(daysLived(dExact, bday), 0);

  const dNextDay = jalaliToDate(1375, 8, 16);
  assert.equal(daysLived(dNextDay, bday), 1);

  const d30YearsLater = jalaliToDate(1405, 8, 15);
  const lived = daysLived(d30YearsLater, bday);
  assert.ok(lived >= 10950 && lived <= 10965, `30 years should be ~10957 days, got ${lived}`);

  // Without year: returns null
  assert.equal(daysLived(d30YearsLater, { m: 8, d: 15 }), null);
  assert.equal(daysLived(d30YearsLater, null), null);

  // Before birth: clamps to 0
  const dBefore = jalaliToDate(1370, 1, 1);
  assert.equal(daysLived(dBefore, bday), 0);

  // DST resilience: across daylight saving time shifts (e.g. standard vs summer time),
  // Math.round ensures 1-hour difference does not drop a full day
  const dSummer = jalaliToDate(1405, 4, 15);
  assert.equal(daysLived(dSummer, bday), 10835, 'DST offset does not lose a day');
});

test('daysLived: a birth year without a 30 Esfand counts from the 29th', () => {
  /* REGRESSION: jalaliToDate(1374, 12, 30) does not refuse an Esfand the year
     never had — it rolls it into 1 Farvardin of 1375, so the count started a day
     late for exactly the readers whose birthday the calendar sometimes skips. */
  const bday = { y: 1374, m: 12, d: 30 };          // 1374 is a common year
  assert.equal(jalaliDaysInMonth(1374, 12), 29);
  assert.equal(daysLived(jalaliToDate(1374, 12, 29), bday), 0);
  assert.equal(daysLived(jalaliToDate(1375, 1, 1), bday), 1);

  /* In a leap birth year the 30th exists and is the day counted from. */
  const leapBorn = { y: 1375, m: 12, d: 30 };      // 1375 is a leap year
  assert.equal(jalaliDaysInMonth(1375, 12), 30);
  assert.equal(daysLived(jalaliToDate(1375, 12, 30), leapBorn), 0);
  assert.equal(daysLived(jalaliToDate(1376, 1, 1), leapBorn), 1);
});

test('currentAge: accurately increments on birthday, not on Nowruz (New Year)', () => {
  const bday = { y: 1375, m: 8, d: 15 };

  // On birthday in 1405: age is 30
  const dOnBday = jalaliToDate(1405, 8, 15);
  assert.equal(currentAge(dOnBday, bday), 30);

  // Before birthday in 1405: age is still 29
  const dBeforeBday = jalaliToDate(1405, 8, 10);
  assert.equal(currentAge(dBeforeBday, bday), 29);

  // At the start of 1405 (Nowruz): age is 29, does not falsely increment
  const dNowruz1405 = jalaliToDate(1405, 1, 1);
  assert.equal(currentAge(dNowruz1405, bday), 29);

  // After birthday in 1405: age is 30
  const dAfterBday = jalaliToDate(1405, 8, 20);
  assert.equal(currentAge(dAfterBday, bday), 30);

  // At the end of year 1405: age is 30
  const dEnd1405 = jalaliToDate(1405, 12, 29);
  assert.equal(currentAge(dEnd1405, bday), 30);

  // At Nowruz of 1406: age remains 30 until birthday in Aban
  const dNowruz1406 = jalaliToDate(1406, 1, 1);
  assert.equal(currentAge(dNowruz1406, bday), 30, 'must not advance age on Nowruz');

  // On 31st birthday in 1406: age becomes 31
  const dOnBday1406 = jalaliToDate(1406, 8, 15);
  assert.equal(currentAge(dOnBday1406, bday), 31);

  // Without year: returns null
  assert.equal(currentAge(dOnBday, { m: 8, d: 15 }), null);
  assert.equal(currentAge(dOnBday, null), null);
});

test('nextBirthdayCountdown: counts down to this year or rolls over to next year', () => {
  const bday = { y: 1375, m: 8, d: 15 };
  const dOnBday = jalaliToDate(1405, 8, 15);
  assert.equal(nextBirthdayCountdown(dOnBday, bday), 0, '0 on birthday');

  const d5DaysBefore = jalaliToDate(1405, 8, 10);
  assert.equal(nextBirthdayCountdown(d5DaysBefore, bday), 5, '5 days before');

  const dPassed = jalaliToDate(1405, 8, 20);
  const nextYearCount = nextBirthdayCountdown(dPassed, bday);
  assert.ok(nextYearCount >= 355 && nextYearCount <= 365, `next year countdown should be ~360, got ${nextYearCount}`);

  // Works without birth year
  assert.equal(nextBirthdayCountdown(d5DaysBefore, { m: 8, d: 15 }), 5);
  assert.equal(nextBirthdayCountdown(dOnBday, { m: 8, d: 15 }), 0);

  // Null input
  assert.equal(nextBirthdayCountdown(dOnBday, null), null);
});

test('state persistence: candle blown state and wish capsule in store', () => {
  // Candle state
  assert.equal(loadBirthdayCandle(), '');
  saveBirthdayCandle('2026-11-13');
  assert.equal(loadBirthdayCandle(), '2026-11-13');
  saveBirthdayCandle('');
  assert.equal(loadBirthdayCandle(), '');

  // Wish capsule
  assert.deepEqual(loadBirthdayWishes(), {});
  saveBirthdayWishes({ 1405: 'سلامتی، آرامش و یادگیری' });
  assert.deepEqual(loadBirthdayWishes(), { 1405: 'سلامتی، آرامش و یادگیری' });

  // Update wish
  const updated = { ...loadBirthdayWishes(), 1406: 'سفر به کوهستان' };
  saveBirthdayWishes(updated);
  assert.equal(loadBirthdayWishes()['1405'], 'سلامتی، آرامش و یادگیری');
  assert.equal(loadBirthdayWishes()['1406'], 'سفر به کوهستان');
});

test('birthdayWorldState aggregates all properties gracefully', () => {
  const dOnBday = jalaliToDate(1405, 8, 15);
  const todayKeyStr = `${dOnBday.getFullYear()}-${String(dOnBday.getMonth() + 1).padStart(2, '0')}-${String(dOnBday.getDate()).padStart(2, '0')}`;

  const st = birthdayWorldState({
    date: dOnBday,
    stored: { y: 1375, m: 8, d: 15 },
    candleDate: todayKeyStr,
    todayKey: todayKeyStr,
    wishes: { 1405: 'آرزوی درخشش' },
  });

  assert.equal(st.hasBirthday, true);
  assert.equal(st.isBirthdayToday, true);
  assert.equal(st.age, 30);
  assert.ok(st.daysLived > 10000);
  assert.equal(st.daysUntil, 0);
  assert.equal(st.candleBlown, true);
  assert.equal(st.currentYear, 1405);
  assert.equal(st.wish, 'آرزوی درخشش');
});

test('CSS: worlds.css birthday styles, logical properties, tokens and reduced-motion rules', () => {
  const css = read('css/worlds.css');

  // Verify core selectors exist
  assert.ok(css.includes('.wc-cake'), 'has .wc-cake');
  assert.ok(css.includes('.wc-flame'), 'has .wc-flame');
  assert.ok(css.includes('.wc-smoke'), 'has .wc-smoke');
  assert.ok(css.includes('.wc-sparkle'), 'has .wc-sparkle');
  assert.ok(css.includes('.wc-bday-stats'), 'has .wc-bday-stats');
  assert.ok(css.includes('.wc-wish-box'), 'has .wc-wish-box');
  assert.ok(css.includes('.wc-wish-input'), 'has .wc-wish-input');
  assert.ok(css.includes('.wc-cake.is-blown'), 'has .wc-cake.is-blown');

  // Verify logical properties (no left / right in birthday card styles)
  const bdayStart = css.indexOf('/* تولد */');
  const bdayEnd = css.indexOf('@media (prefers-reduced-motion:reduce)', bdayStart);
  const bdaySection = css.slice(bdayStart, bdayEnd > 0 ? bdayEnd : undefined);

  assert.ok(!/\bmargin-left\b/.test(bdaySection), 'no margin-left in birthday rules');
  assert.ok(!/\bmargin-right\b/.test(bdaySection), 'no margin-right in birthday rules');
  assert.ok(!/\bpadding-left\b/.test(bdaySection), 'no padding-left in birthday rules');
  assert.ok(!/\bpadding-right\b/.test(bdaySection), 'no padding-right in birthday rules');
  assert.ok(!/#([0-9a-fA-F]{3,8})\b/.test(bdaySection), 'no raw hex colors in birthday CSS section');

  // Verify reduced-motion disables animations
  const redMotionMedia = css.slice(css.indexOf('@media (prefers-reduced-motion:reduce)'));
  assert.ok(redMotionMedia.includes('.wc-flame'), 'prefers-reduced-motion disables .wc-flame');
  assert.ok(redMotionMedia.includes('.wc-smoke'), 'prefers-reduced-motion disables .wc-smoke');
  assert.ok(redMotionMedia.includes('.wc-sparkle'), 'prefers-reduced-motion disables .wc-sparkle');

  const redMotionAttr = css.slice(css.indexOf('html[data-motion="reduced"]'));
  assert.ok(redMotionAttr.includes('.wc-flame'), 'data-motion="reduced" disables .wc-flame');
  assert.ok(redMotionAttr.includes('.wc-smoke'), 'data-motion="reduced" disables .wc-smoke');
});

test('World DOM renderer: renders cake, candles, milestones and wish capsule for tavalod theme', () => {
  const cardEl = {
    hidden: true,
    innerHTML: '',
    dataset: {},
  };

  const origDoc = globalThis.document;
  try {
    globalThis.document = {
      documentElement: { dataset: { theme: 'tavalod' } },
      querySelector: sel => (sel === '#worldCard' ? cardEl : null),
      querySelectorAll: () => [],
      addEventListener: () => {},
    };

    saveBirthday({ y: 1375, m: 8, d: 15 });
    saveBirthdayCandle('');
    saveBirthdayWishes({ 1404: 'آرزوی صلح' });

    renderWorld();

    assert.equal(cardEl.hidden, false);
    assert.equal(cardEl.dataset.world, 'tavalod');

    // Cake SVG rendered
    assert.ok(cardEl.innerHTML.includes('class="wc-cake is-lit"'), 'renders lit cake SVG');
    assert.ok(cardEl.innerHTML.includes('role="button"'), 'cake SVG has role="button" for accessibility');
    assert.ok(cardEl.innerHTML.includes('wc-flame'), 'renders candle flame');
    assert.ok(cardEl.innerHTML.includes('data-w="blow-candle"'), 'has blow-candle action button');

    // Milestones rendered
    assert.ok(cardEl.innerHTML.includes('روز زندگی'), 'renders days lived counter');
    assert.ok(cardEl.innerHTML.includes('سالگی'), 'renders age pill');

    // Wish capsule rendered
    assert.ok(cardEl.innerHTML.includes('wc-wish-box'), 'renders wish box');
    assert.ok(cardEl.innerHTML.includes('data-w="edit-wish"'), 'has edit wish button');

    // Now mark candle as blown today
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    saveBirthdayCandle(todayKey);

    renderWorld();
    assert.ok(cardEl.innerHTML.includes('class="wc-cake is-blown"'), 'renders blown cake SVG');
    assert.ok(cardEl.innerHTML.includes('data-w="relight-candle"'), 'has relight-candle button');
  } finally {
    globalThis.document = origDoc;
  }
});

test('backup integration: mergeBackup merges birthday wishes across years and parseBackup validates object shape', () => {
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

  // Local device has 1404 wish
  const storage = new FakeStorage({
    'daftarche-birthday-wishes': JSON.stringify({ 1404: 'آرزوی صلح' }),
  });

  // Incoming backup has 1403 wish and 1404 wish
  const backup = {
    app: 'daftarche',
    format: 1,
    data: {
      'daftarche-birthday-wishes': JSON.stringify({ 1403: 'شروع یادگیری', 1404: 'آرزوی پشتیبان' }),
    },
  };

  const res = mergeBackup(storage, backup);
  assert.equal(res.ok, true);

  // Local 1404 stands, incoming 1403 is merged
  const merged = JSON.parse(storage.getItem('daftarche-birthday-wishes'));
  assert.equal(merged['1403'], 'شروع یادگیری');
  assert.equal(merged['1404'], 'آرزوی صلح');

  // Invalid non-object shape is rejected
  const badBackup = {
    app: 'daftarche',
    format: 1,
    data: {
      'daftarche-birthday-wishes': JSON.stringify(['not', 'an', 'object']),
    },
  };
  const parseRes = parseBackup(JSON.stringify(badBackup));
  assert.equal(parseRes.ok, false);
});
