/* ═══ تقویم — the month, and the day under it ═══
   One page, not two zooms. The grid is the month the reader scans; the panel
   beside it is the day they work on, with the occasions a grid cell cannot
   spell out. A week and a month of the same days is one page read at one size,
   so the switch that used to sit between them is gone — the day is chosen where
   it is seen.

   Everything is in memory: which month, which day. Opening the app again lands
   on today, the way a wall calendar is looked at.

   Class names carry the `pcal-` prefix because `.cal-*` already belongs to the
   two date pickers (js/jalalical.js); see css/calendar.css. The day panel is
   js/planner.js's, because that is where the planning already lived.

   The grid is rebuilt on every month change (forty-two buttons, nothing that
   holds a caret), and the selected cell is the page's single tab stop, moved
   with the arrow keys. Each cell also wears the day's plan: a 3px bar that
   fills with what is done, and the place a task can be dragged onto. */

import { $, esc, faNum, faDigits, dayKey, dateFromKey, WEEKDAYS_SHORT } from './utils.js';
import {
  dateToJalali, jalaliToDate, jalaliDaysInMonth, JALALI_MONTHS,
} from './jalali.js';
import { renderPlanner, focusPlannerDay, setMonthDrop } from './planner.js';
import { state } from './state.js';
import { subscribe } from './bus.js';
import { RANGE, monthGrid, monthOccasions, occasionsOf, isFriday, inRange } from './calendarmodel.js';
import { loadBirthday, loadName } from './store.js';
import { normalizeBirthday, effectiveBirthdayDay } from './birthday.js';
import { ICONS } from './constants.js';
import { mountSelectMenu } from './pickmenu.js';

const todayJ = () => dateToJalali(new Date());
const sameDay = (a, b) => !!a && !!b && a.jy === b.jy && a.jm === b.jm && a.jd === b.jd;

const weekdayName = (jy, jm, jd) =>
  new Intl.DateTimeFormat('fa-IR', { weekday: 'long' }).format(jalaliToDate(jy, jm, jd));

const fullDate = (jy, jm, jd) =>
  `${weekdayName(jy, jm, jd)} ${faNum(jd)} ${JALALI_MONTHS[jm - 1]} ${faDigits(jy)}`;

let view = null;   // { jy, jm } — the month on screen
let sel = null;    // { jy, jm, jd } — the day open under the grid
let built = false;

/* The month's own view of the task data: one fill per visible day, and the day
   elements a drag can land on. Both are rebuilt with the grid. */
const planFills = new Map();   // day key → { cell, fill }
let monthZones = new Map();    // day key → cell

function resetToToday() {
  const t = todayJ();
  view = { jy: t.jy, jm: t.jm };
  sel = { jy: t.jy, jm: t.jm, jd: t.jd };
}

/* ═══ The frame ═══ */
function buildShell() {
  if (built) return;
  built = true;

  const dow = $('#calDow');
  if (dow) dow.innerHTML = WEEKDAYS_SHORT.map(d => `<span>${d}</span>`).join('');

  const bar = $('#calBar');
  if (bar) {
    /* The year is a list beside the month's name, not another pair of arrows:
       «فروردین» is what a step walks through, and a year is the jump that
       leaves it behind — eight years of months is ninety-six presses. Built
       once, so opening the list never rebuilds the control being used. The
       list wears the app's own pill (js/pickmenu.js) instead of the phone's
       system menu, which painted a white sheet over this page. */
    const years = [];
    for (let y = RANGE.from; y <= RANGE.to; y++) {
      years.push(`<option value="${y}">${faDigits(y)}</option>`);
    }
    bar.innerHTML = `
      <div class="pcal-head">
        <button class="pcal-nav" type="button" data-move="1" aria-label="ماه بعد" title="ماه بعد">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6l-6 6 6 6"/></svg>
        </button>
        <span class="pcal-title">
          <span class="pcal-range" id="calRange"></span>
          <select class="pcal-year" id="calYear" aria-label="سال">${years.join('')}</select>
        </span>
        <button class="pcal-nav" type="button" data-move="-1" aria-label="ماه قبل" title="ماه قبل">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6l6 6-6 6"/></svg>
        </button>
      </div>
      <p class="pcal-sub" id="calSub"></p>`;

    bar.addEventListener('click', e => {
      const nav = e.target.closest('[data-move]');
      if (nav) stepMonth(Number(nav.dataset.move));
    });

    /* The button under the grid, not in the bar: it is the page's one way back
       to today, so it sits where a thumb already is. */
    $('#calTodayBtn')?.addEventListener('click', goToday);

    /* `change`, not `input`: a native list on a phone fires input while the
       wheel is still moving, which would repaint the grid on every notch. */
    bar.addEventListener('change', e => {
      if (e.target.id === 'calYear') goYear(Number(e.target.value));
    });

    mountSelectMenu($('#calYear'));
  }

  const grid = $('#calGrid');
  grid?.addEventListener('click', e => {
    const cell = e.target.closest('.pcal-cell');
    if (cell) select(Number(cell.dataset.jy), Number(cell.dataset.jm), Number(cell.dataset.jd));
  });
  grid?.addEventListener('keydown', onGridKey);

  $('#calList')?.addEventListener('click', e => {
    const row = e.target.closest('[data-jd]');
    if (row) select(Number(row.dataset.jy), Number(row.dataset.jm), Number(row.dataset.jd));
  });
}

