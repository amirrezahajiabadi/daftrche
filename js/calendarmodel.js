/* ═══ Persian calendar — the model ═══
   Pure answers, no DOM: which day starts the month, what sits on a given day,
   and what a whole month holds. The view (js/calendar.js) draws these, and the
   tests can ask the same questions without a browser.

   Two sources are merged per day, and the merge is deduped by title, because a
   solar occasion («نوروز») is both in the generated per-year table and in the
   derived fixed one. Fixed exists so a year outside the table — the reader
   browsed far forward — still shows Nowruz and 22 Bahman instead of a blank
   page; the per-year table is what carries the year's own solar rows, the ones
   whose Jalali day moves with the Gregorian calendar they were written on.

   Lunar (Hijri) occasions are not here at all. They move with the moon and
   would need a table that grows every year; this calendar is the official Solar
   Hijri one and Iran's own occasions (js/calendar-data.js). */

import { jalaliToDate, jalaliDaysInMonth } from './jalali.js';
import { TITLES, FIXED, YEARS, RANGE } from './calendar-data.js';

export { RANGE };

/* Gregorian month names, for the small secondary date under a selected day. */
export const GREGORIAN_MONTHS = [
  'ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن',
  'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر',
];

/* Titles are compared with their spaces, Arabic yeh/kaf and all, removed: the
   same occasion is spelled with either letter across the dataset, and a
   duplicate on a day would read as two different occasions. */
const normalize = s => String(s).replace(/\s+/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');

const FIXED_BY_DAY = new Map();
for (const [m, d, id, holiday] of FIXED) {
  const key = `${m}-${d}`;
  const list = FIXED_BY_DAY.get(key) || [];
  list.push([TITLES[id], holiday]);
  FIXED_BY_DAY.set(key, list);
}

const YEAR_BY_DAY = new Map();
for (const [year, days] of Object.entries(YEARS)) {
  for (const [key, rows] of Object.entries(days)) {
    YEAR_BY_DAY.set(`${year}-${key}`, rows.map(([id, holiday]) => [TITLES[id], holiday]));
  }
}

/* Does the shipped table cover this Jalali year? Outside the range only the
   fixed (solar) occasions are known, and the view says so instead of pretending
   the month is empty. */
export const inRange = jy => jy >= RANGE.from && jy <= RANGE.to;

/* Every occasion of one day, in the order the sources list them, without a
   repeated title. `holiday` is the official day off, not the weekend. */
export function occasionsOf(jy, jm, jd) {
  const out = [];
  const seen = new Set();
  const add = (title, holiday) => {
    const key = normalize(title);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ title, holiday: !!holiday });
  };
  for (const [title, holiday] of YEAR_BY_DAY.get(`${jy}-${jm}-${jd}`) || []) add(title, holiday);
  for (const [title, holiday] of FIXED_BY_DAY.get(`${jm}-${jd}`) || []) add(title, holiday);
  return out;
}

/* Saturday is 0, Friday is 6 — the week the app already keeps (js/utils.js). */
export const weekdayIndex = (jy, jm, jd) => (jalaliToDate(jy, jm, jd).getDay() + 1) % 7;

export const isFriday = (jy, jm, jd) => weekdayIndex(jy, jm, jd) === 6;

/* An official day off: Friday, or a day the calendar marks as a holiday. */
export const isHoliday = (jy, jm, jd) =>
  isFriday(jy, jm, jd) || occasionsOf(jy, jm, jd).some(o => o.holiday);

/* ═══ The month grid ═══
   Always six rows of seven, Saturday first. A month that fits in five rows keeps
   its last row of the next month rather than making the page jump by a row every
   time the reader steps from a 31-day month to a 30-day one: the cell a thumb is
   heading for must not move because the month changed under it. */
export function monthGrid(jy, jm) {
  const first = jalaliToDate(jy, jm, 1);
  const offset = (first.getDay() + 1) % 7;   // Saturday-first
  const cells = [];

  let py = jy, pm = jm - 1;
  if (pm < 1) { pm = 12; py -= 1; }
  const prevLen = jalaliDaysInMonth(py, pm);
  for (let i = offset - 1; i >= 0; i--) {
    cells.push({ jy: py, jm: pm, jd: prevLen - i, inMonth: false });
  }

  const len = jalaliDaysInMonth(jy, jm);
  for (let d = 1; d <= len; d++) cells.push({ jy, jm, jd: d, inMonth: true });

  let ny = jy, nm = jm + 1;
  if (nm > 12) { nm = 1; ny += 1; }
  for (let d = 1; cells.length < 42; d++) {
    cells.push({ jy: ny, jm: nm, jd: d, inMonth: false });
  }
  return cells;
}

/* Everything the month page lists, in calendar order: the day number, the title
   and whether that day is an official day off. */
export function monthOccasions(jy, jm) {
  const out = [];
  const len = jalaliDaysInMonth(jy, jm);
  for (let d = 1; d <= len; d++) {
    for (const occasion of occasionsOf(jy, jm, d)) {
      out.push({ jd: d, title: occasion.title, holiday: occasion.holiday });
    }
  }
  return out;
}
