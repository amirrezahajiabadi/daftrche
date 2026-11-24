/* The month page's model: where a month starts, what sits on a day, and whether
   the shipped occasion table holds together. The grid is the one thing a reader
   can see is wrong, so it is checked against known Nowruz anchors rather than
   against its own arithmetic. */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monthGrid, monthOccasions, occasionsOf, isHoliday, isFriday, weekdayIndex,
  inRange, RANGE,
} from '../js/calendarmodel.js';
import { TITLES, FIXED, YEARS } from '../js/calendar-data.js';
import { jalaliDaysInMonth, isValidJalaliDate } from '../js/jalali.js';

test('the grid is always six Saturday-first weeks', () => {
  for (const [jy, jm] of [[1403, 12], [1404, 1], [1405, 7], [1406, 12]]) {
    const cells = monthGrid(jy, jm);
    assert.equal(cells.length, 42, `${jy}/${jm}`);
    assert.equal(weekdayIndex(cells[0].jy, cells[0].jm, cells[0].jd), 0, 'first cell is a Saturday');
    for (let i = 0; i < 42; i++) {
      const c = cells[i];
      assert.equal(weekdayIndex(c.jy, c.jm, c.jd), i % 7, `cell ${i} sits in the wrong column`);
    }
  }
});

test('Nowruz 1405 opens the grid: 1 Farvardin is a Saturday', () => {
  const cells = monthGrid(1405, 1);
  assert.deepEqual(cells[0], { jy: 1405, jm: 1, jd: 1, inMonth: true });
  assert.equal(cells.filter(c => c.inMonth).length, 31);
});

test('a month that starts mid-week is padded from the month before', () => {
  const cells = monthGrid(1405, 7);          // 1 Mehr 1405 is a Wednesday
  const first = cells.findIndex(c => c.inMonth);
  assert.equal(first, 4);
  assert.deepEqual(cells[0], { jy: 1405, jm: 6, jd: 28, inMonth: false });
});

test('Esfand follows the leap year, and the grid carries its 30th day', () => {
  assert.equal(jalaliDaysInMonth(1403, 12), 30);
  assert.ok(monthGrid(1403, 12).some(c => c.jy === 1403 && c.jm === 12 && c.jd === 30));
  assert.equal(jalaliDaysInMonth(1404, 12), 29);
  assert.ok(!monthGrid(1404, 12).some(c => c.jy === 1404 && c.jm === 12 && c.jd === 30));
});

test('Nowruz is an official holiday with a title', () => {
  const list = occasionsOf(1405, 1, 1);
  assert.ok(list.length > 0);
  assert.ok(list.some(o => o.holiday && o.title.includes('نوروز')));
});

test('29 Esfand is a holiday, 7 Farvardin is a Friday', () => {
  assert.equal(isHoliday(1403, 12, 29), true);
  assert.equal(isFriday(1405, 1, 7), true);
  assert.equal(isFriday(1405, 1, 1), false);
});

test('a day never repeats an occasion title', () => {
  for (const [year, days] of Object.entries(YEARS)) {
    for (const [key, rows] of Object.entries(days)) {
      const [m, d] = key.split('-').map(Number);
      const titles = occasionsOf(Number(year), m, d).map(o => o.title);
      assert.equal(new Set(titles).size, titles.length, `${year}/${key}: ${titles.join(' | ')}`);
    }
  }
});

test('the month list is in calendar order and stays inside the month', () => {
  const rows = monthOccasions(1405, 1);
  assert.ok(rows.length > 10);
  const days = rows.map(r => r.jd);
  assert.deepEqual(days, [...days].sort((a, b) => a - b));
  assert.ok(days.every(d => d >= 1 && d <= 31));
  assert.ok(rows.some(r => r.jd === 1 && r.holiday));
});

test('the shipped table is well formed', () => {
  assert.ok(RANGE.from <= 1405 && RANGE.to >= 1405, 'the running year is in the table');
  assert.ok(TITLES.length > 0);
  assert.equal(new Set(TITLES).size, TITLES.length, 'a title is interned twice');

  for (const [m, d, id, holiday] of FIXED) {
    assert.ok(isValidJalaliDate(1405, m, d), `fixed ${m}/${d} is not a real date`);
    assert.ok(Number.isInteger(id) && TITLES[id], `fixed ${m}/${d} points at no title`);
    assert.ok(holiday === 0 || holiday === 1);
  }

  for (const [year, days] of Object.entries(YEARS)) {
    const jy = Number(year);
    assert.ok(inRange(jy), `${year} is outside RANGE`);
    for (const [key, rows] of Object.entries(days)) {
      assert.match(key, /^(?:[1-9]|1[0-2])-(?:[1-9]|[12]\d|3[01])$/);
      const [m, d] = key.split('-').map(Number);
      assert.ok(isValidJalaliDate(jy, m, d), `${year}/${key} is not a real date`);
      for (const [id, holiday] of rows) {
        assert.ok(Number.isInteger(id) && TITLES[id], `${year}/${key} points at no title`);
        assert.ok(holiday === 0 || holiday === 1);
      }
    }
  }
});

test('the table runs at least two years past the running one', () => {
  /* The calendar is a wall reference: a reader stepping into next year, or the
     year after, must still find occasions there. These two are the years the
     fill-in database extends the range to.

     Coverage is asked of the merged month, not of YEARS alone: the table is
     solar now, and a month whose only entries were lunar legitimately has no
     row of its own — the fixed solar occasions still answer for it. */
  for (const jy of [1407, 1408]) {
    assert.ok(YEARS[jy], `${jy} is not in the table`);
    const empty = [];
    for (let m = 1; m <= 12; m++) {
      const len = jalaliDaysInMonth(jy, m);
      let n = 0;
      for (let d = 1; d <= len; d++) n += occasionsOf(jy, m, d).length;
      if (!n) empty.push(m);
    }
    assert.deepEqual(empty, [], `${jy} has no occasion at all in months ${empty.join(',')}`);
    let holidays = 0;
    for (const rows of Object.values(YEARS[jy])) holidays += rows.filter(([, h]) => h).length;
    assert.ok(holidays > 0, `${jy} has no holiday at all`);
    assert.equal(inRange(jy), true);
  }
  assert.ok(RANGE.to >= 1408);
});

test('every covered year carries holidays, and the table covers years either side of the range', () => {
  for (const year of Object.keys(YEARS)) {
    let holidays = 0;
    for (const rows of Object.values(YEARS[year])) holidays += rows.filter(([, h]) => h).length;
    assert.ok(holidays > 0, `${year} has no holiday at all`);
  }
  assert.equal(inRange(RANGE.from), true);
  assert.equal(inRange(RANGE.to), true);
  assert.equal(inRange(RANGE.to - 1), true);
  assert.equal(inRange(RANGE.to + 1), false);
  /* A year the table does not cover still answers, from the fixed solar days. */
  assert.ok(occasionsOf(1450, 1, 1).length > 0);
  assert.equal(inRange(1450), false);
});