/* ═══ Moving ═══ */
function select(jy, jm, jd) {
  sel = { jy, jm, jd };
  if (view.jy !== jy || view.jm !== jm) view = { jy, jm };
  renderCalendar();
}

function goToday() {
  resetToToday();
  renderCalendar();
  focusSelected();
}

function focusSelected() {
  $('#calGrid .pcal-cell.sel')?.focus({ preventScroll: true });
}

/* One day forward or back, across month and year edges. The Gregorian Date
   object does the arithmetic so leap years are never reimplemented here. */
function stepDays(delta) {
  if (!sel) resetToToday();
  const d = jalaliToDate(sel.jy, sel.jm, sel.jd);
  d.setDate(d.getDate() + delta);
  const j = dateToJalali(d);
  select(j.jy, j.jm, j.jd);
  focusSelected();
}

function stepMonth(delta) {
  if (!view) resetToToday();
  let jy = view.jy, jm = view.jm + delta;
  while (jm > 12) { jm -= 12; jy += 1; }
  while (jm < 1) { jm += 12; jy -= 1; }
  view = { jy, jm };
  sel = { jy, jm, jd: Math.min(sel ? sel.jd : 1, jalaliDaysInMonth(jy, jm)) };
  renderCalendar();
}

/* The bar's year list: the same month, another year. The chosen day comes along
   when the month on screen has it — 31 Farvardin has no twin in Mehr — and the
   month itself is kept, because a reader who jumped to next year is looking for
   this month of it, not for Farvardin. */
function goYear(jy) {
  if (!view || !sel) resetToToday();
  const jm = view.jm;
  view = { jy, jm };
  sel = { jy, jm, jd: Math.min(sel.jd, jalaliDaysInMonth(jy, jm)) };
  renderCalendar();
}

/* ← is the next day and → the day before, because the page reads right to left;
   ↑/↓ are the same week one row up or down. PageUp/PageDown step the month and
   Home is the way back to today. */
function onGridKey(e) {
  if (!e.target.closest('.pcal-cell')) return;
  let handled = true;
  switch (e.key) {
    case 'ArrowLeft': stepDays(1); break;
    case 'ArrowRight': stepDays(-1); break;
    case 'ArrowUp': stepDays(-7); break;
    case 'ArrowDown': stepDays(7); break;
    case 'Home': goToday(); break;
    case 'PageUp': stepMonth(-1); break;
    case 'PageDown': stepMonth(1); break;
    default: handled = false;
  }
  if (handled) e.preventDefault();
}

/* ═══ The bar ═══
   The Gregorian and Hijri ranges under the Persian month, the way a paper
   calendar prints them. Both are ranges because a Jalali month starts and ends
   inside different Gregorian or Hijri months often enough that one name would be
   a lie; Intl does both conversions, so neither is reimplemented here. */
