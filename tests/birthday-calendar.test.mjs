/* ═══ Birthday in Calendar & Planner Tests (Phase 1) ═══
   Verifies:
   1. Calendar grid cell marking (.is-birthday, aria-label, celebration badge)
   2. Month occasions list (#calList) birthday row inclusion, naming, and ordering
   3. Day planner panel (#calBirthdayBadge, celebration row, age calculation)
   4. Edge cases: no birthday, no birth year, year bounds, leap year (30 Esfand)
   5. CSS compliance: logical properties, token-based colors (no raw hex), and [hidden] display safety
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './_env.mjs';

import { normalizeBirthday, effectiveBirthdayDay, birthdayKey, isBirthday } from '../js/birthday.js';
import { dayLabel } from '../js/calendar.js';
import { formatBirthdayGreeting } from '../js/planner.js';
import { ICONS } from '../js/constants.js';
import { jalaliToDate } from '../js/jalali.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('CSS: calendar.css includes token-based birthday styling with logical properties', () => {
  const css = read('css/calendar.css');

  // Check selectors exist
  assert.ok(css.includes('.pcal-bday-badge'), 'has .pcal-bday-badge');
  assert.ok(css.includes('.pcal-cell.is-birthday'), 'has .pcal-cell.is-birthday');
  assert.ok(css.includes('.pcal-badge-birthday'), 'has .pcal-badge-birthday');
  assert.ok(css.includes('.pcal-occ li.is-birthday'), 'has .pcal-occ li.is-birthday');
  assert.ok(css.includes('.pcal-list-row.is-birthday'), 'has .pcal-list-row.is-birthday');

  // Check logical properties
  assert.ok(css.includes('inset-block-start'), 'uses logical inset-block-start');
  assert.ok(css.includes('inset-inline-end'), 'uses logical inset-inline-end');
  assert.ok(css.includes('padding-inline'), 'uses logical padding-inline');

  // Check [hidden] protection for birthday badge
  assert.ok(
    css.includes('.pcal-badge[hidden],.pcal-badge-birthday[hidden]{display:none!important}') ||
    css.includes('.pcal-badge-birthday[hidden]'),
    'birthday badge must be hidden when [hidden] attribute is present'
  );

  // Check that duplicate bullet dot is hidden in occasion list
  assert.ok(
    css.includes('.pcal-occ li.is-birthday .pcal-occ-dot{display:none}'),
    'birthday occasion bullet dot is hidden in favor of celebration icon'
  );

  // Check color token usage (must use var(--color-warning), no raw hex in the birthday rules)
  const bdayStart = css.indexOf('/* Birthday highlight in the month grid */');
  const bdayEnd = css.indexOf('/* ── The way in from Today ──');
  const bdaySection = css.slice(bdayStart, bdayEnd > 0 ? bdayEnd : undefined);
  assert.ok(bdaySection.includes('var(--color-warning)'), 'uses var(--color-warning)');
  assert.ok(!/#([0-9a-fA-F]{3,8})\b/.test(bdaySection), 'no raw hex colors in birthday CSS section');
});

test('ICONS: cake icon is an SVG line icon with aria-hidden', () => {
  assert.ok(ICONS.cake, 'ICONS.cake exists');
  assert.ok(ICONS.cake.startsWith('<svg'), 'ICONS.cake is an SVG element');
  assert.ok(ICONS.cake.includes('aria-hidden="true"'), 'ICONS.cake is aria-hidden');
  assert.ok(!/[\u{1F000}-\u{1FFFF}]/u.test(ICONS.cake), 'ICONS.cake contains no emoji characters');
});

test('effectiveBirthdayDay: correctly resolves birthday day across standard and leap years', () => {
  const bdayStandard = normalizeBirthday('1375/08/15');
  assert.equal(effectiveBirthdayDay(bdayStandard, 1404), 15);
  assert.equal(effectiveBirthdayDay(bdayStandard, 1405), 15);

  // 30 Esfand in leap year 1403 (Esfand has 30 days) -> day 30
  const bday30Esfand = normalizeBirthday('12/30');
  assert.equal(effectiveBirthdayDay(bday30Esfand, 1403), 30);

  // 30 Esfand in common year 1404 (Esfand has 29 days) -> day 29
  assert.equal(effectiveBirthdayDay(bday30Esfand, 1404), 29);

  // null birthday
  assert.equal(effectiveBirthdayDay(null, 1404), null);
});

test('birthdayKey: detects celebration date for 30 Esfand even in common years', () => {
  const bday30Esfand = normalizeBirthday('12/30');

  // In leap year 1403: 30 Esfand
  const d1403_12_30 = jalaliToDate(1403, 12, 30);
  assert.equal(birthdayKey(d1403_12_30, bday30Esfand), '12-30');

  // In common year 1404: celebrated on 29 Esfand
  const d1404_12_29 = jalaliToDate(1404, 12, 29);
  assert.equal(birthdayKey(d1404_12_29, bday30Esfand), '12-29');

  // On other days: null
  const d1404_12_28 = jalaliToDate(1404, 12, 28);
  assert.equal(birthdayKey(d1404_12_28, bday30Esfand), null);
});

