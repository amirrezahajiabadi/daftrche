/* ═══ Build the calendar's occasion table ═══
   The app ships without runtime dependencies and works offline, so the Persian
   occasions are vendored as a module instead of being fetched. This script is
   the only thing that talks to the network, and it runs by hand:

     node scripts/build-occasions.mjs

   Two sources, both transcribed from the official time.ir calendar:

     1. The JSON dataset (api/v1/<gregorian-year>/shamsi.json), which is the
        primary source: it is what the current range is built from.
     2. The mirror's SQLite database (persian_holiday.db), used only for the two
        Jalali years *past* the JSON range — its JSON exports stop at 2028, and
        a calendar that ends next year would answer «مناسبتی نیست» on days that
        have one. Read through node:sqlite (Node 22+); on an older Node the
        extension is skipped with a warning and the committed file stays valid.

   Solar only. The lunar (Hijri) occasions — the religious days that move every
   year — are dropped while reading, because this app is the official Solar Hijri
   calendar and Iran's own occasions. They are also the only reason the table had
   to grow every year, so leaving them out keeps the shipped module small.

   Two things are written:

     · YEARS — every solar occasion of every *complete* Jalali year in the range,
       keyed by year and «month-day». Some solar rows still need a year of their
       own: a world day written on a Gregorian date lands on a moving Jalali day.
     · FIXED — the solar occasions that sit on the same Jalali day every year
       (Nowruz, 13 Bedar, 22 Bahman…). They are *derived* from the same data —
       a title on the same month-day in two different years — rather than typed
       by hand, so their names match the official list instead of a paraphrase.
       They are what keeps a year outside the range from being blank.

   Titles are interned into one array and referenced by index: the same forty
   names repeat hundreds of times, and the module is part of the offline shell. */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { gregorianToJalali } from '../js/jalali.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'js', 'calendar-data.js');

const SOURCE = 'https://raw.githubusercontent.com/drarahimi/persian-holidays/main/api/v1';
const DB_SOURCE = 'https://raw.githubusercontent.com/samanzamani/PersianHoliday/main/persian_holiday.db';

/* Gregorian years to download. Four Jalali years need the files on both sides of
   each Nowruz, so a couple of extra years are fetched and the partial ones are
   dropped below. */
const GREGORIAN_YEARS = [2023, 2024, 2025, 2026, 2027, 2028];

/* How far past the JSON range the database may extend it. Two years keeps a
   wall calendar useful for the years a reader is most likely to browse to, and
   keeps the committed module small. */
const EXTRA_YEARS = 2;

/* A row that only says the week has a weekend is not an occasion: the grid
   already paints Friday. */
const GENERIC = new Set(['جمعه', 'تعطیل', 'تعطیلات', 'روز جمعه']);

/* ── What counts as a solar occasion ──
   The sources mix the two calendars: a religious row is identified by the words
   its title carries (a birthday or martyrdom of an Imam, an Eid, the night of
   Qadr…). A few national dates name a religious figure but sit on a fixed solar
   day — the passing of Imam Khomeini, 14 Khordad — and they are kept by name.

   The mirror also leaks the day into some titles («7 اَمرداد…»), which makes one
   occasion look like two; a title that still starts with a day number is not a
   title. */
const KEEP_NATIONAL = new Set([
  'رحلت حضرت امام خمینی',
  'بازگشت امام خمینی (ره) به ایران',
  'انفجار دفتر حزب جمهوری اسلامی و شهادت دکتر بهشتی و 72 نفر از اعضای حزب؛ روز قوه قضاییه',
  'انفجار دفتر حزب جمهوری اسلامی؛ روز قوه قضاییه',
]);
const RELIGIOUS = /امام|پیامبر|رسول اکرم|حضرت|ولادت|وفات|رحلت|عید سعید|عید فطر|عید قربان|عید غدیر|غدیر|تاسوعا|عاشورا|اربعین|شب قدر|عرفه|مبعث|هجرت|نیمه شعبان|قائم|اهل سنت|ضربت خوردن/;
const DAY_PREFIX = /^\s*[۰-۹\d]+\s/;
const isSolar = title => KEEP_NATIONAL.has(title)
  || (!RELIGIOUS.test(title) && !DAY_PREFIX.test(title));