const calParts = (date, calendar) => {
  const parts = new Intl.DateTimeFormat(`fa-IR-u-ca-${calendar}`, { month: 'long', year: 'numeric' })
    .formatToParts(date);
  const out = {};
  for (const p of parts) if (p.type === 'month' || p.type === 'year') out[p.type] = p.value;
  return out;
};

function spanLabel(from, to, calendar) {
  const a = calParts(from, calendar);
  const b = calParts(to, calendar);
  if (a.month === b.month && a.year === b.year) return `${a.month} ${a.year}`;
  if (a.year === b.year) return `${a.month} – ${b.month} ${b.year}`;
  return `${a.month} ${a.year} – ${b.month} ${b.year}`;
}

function renderBar() {
  buildShell();
  const range = $('#calRange');
  if (!range) return;
  range.textContent = JALALI_MONTHS[view.jm - 1];

  const year = $('#calYear');
  if (year) {
    const value = String(view.jy);
    /* A year the table stops short of — the app being read years after this
       build — joins the list instead of leaving the control showing nothing. */
    if (!Array.from(year.options).some(o => o.value === value)) {
      year.add(new Option(faDigits(view.jy), value));
    }
    year.value = value;
    /* The pill shows the select's own chosen text; a year the reader reached
       with the arrows must show up there too, not only in the grid. */
    year.__smSync?.();
  }

  const sub = $('#calSub');
  if (sub) {
    const from = jalaliToDate(view.jy, view.jm, 1);
    const to = jalaliToDate(view.jy, view.jm, jalaliDaysInMonth(view.jy, view.jm));
    sub.replaceChildren(
      Object.assign(document.createElement('span'), { textContent: spanLabel(from, to, 'gregory') }),
      Object.assign(document.createElement('span'), { textContent: spanLabel(from, to, 'islamic') }),
    );
  }
}

/* ═══ The grid ═══ */
export function dayLabel(jy, jm, jd, occasions, off, isBday) {
  const parts = [fullDate(jy, jm, jd)];
  if (isBday) parts.push('تولد شما');
  if (off) parts.push('تعطیل');
  if (occasions.length) parts.push(occasions.map(o => o.title).join('، '));
  return parts.join(' — ');
}

function renderGrid() {
  const grid = $('#calGrid');
  if (!grid) return;
  const cells = monthGrid(view.jy, view.jm);
  const t = todayJ();
  const rows = [];
  planFills.clear();
  monthZones = new Map();

  const birthday = normalizeBirthday(loadBirthday());

  for (let r = 0; r < 6; r++) {
    const row = document.createElement('div');
    row.className = 'pcal-row';
    row.setAttribute('role', 'row');
    let hasSel = false;

    for (let c = 0; c < 7; c++) {
      const cell = cells[r * 7 + c];
      const occasions = occasionsOf(cell.jy, cell.jm, cell.jd);
      const off = occasions.some(o => o.holiday);
      const friday = isFriday(cell.jy, cell.jm, cell.jd);
      const selected = sameDay(cell, sel);
      const bdayDay = effectiveBirthdayDay(birthday, cell.jy);
      const isBday = !!birthday && cell.jm === birthday.m && cell.jd === bdayDay;
      if (selected) hasSel = true;

      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pcal-cell';
      b.setAttribute('role', 'gridcell');
      b.dataset.jy = String(cell.jy);
      b.dataset.jm = String(cell.jm);
      b.dataset.jd = String(cell.jd);
      b.classList.toggle('out', !cell.inMonth);
      b.classList.toggle('today', sameDay(cell, t));
      b.classList.toggle('sel', selected);
      b.classList.toggle('holiday', off);
      b.classList.toggle('friday', friday && !off);
      b.classList.toggle('has-occ', occasions.length > 0);
      b.classList.toggle('is-birthday', isBday);
      b.setAttribute('aria-selected', String(selected));
      const label = dayLabel(cell.jy, cell.jm, cell.jd, occasions, off || friday, isBday);
      b.dataset.label = label;
      b.setAttribute('aria-label', label);
      b.tabIndex = selected ? 0 : -1;
      /* The digit and its occasion dot share one round well, so every number in
         the grid sits on the same centre line and the well — not the square — is
         what hover, today and the selection paint. The plan bar underneath is
         the week's own vocabulary, at the month's size. */
      const bdayMark = isBday ? `<span class="pcal-bday-badge" aria-hidden="true">${ICONS.cake}</span>` : '';
      /* Two calendars in one box: the Persian day is the number, the Gregorian
         one rides under it in the small type, the way a diary prints both. The
         occasion dot moves to the cell's corner so neither digit is pushed off
         the centre line by it. */
      const g = jalaliToDate(cell.jy, cell.jm, cell.jd).getDate();
      b.innerHTML = `<span class="pcal-num">${faNum(cell.jd)}`
        + `<span class="pcal-g">${faNum(g)}</span></span>`
        + '<span class="pcal-mark" aria-hidden="true"></span>'
        + bdayMark
        + '<span class="pcal-plan" aria-hidden="true"><i></i></span>';
      const key = dayKey(jalaliToDate(cell.jy, cell.jm, cell.jd));
      planFills.set(key, { cell: b, fill: b.querySelector('.pcal-plan i') });
      monthZones.set(key, b);
      row.appendChild(b);
    }
    row.classList.toggle('has-sel', hasSel);
    rows.push(row);
  }
  grid.replaceChildren(...rows);
  syncPlan();
}