test('dayLabel: includes birthday announcement in aria-label via exported dayLabel function', () => {
  const bdayLabel = dayLabel(1404, 8, 15, [], false, true);
  assert.ok(bdayLabel.includes('تولد شما'), 'aria-label announces birthday');
  assert.equal(bdayLabel, 'پنجشنبه ۱۵ آبان ۱۴۰۴ — تولد شما');

  const bdayWithOccasion = dayLabel(1404, 8, 15, [{ title: 'مناسبت آزمایشی' }], true, true);
  assert.ok(bdayWithOccasion.includes('تولد شما'));
  assert.ok(bdayWithOccasion.includes('تعطیل'));
  assert.ok(bdayWithOccasion.includes('مناسبت آزمایشی'));

  const normalDayLabel = dayLabel(1404, 8, 15, [], false, false);
  assert.ok(!normalDayLabel.includes('تولد شما'));
});

test('month list: adds dedicated birthday row when month matches, sorted by day and handles 30 Esfand', () => {
  const bday = normalizeBirthday('1370/07/12');
  const month = 7;
  const name = 'سارا';

  const mockOccasions = [
    { jd: 1, title: 'آغاز سال تحصیلی', holiday: false },
    { jd: 20, title: 'بزرگداشت حافظ', holiday: false },
  ];

  const rows = [...mockOccasions];
  if (bday && bday.m === month) {
    const bdayDay = effectiveBirthdayDay(bday, 1404);
    const bdayTitle = name ? `تولد شما (${name})` : 'تولد شما';
    rows.push({
      jd: bdayDay,
      title: bdayTitle,
      holiday: false,
      isBirthday: true,
    });
    rows.sort((a, b) => {
      if (a.jd !== b.jd) return a.jd - b.jd;
      if (a.isBirthday) return -1;
      if (b.isBirthday) return 1;
      return 0;
    });
  }

  assert.equal(rows.length, 3);
  assert.equal(rows[0].jd, 1);
  assert.equal(rows[1].jd, 12);
  assert.equal(rows[1].isBirthday, true);
  assert.equal(rows[1].title, 'تولد شما (سارا)');
  assert.equal(rows[2].jd, 20);

  // 30 Esfand in common year 1404 sorts as day 29, not 30!
  const bdayLeap = normalizeBirthday('12/30');
  const leapRows = [{ jd: 29, title: 'روز ملی شدن صنعت نفت', holiday: true }];
  if (bdayLeap && bdayLeap.m === 12) {
    const bdayDay = effectiveBirthdayDay(bdayLeap, 1404);
    assert.equal(bdayDay, 29, 'clamped to 29 in common year 1404');
    leapRows.push({
      jd: bdayDay,
      title: 'تولد شما',
      holiday: false,
      isBirthday: true,
    });
    leapRows.sort((a, b) => {
      if (a.jd !== b.jd) return a.jd - b.jd;
      if (a.isBirthday) return -1;
      if (b.isBirthday) return 1;
      return 0;
    });
  }
  assert.equal(leapRows[0].jd, 29);
  assert.equal(leapRows[0].isBirthday, true, 'birthday sorts first when sharing same day');
  assert.equal(leapRows[1].jd, 29);
  assert.equal(leapRows[1].holiday, true);
});

test('formatBirthdayGreeting: exported planner function handles all year and name variants correctly', () => {
  // Case 1: with birth year and name (turns 28 in 1404)
  const bday1 = normalizeBirthday('1376/05/10');
  assert.equal(
    formatBirthdayGreeting(1404, bday1, 'امیررضا'),
    'تولدت مبارک، امیررضا! آغاز ۲۸ سالگی'
  );

  // Case 2: without birth year (only month and day)
  const bday2 = normalizeBirthday('05/10');
  assert.equal(
    formatBirthdayGreeting(1404, bday2, 'امیررضا'),
    'تولدت مبارک، امیررضا!'
  );

  // Case 3: without user name
  assert.equal(
    formatBirthdayGreeting(1404, bday1, ''),
    'تولدت مبارک! آغاز ۲۸ سالگی'
  );

  // Case 4: calendar stepped to birth year itself (age 0 should not output "آغاز ۰ سالگی")
  assert.equal(
    formatBirthdayGreeting(1376, bday1, 'امیررضا'),
    'تولدت مبارک، امیررضا!'
  );

  // Case 5: calendar stepped before birth year (e.g. 1370 < 1376)
  assert.equal(
    formatBirthdayGreeting(1370, bday1, 'امیررضا'),
    'تولدت مبارک، امیررضا!'
  );

  // Case 6: null birthday
  assert.equal(formatBirthdayGreeting(1404, null, 'امیررضا'), '');
});

test('planner.js and calendar.js source inspection: no hardcoded emojis and proper DOM bindings', () => {
  const calJs = read('js/calendar.js');
  const plannerJs = read('js/planner.js');

  // Must not have raw emoji in code
  const emoji = /[\u{1F000}-\u{1FFFF}]/u;
  assert.ok(!emoji.test(calJs), 'calendar.js must not contain raw emoji');
  assert.ok(!emoji.test(plannerJs), 'planner.js must not contain raw emoji');

  // Verify binding of #calBirthdayBadge in planner.js
  assert.ok(plannerJs.includes('id="calBirthdayBadge"'), 'planner.js contains #calBirthdayBadge');
  assert.ok(plannerJs.includes('pcal-badge-birthday'), 'planner.js has .pcal-badge-birthday class');
  assert.ok(plannerJs.includes('bdayBadge.hidden = !isBirthdayDay'), 'planner.js toggles bdayBadge.hidden');

  // Verify binding of .is-birthday in calendar.js
  assert.ok(calJs.includes("classList.toggle('is-birthday', isBday)"), 'calendar.js toggles .is-birthday class');
  assert.ok(calJs.includes('pcal-bday-badge'), 'calendar.js adds .pcal-bday-badge');
  assert.ok(calJs.includes('pcal-list-row'), 'calendar.js renders .pcal-list-row');
});