/* The dataset repeats the lunar or Gregorian date in brackets at the end of many
   titles («… [ ٢٥ رجب ]»). The calendar already shows the Jalali day, so the
   bracket is noise on a 42px cell. */
const trimTitle = title => String(title || '')
  .replace(/\s*\[[^\]]*\]\s*$/, '')
  .replace(/\s+/g, ' ')
  .trim();

const normalize = s => s.replace(/\s+/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');

/* Both sources carry a Jalali date and a Gregorian one. A row whose two dates
   disagree would put an occasion on the wrong square — and the grid is the one
   place that cannot be wrong — so it is dropped. */
function fromDates(jy, jm, jd, gregorian) {
  const m = String(gregorian || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  const back = gregorianToJalali(Number(m[1]), Number(m[2]), Number(m[3]));
  return back.jy === jy && back.jm === jm && back.jd === jd;
}

async function loadYear(year) {
  const url = `${SOURCE}/${year}/shamsi.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const rows = await res.json();
  return rows
    .map(row => {
      const title = trimTitle(row.title_fa);
      const date = String(row.date_shamsi || '');
      const m = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!title || !m || GENERIC.has(title) || !isSolar(title)) return null;
      const jy = Number(m[1]), jm = Number(m[2]), jd = Number(m[3]);
      if (!fromDates(jy, jm, jd, row.date_gregorian)) return null;
      return { jy, jm, jd, title, holiday: !!row.is_holiday };
    })
    .filter(Boolean);
}

/* Every row in the mirror repeats the day it belongs to in front of the title
   («۱ فروردینجشن نوروز/جشن سال نو»), and the first row of each month packs the
   whole month into one cell. So the prefix is removed and the month summary —
   the only row long enough to be one — is dropped. */
const DB_PREFIX = /^\s*[۰-۹\d]+\s+(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)\s*/;
async function loadDatabase(fromYear, toYear) {
  if (toYear < fromYear) return [];
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    console.warn('node:sqlite is unavailable here — keeping the JSON range only');
    return [];
  }
  const res = await fetch(DB_SOURCE);
  if (!res.ok) throw new Error(`${DB_SOURCE} → HTTP ${res.status}`);
  const file = join(tmpdir(), 'daftarche-persian-holiday.db');
  await writeFile(file, Buffer.from(await res.arrayBuffer()));

  const db = new DatabaseSync(file, { readOnly: true });
  let rows;
  try {
    rows = db.prepare(
      'SELECT year, month, day, event, is_holiday, date FROM events WHERE year BETWEEN ? AND ? ORDER BY year, month, day'
    ).all(fromYear, toYear);
  } finally {
    db.close();
  }

  return rows
    .map(row => {
      const raw = String(row.event || '');
      if (raw.length > 120) return null;             // the month-summary row
      const title = trimTitle(raw.replace(DB_PREFIX, ''));
      if (!title || GENERIC.has(title) || !isSolar(title)) return null;
      const jy = Number(row.year), jm = Number(row.month), jd = Number(row.day);
      if (!fromDates(jy, jm, jd, row.date)) return null;
      return { jy, jm, jd, title, holiday: !!row.is_holiday };
    })
    .filter(Boolean);
}

/* A Jalali year is only used when all twelve of its months are present: a
   half-downloaded year would answer «مناسبتی نیست» on days that have one. */
function completeYears(rows) {
  const months = new Map();
  for (const r of rows) {
    const set = months.get(r.jy) || new Set();
    set.add(r.jm);
    months.set(r.jy, set);
  }
  return [...months.entries()]
    .filter(([, set]) => set.size === 12)
    .map(([y]) => y)
    .sort((a, b) => a - b);
}

function interner() {
  const list = [];
  const index = new Map();
  return {
    list,
    id: title => {
      const key = normalize(title);
      if (!index.has(key)) { index.set(key, list.length); list.push(title); }
      return index.get(key);
    },
  };
}

async function main() {
  const rows = [];
  for (const year of GREGORIAN_YEARS) rows.push(...await loadYear(year));

  const jsonYears = completeYears(rows);
  if (!jsonYears.length) throw new Error('No complete Jalali year in the download');

  /* Then the years the JSON export does not reach, from the mirror's database. */
  const lastJson = jsonYears[jsonYears.length - 1];
  const extra = await loadDatabase(lastJson + 1, lastJson + EXTRA_YEARS);
  const all = rows.concat(extra);

  const years = completeYears(all);
  if (!years.length) throw new Error('No complete Jalali year after both sources');

  const names = interner();
  const byYear = new Map(years.map(y => [y, new Map()]));
  const seen = new Set();
  for (const r of all) {
    if (!byYear.has(r.jy)) continue;
    const bucket = byYear.get(r.jy);
    const key = `${r.jm}-${r.jd}`;
    const list = bucket.get(key) || [];
    const id = names.id(r.title);
    const stamp = `${r.jy}|${key}|${id}`;
    /* The same title can be listed twice on one day by a source. */
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    list.push([id, r.holiday ? 1 : 0]);
    bucket.set(key, list);
  }

  /* Fixed occasions: the same normalized title on the same month-day in two
     different years. They cover years outside the table, and merging is safe
     because the app drops a duplicate title on a day.

     Only the primary dataset decides what is fixed. A Gregorian-fixed title
     («روز جهانی شادی», March 20) can land on the same Jalali day two years
     running, and deriving from the fill-in years would then print it on a day
     it does not belong to in every other year. The fill-in years contribute
     their own rows to YEARS and nothing to this table. */
  const fixedKey = new Map();
  for (const r of rows) {
    if (!byYear.has(r.jy)) continue;
    const key = `${normalize(r.title)}|${r.jm}-${r.jd}`;
    const entry = fixedKey.get(key) || { m: r.jm, d: r.jd, title: r.title, years: new Set(), holiday: false };
    entry.years.add(r.jy);
    entry.holiday = entry.holiday || r.holiday;
    fixedKey.set(key, entry);
  }
  const fixed = [...fixedKey.values()]
    .filter(e => e.years.size >= 2)
    .sort((a, b) => a.m - b.m || a.d - b.d)
    .map(e => [e.m, e.d, names.id(e.title), e.holiday ? 1 : 0]);

  const yearsOut = years.map(y => {
    const bucket = byYear.get(y);
    const days = [...bucket.keys()]
      .sort((a, b) => {
        const [am, ad] = a.split('-').map(Number);
        const [bm, bd] = b.split('-').map(Number);
        return am - bm || ad - bd;
      })
      .map(key => `'${key}':[${bucket.get(key).map(([id, h]) => `[${id},${h}]`).join(',')}]`);
    return `  ${y}:{\n    ${days.join(',\n    ')}\n  }`;
  });

  const out = `/* ═══ Persian calendar occasions — generated, do not edit by hand ═══
   Written by scripts/build-occasions.mjs from the public Iranian calendar data
   transcribed from time.ir:

     ${SOURCE}/<gregorian-year>/shamsi.json
     ${DB_SOURCE}
     (the database is read only for the ${EXTRA_YEARS} years past the JSON export)

   Solar only. The official Solar Hijri calendar and Iran's own occasions are
   what this app is for, so the lunar (Hijri) occasions — the religious days that
   move every year — are left out at build time. A handful of national dates
   whose names mention a religious figure (Imam Khomeini's passing, 14 Khordad…)
   are solar, fixed, and stay.

   Structure:
     TITLES — every occasion name once; the rows below point into it.
     FIXED  — [month, day, titleId, holiday] the same Jalali day every year.
              Carried for years outside RANGE.
     YEARS  — { jalali year: { 'month-day': [[titleId, holiday], …] } }. Solar
              rows whose Jalali day moves with their Gregorian date live here.
     RANGE  — the Jalali years YEARS covers.
   Generated: ${new Date().toISOString().slice(0, 10)} */

export const TITLES = [
${names.list.map(t => `  ${JSON.stringify(t)}`).join(',\n')}
];

export const RANGE = { from: ${years[0]}, to: ${years[years.length - 1]} };

export const FIXED = [
${fixed.map(([m, d, id, h]) => `  [${m}, ${d}, ${id}, ${h}]`).join(',\n')}
];

export const YEARS = {
${yearsOut.join(',\n')}
};
`;

  await writeFile(OUT, out, 'utf8');
  console.log(`js/calendar-data.js: ${names.list.length} titles, ${fixed.length} fixed, years ${years.join(', ')}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
