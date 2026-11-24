/* The numbers behind the worlds (js/worlds-data.js). */
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lastDays, radarPoints, ringPoints, plantStage, weekDone, shipProgress,
  clampGoal, stepGoal, WEEK_GOALS, orbitProgress, flightHours, weekdayLetter,
  miniatureStage, summitAltitude, elixirElements, constellationDays, simorghActiveDays,
  birthdayMatch, daysLived, currentAge, nextBirthdayCountdown, birthdayWorldState, WORLDS_DATA,
} from '../js/worlds-data.js';
import { WORLDS } from '../js/worlds.js';
import { jalaliToDate } from '../js/jalali.js';

const days = [
  { key: '2026-10-17', done: 2, focusMin: 0 }, { key: '2026-10-20', done: 5, focusMin: 30 },
  { key: '2026-10-22', done: 1, focusMin: 10 }, { key: '2026-10-23', done: 3, focusMin: 45 },
];

test('lastDays: seven consecutive days, oldest first, zeros for quiet days', () => {
  const r = lastDays(days, '2026-10-23', 7);
  assert.equal(r.length, 7);
  assert.equal(r[0].key, '2026-10-17');
  assert.equal(r[6].key, '2026-10-23');
  assert.deepEqual(r.map(d => d.done), [2, 0, 0, 5, 0, 1, 3]);
  assert.equal(lastDays([], '2026-10-23', 3).every(d => d.done === 0), true);
});

test('radar: first vertex is at the top, the busiest day reaches the rim, empty days keep a stub', () => {
  const pts = radarPoints([0, 4, 2], 100, 100, 50);
  assert.equal(pts.length, 3);
  assert.equal(pts[0].x, 100);
  assert.ok(pts[0].y < 100 && pts[0].y > 100 - 50 * 0.2, 'an empty day is a small stub above the centre');
  const rim = Math.hypot(pts[1].x - 100, pts[1].y - 100);
  assert.ok(Math.abs(rim - 50) < 0.2);
  const ring = ringPoints(7, 0, 0, 10);
  assert.ok(ring.every(p => Math.abs(Math.hypot(p.x, p.y) - 10) < 0.1));
});

test('plant: five stages from nothing planted to bloom', () => {
  assert.equal(plantStage(0, 0), 0);
  assert.equal(plantStage(0, 5), 0);
  assert.equal(plantStage(1, 5), 1);
  assert.equal(plantStage(2, 5), 2);
  assert.equal(plantStage(3, 5), 3);
  assert.equal(plantStage(5, 5), 4);
  assert.equal(plantStage(9, 5), 4, 'over-done is still a bloom, not an error');
});

test('voyage: the week sums from its first day, the ship stops at the port', () => {
  assert.equal(weekDone(days, '2026-10-17', '2026-10-23'), 11);
  assert.equal(weekDone(days, '2026-10-21', '2026-10-23'), 4);
  assert.equal(shipProgress(5, 10), 0.5);
  assert.equal(shipProgress(50, 10), 1);
  assert.equal(shipProgress(3, 0), 1);
  assert.equal(clampGoal('nonsense'), 10);
  assert.equal(clampGoal('15'), 15);
  assert.equal(stepGoal(10, 1), 15);
  assert.equal(stepGoal(5, -1), 5, 'cannot go below the smallest goal');
  assert.equal(stepGoal(30, 1), 30);
  assert.deepEqual([...WEEK_GOALS], [5, 10, 15, 20, 30]);
});

test('flight log: hours are whole hours, the orbit is capped at one lap', () => {
  assert.equal(flightHours(119), 1);
  assert.equal(flightHours(0), 0);
  assert.equal(orbitProgress(50, 25), 1);
  assert.equal(orbitProgress(10, 25), 0.4);
  assert.equal(weekdayLetter('2026-10-23'), 'ج'); // a Friday
});

test('miniature: six stages based on score', () => {
  assert.equal(miniatureStage(0), 0);
  assert.equal(miniatureStage(1), 1);
  assert.equal(miniatureStage(4), 2);
  assert.equal(miniatureStage(8), 3);
  assert.equal(miniatureStage(12), 4);
  assert.equal(miniatureStage(20), 5);
});

test('summit altitude: 0 to 7 active days reach 5610m', () => {
  assert.equal(summitAltitude(0), 1800);
  assert.equal(summitAltitude(1), 2400);
  assert.equal(summitAltitude(4), 4200);
  assert.equal(summitAltitude(7), 5610);
});

test('elixir elements: three daily components', () => {
  assert.deepEqual(elixirElements({ doneCount: 0, focusMin: 0, hasSpirit: false }),
    { count: 0, work: false, focus: false, spirit: false, complete: false });
  assert.deepEqual(elixirElements({ doneCount: 1, focusMin: 14, hasSpirit: false }),
    { count: 1, work: true, focus: false, spirit: false, complete: false });
  assert.deepEqual(elixirElements({ doneCount: 2, focusMin: 25, hasSpirit: true }),
    { count: 3, work: true, focus: true, spirit: true, complete: true });
});