/* ═══ The plan on the month ═══
   The same 3px bar the week's days wear: how much of a day's plan is already
   done. A day with nothing planned has no bar at all — an empty track would be a
   promise the day never made — and the ratio is a width, not a colour, so it
   survives every theme. */
function syncPlan() {
  const counts = new Map();
  for (const task of (Array.isArray(state.tasks) ? state.tasks : [])) {
    if (!task || typeof task !== 'object' || task.deletedAt || !task.dueDate) continue;
    const c = counts.get(task.dueDate) || { total: 0, done: 0 };
    c.total += 1;
    if (task.done) c.done += 1;
    counts.set(task.dueDate, c);
  }

  for (const [key, { cell, fill }] of planFills) {
    const c = counts.get(key) || { total: 0, done: 0 };
    fill.style.width = c.total ? Math.round((c.done / c.total) * 100) + '%' : '';
    fill.parentElement.classList.toggle('has', c.total > 0);
    /* The count joins the day's own label rather than replacing it: a screen
       reader hears the date and the occasions first, then the plan. */
    cell.setAttribute('aria-label', cell.dataset.label
      + (c.total ? ` — ${faNum(c.done)} از ${faNum(c.total)} کار انجام شده` : ''));
  }
}

/* ═══ The day ═══
   There is one day panel, and it belongs to js/planner.js: the month names the
   day and the week's panel paints it — occasions, tasks, quick add, the lot. Two
   renderings of «what is this day» is exactly what the merged page was meant to
   end, so the month deliberately owns no panel of its own. */

/* ═══ What the month holds ═══ */
function renderMonthList() {
  const list = $('#calList');
  const title = $('#calMonthTitle');
  const note = $('#calNote');
  if (!list) return;

  if (title) title.textContent = `مناسبت‌های ${JALALI_MONTHS[view.jm - 1]}`;
  const rows = [...monthOccasions(view.jy, view.jm)];

  const birthday = normalizeBirthday(loadBirthday());
  if (birthday && birthday.m === view.jm) {
    const bdayDay = effectiveBirthdayDay(birthday, view.jy);
    const name = loadName()?.trim();
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

  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'pcal-list-empty';
    li.textContent = inRange(view.jy)
      ? 'برای این ماه مناسبتی ثبت نشده.'
      : 'مناسبت‌های این سال همراه اپ نیست.';
    list.replaceChildren(li);
  } else {
    list.replaceChildren(...rows.map(row => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pcal-list-row'
        + (row.holiday ? ' is-holiday' : '')
        + (row.isBirthday ? ' is-birthday' : '');
      b.dataset.jy = String(view.jy);
      b.dataset.jm = String(view.jm);
      b.dataset.jd = String(row.jd);
      const icon = row.isBirthday ? `<span class="pcal-list-ico" aria-hidden="true">${ICONS.cake}</span>` : '';
      b.innerHTML = `<span class="pcal-list-day">${faNum(row.jd)}</span>`
        + `<span class="pcal-list-title">${icon}${esc(row.title)}</span>`;
      b.setAttribute('aria-label', `${faNum(row.jd)} ${JALALI_MONTHS[view.jm - 1]} — ${row.title}`);
      li.appendChild(b);
      return li;
    }));
  }

  if (note) {
    note.textContent = inRange(view.jy)
      ? 'مناسبت‌های ایرانی و رسمی؛ تعطیلات رسمی جدا از جمعه‌ها رنگ می‌گیرند.'
      : `فهرست مناسبت‌ها برای ${faDigits(RANGE.from)} تا ${faDigits(RANGE.to)} همراه اپ است.`;
  }
}

/* Where a task can land. The panel hands its drag over to this hit test and
   remembers nothing about the grid's shape (js/planner.js). */
const monthDropApi = {
  root: () => $('#calGrid'),
  el: key => monthZones.get(key) || null,
  /* The panel follows a task to the day it landed on (js/planner.js). The grid
     follows too, so the number under the hand and the day the panel describes
     are never two different days — and a drop on a neighbouring month turns
     to that month, because that is where the task now lives. */
  focus: key => {
    const j = dateToJalali(dateFromKey(key));
    if (sel && sameDay(sel, j)) return;
    sel = { jy: j.jy, jm: j.jm, jd: j.jd };
    view = { jy: j.jy, jm: j.jm };
    paint();
  },
  hit: (x, y) => {
    const grid = $('#calGrid');
    if (!grid) return null;
    let near = null, best = Infinity;
    for (const [key, cell] of monthZones) {
      const r = cell.getBoundingClientRect();
      if (!r.width) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return key;
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < best) { best = d; near = key; }
    }
    /* A release just outside the grid still lands on the nearest day; one far
       away from it does not land at all, because that is not an aim. */
    const g = grid.getBoundingClientRect();
    const inside = x >= g.left - 12 && x <= g.right + 12 && y >= g.top - 12 && y <= g.bottom + 12;
    return inside ? near : null;
  },
};

let lastPaintSig = '';

function paint(force = false) {
  if (!view || !sel) resetToToday();
  const activeTasks = (Array.isArray(state.tasks) ? state.tasks : []).filter(t => t && !t.deletedAt);
  const sig = [
    view?.jy, view?.jm, sel?.jy, sel?.jm, sel?.jd,
    activeTasks.length,
    activeTasks.filter(t => t.done).length,
    activeTasks.filter(t => t.dueDate).map(t => `${t.id}:${t.dueDate}`).join(',')
  ].join('|');

  if (!force && sig === lastPaintSig && $('#calGrid')?.children?.length > 0) {
    return;
  }
  lastPaintSig = sig;

  renderBar();
  renderGrid();
  renderMonthList();
  /* The panel is js/planner.js's; the grid only names the day it should show —
     and offers its cells as the places a task can be dropped. */
  setMonthDrop(monthDropApi);
  focusPlannerDay(dayKey(jalaliToDate(sel.jy, sel.jm, sel.jd)));
  renderPlanner();
}

export function renderCalendar(force = false) {
  paint(force);
}

/* The date line on Today is this page's other door: it opens the month of today
   with today selected, whichever month the page was left on. */
export function openToday() {
  resetToToday();
  paint();
}

export function initCalendar() {
  buildShell();
  /* Every save in the app arrives here: the month's plan bars follow the same
     data the panel does, and birthday/task changes update the grid and occasions. */
  subscribe(() => {
    if (!document.getElementById('page-calendar')?.classList.contains('active')) return;
    syncPlan();
    renderGrid();
    renderMonthList();
  });
  /* Painted only when this page is the one on screen (a direct #calendar link,
     or a return to it); otherwise the first visit renders it. */
  if (document.getElementById('page-calendar')?.classList.contains('active')) paint();
}