test('constellation: 7 days of the week', () => {
  const stars = constellationDays(days, '2026-10-17', '2026-10-23');
  assert.equal(stars.length, 7);
  assert.equal(stars[0].key, '2026-10-17');
  assert.equal(stars[0].active, true);
  assert.equal(stars[1].key, '2026-10-18');
  assert.equal(stars[1].active, false);
  assert.equal(stars[6].key, '2026-10-23');
  assert.equal(stars[6].isToday, true);
});

test('simorgh: active days in last 30 days', () => {
  assert.equal(simorghActiveDays(days, '2026-10-23'), 4);
});

test('tavalod world registration in WORLDS and WORLDS_DATA', () => {
  assert.ok(WORLDS.has('tavalod'), 'tavalod is registered in WORLDS set');
  assert.ok(WORLDS_DATA.tavalod, 'tavalod is registered in WORLDS_DATA');
  assert.equal(WORLDS_DATA.tavalod.id, 'tavalod');
  assert.equal(WORLDS_DATA.tavalod.title, 'جشن تولد');
  assert.equal(WORLDS_DATA.tavalod.icon, 'cake');
  assert.equal(typeof WORLDS_DATA.tavalod.computeState, 'function');
});

test('tavalod calculations: birthdayMatch, daysLived, currentAge, nextBirthdayCountdown', () => {
  const bday = { y: 1375, m: 8, d: 15 };
  const dOnBday = jalaliToDate(1405, 8, 15);
  const dBeforeBday = jalaliToDate(1405, 8, 10);
  const dAfterBday = jalaliToDate(1405, 8, 20);

  // Match
  assert.equal(birthdayMatch(dOnBday, bday), true);
  assert.equal(birthdayMatch(dBeforeBday, bday), false);
  assert.equal(birthdayMatch(dAfterBday, bday), false);

  // Age calculations: increments on birthday, not on Nowruz
  assert.equal(currentAge(dOnBday, bday), 30);
  assert.equal(currentAge(dBeforeBday, bday), 29);
  assert.equal(currentAge(dAfterBday, bday), 30);
  assert.equal(currentAge(jalaliToDate(1405, 1, 1), bday), 29);
  assert.equal(currentAge(jalaliToDate(1406, 1, 1), bday), 30);
  assert.equal(currentAge(dOnBday, { m: 8, d: 15 }), null);

  // Days lived
  const lived = daysLived(dOnBday, bday);
  assert.ok(lived > 10000, `days lived should be ~10957, got ${lived}`);
  assert.equal(daysLived(dOnBday, { m: 8, d: 15 }), null, 'no birth year means no days lived calculation');
  assert.equal(daysLived(dOnBday, null), null);

  // Countdown
  assert.equal(nextBirthdayCountdown(dOnBday, bday), 0, '0 days on birthday');
  assert.equal(nextBirthdayCountdown(dBeforeBday, bday), 5, '5 days before birthday');
  const afterCount = nextBirthdayCountdown(dAfterBday, bday);
  assert.ok(afterCount > 350 && afterCount < 366, `days until next year birthday should be ~360, got ${afterCount}`);

  // Countdown works without birth year
  assert.equal(nextBirthdayCountdown(dBeforeBday, { m: 8, d: 15 }), 5);

  // 30 Esfand leap year handling
  const bday30Esfand = { m: 12, d: 30 };
  const d1403_12_30 = jalaliToDate(1403, 12, 30); // leap year
  assert.equal(birthdayMatch(d1403_12_30, bday30Esfand), true);
  assert.equal(nextBirthdayCountdown(d1403_12_30, bday30Esfand), 0);

  const d1404_12_29 = jalaliToDate(1404, 12, 29); // common year celebrated on 29th
  assert.equal(birthdayMatch(d1404_12_29, bday30Esfand), true);
  assert.equal(nextBirthdayCountdown(d1404_12_29, bday30Esfand), 0);
});

test('tavalod state aggregation and candle blown persistence', () => {
  const dOnBday = jalaliToDate(1405, 8, 15);
  const todayKeyStr = `${dOnBday.getFullYear()}-${String(dOnBday.getMonth() + 1).padStart(2, '0')}-${String(dOnBday.getDate()).padStart(2, '0')}`;

  const stateUnblown = birthdayWorldState({
    date: dOnBday,
    stored: { y: 1375, m: 8, d: 15 },
    candleDate: '',
    todayKey: todayKeyStr,
    wishes: { 1405: 'آرزوی صلح و سلامتی' },
  });

  assert.equal(stateUnblown.hasBirthday, true);
  assert.equal(stateUnblown.isBirthdayToday, true);
  assert.equal(stateUnblown.age, 30);
  assert.equal(stateUnblown.candleBlown, false);
  assert.equal(stateUnblown.wish, 'آرزوی صلح و سلامتی');

  const stateBlown = birthdayWorldState({
    date: dOnBday,
    stored: { y: 1375, m: 8, d: 15 },
    candleDate: todayKeyStr,
    todayKey: todayKeyStr,
  });
  assert.equal(stateBlown.candleBlown, true);

  // Candle date from a different day means unblown today
  const stateOldCandle = birthdayWorldState({
    date: dOnBday,
    stored: { y: 1375, m: 8, d: 15 },
    candleDate: '2026-01-01',
    todayKey: todayKeyStr,
  });
  assert.equal(stateOldCandle.candleBlown, false);
});
