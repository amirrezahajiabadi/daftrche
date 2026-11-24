/* ═══ The day panel — one day, worked on ═══
   The calendar's month picks the day; this file paints it. Two questions are
   answered together: what is planned for a day, and what actually
   happened on it — the second read from the day book (js/ledger.js) that the
   achievements were already keeping, so this page is a view over data the app
   has, not a second place where data starts being written.

   A task has one due date, not a copy per day. Writing a task while looking at
   Saturday is the same task the Tasks page would create, and ticking it here is
   the same tick the Today page gives it — so nothing in this file owns data:
   addTask, setTaskDone and collapse are the shared doors, and there is no fourth
   notion of "when" beyond the due date and the optional span.

   Nothing that holds a caret is ever rebuilt: the panel's frame is written once
   and only its contents are redrawn. A notify from any other module arrives on
   every save, and it must never be able to wipe a half-written task out of the
   input. */

import { state, getTask } from './state.js';
import {
  $, esc, dayKey, faNum, faDigits, dateFromKey, shiftKey, formatClock, parseTimeRange,
} from './utils.js';
import { subscribe } from './bus.js';
import { addTask, setTaskDone, collapse, timeRangeLabel, moveTaskToDay, applyEdits } from './tasks.js';
import { mountSelectMenu } from './pickmenu.js';
import { openTaskEditor } from './taskedit.js';
import { collectTotals } from './ledger.js';
import { ICONS, MOODS, LIB_ICONS } from './constants.js';
import { dateToJalali, jalaliToGregorian, JALALI_MONTHS } from './jalali.js';
import { GREGORIAN_MONTHS, occasionsOf, isFriday } from './calendarmodel.js';
import { pickerRow } from './chipgroup.js';
import { parseQuickAdd, renderQuickAddPreview, stripQuickAddToken } from './quickadd.js';
import { loadBirthday, loadName } from './store.js';
import { normalizeBirthday, effectiveBirthdayDay } from './birthday.js';

/* ── Where the page is looking ──
   One value: the day on screen. The week laid out is the week that day falls
   in, so «which week» and «which day» can never disagree — and moving a week is
   that same value stepped by seven. */
let focusKey = null;
let spanSlot = 'none';
let spanPicker = null;

/* Where a task can land: the month's own grid, which registers a hit test, an
   element per day and the box to arm (js/calendar.js). The panel is a view of a
   day, not a calendar, so it offers no targets of its own. */
let monthDrop = null;
export function setMonthDrop(drop) { monthDrop = drop; }
const zoneEl = key => (monthDrop && monthDrop.el ? monthDrop.el(key) : null);
const armedRoot = () => (monthDrop && monthDrop.root ? monthDrop.root() : null);

const todayKey = () => dayKey(new Date());
const shownKey = () => (focusKey ? focusKey : todayKey());

const dateFmt = (opts, key) => new Intl.DateTimeFormat('fa-IR', opts).format(dateFromKey(key));
const fullDate = key => dateFmt({ weekday: 'long', day: 'numeric', month: 'long' }, key);
const weekdayName = key => dateFmt({ weekday: 'long' }, key);

/* How far the day is from today, in the words a reader would use. */
function relLabel(key) {
  const diff = Math.round((dateFromKey(key) - dateFromKey(todayKey())) / 864e5);
  if (diff === 0) return { text: 'امروز', cls: 'today' };
  if (diff === -1) return { text: 'دیروز', cls: 'past' };
  if (diff === 1) return { text: 'فردا', cls: 'future' };
  if (diff < 0) return { text: `${faNum(-diff)} روز پیش`, cls: 'past' };
  return { text: `${faNum(diff)} روز دیگه`, cls: 'future' };
}

/* ── The optional span ──
   Four slots people actually plan in, one tap each, plus «دلخواه» for the exact
   span. The picks are written in the words a plan is spoken in — «۲ بعدازظهر» —
   with the clock the app prints beside them, so the twelve-or-twenty-four
   question never has to be asked and nothing has to be typed. */
const SPAN_SLOTS = [
  { key: 'none', label: 'ندارد' },
  { key: 'morning', label: 'صبح', from: 9 * 60, to: 12 * 60 },
  { key: 'noon', label: 'ظهر', from: 12 * 60, to: 14 * 60 },
  { key: 'evening', label: 'عصر', from: 16 * 60, to: 18 * 60 },
  { key: 'night', label: 'شب', from: 20 * 60, to: 22 * 60 },
  { key: 'custom', label: 'دلخواه' },
];

function hourLabel(min) {
  const h = min / 60;
  if (h === 0) return '۱۲ شب';
  if (h < 5) return `${faNum(h)} شب`;
  if (h < 12) return `${faNum(h)} صبح`;
  if (h === 12) return '۱۲ ظهر';
  if (h < 17) return `${faNum(h - 12)} بعدازظهر`;
  if (h < 20) return `${faNum(h - 12)} عصر`;
  return `${faNum(h - 12)} شب`;
}

/* The span the next quick add would carry: null for «ندارد», the slot's own
   pair for a preset, and whatever the two picks say for «دلخواه» — which comes
   back null while the picks are out of order, so an impossible span can never
   reach a task. */
function currentSpan() {
  const slot = SPAN_SLOTS.find(s => s.key === spanSlot);
  if (!slot || slot.key === 'none') return null;
  if (slot.key !== 'custom') return { from: slot.from, to: slot.to };
  const from = Number($('#wkFrom') && $('#wkFrom').value);
  const to = Number($('#wkTo') && $('#wkTo').value);
  return parseTimeRange(from, to);
}

/* ═══ The frame: built once, then only its contents change ═══ */

function buildShell() {
  /* The panel is the calendar page's day, not the week's: both zooms read it,
     so it is built in the shared host and never inside the week's own box. */
  const day = $('#calDay');
  if (!day || day.dataset.built) return;
  day.dataset.built = '1';
  day.innerHTML = `
    <div class="wk-panel">
      <div class="wk-panel-head">
        <h2 id="wkHead"></h2>
        <span class="wk-rel" id="wkRel"></span>
        <span class="pcal-badge pcal-badge-birthday" id="calBirthdayBadge" hidden>${ICONS.cake} روز تولد تو</span>
        <span class="pcal-badge" id="calHoliday" hidden>تعطیل</span>
      </div>
      <p class="pcal-day-sub" id="wkGreg"></p>
      <ul class="pcal-occ" id="wkOccList"></ul>

      <form class="wk-add" id="wkAdd" autocomplete="off">
        <input id="wkInput" type="text" maxlength="120" aria-label="افزودن کار به این روز"/>
        <button class="wk-go" type="submit" aria-label="افزودن">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </form>
      <div class="quickadd-preview" id="wkQuickAddPreview" hidden></div>

      <!-- Optional, and it says so: «ندارد» is a first-class answer. -->
      <div class="wk-span">
        <button type="button" class="wk-span-toggle" id="wkSpanToggle" aria-expanded="false">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 13V9"/><path d="M12 5V3M9 3h6"/></svg>
          <span>ساعت و بازهٔ زمانی</span>
          <span class="wk-span-out" id="wkSpanOut" aria-live="polite"></span>
        </button>
        <div class="wk-span-body" id="wkSpanBody" hidden>
          <div class="pick-row" id="wkSpanChips" role="radiogroup" aria-labelledby="wkSpanToggle"></div>
          <div class="wk-span-picks" id="wkSpanPicks" hidden>
            <select id="wkFrom" aria-label="از ساعت"></select>
            <span class="wk-span-to">تا</span>
            <select id="wkTo" aria-label="تا ساعت"></select>
          </div>
          <p class="wk-span-hint" id="wkSpanHint" role="status" hidden></p>
        </div>
      </div>

      <div class="wk-sections-grid">
        <section class="wk-sec wk-timeline-sec" id="wkTimelineSec">
          <h3>تایم‌لاین روز</h3>
          <ul class="wk-timeline wk-list" id="wkTimeline"></ul>
        </section>

        <section class="wk-sec wk-untimed-sec" id="wkUntimedSec">
          <h3>کارهای بدون ساعت (شناور)</h3>
          <ul class="wk-list" id="wkList"></ul>
        </section>
      </div>

      <section class="wk-sec" id="wkDoneSec" hidden>
        <h3>انجام‌شده در این روز</h3>
        <ul class="wk-list" id="wkDoneList"></ul>
      </section>

      <section class="wk-sec" id="wkActSec" hidden>
        <h3>این روز چه‌خبر بود</h3>
        <div class="wk-chips" id="wkActChips"></div>
        <p class="wk-act-note" id="wkActNote" hidden></p>
      </section>
    </div>`;

  fillHourPicks();
  spanPicker = pickerRow($('#wkSpanChips'), SPAN_SLOTS, { group: 'span', onPick: pickSpan });

  $('#wkSpanToggle')?.addEventListener('click', () => {
    const body = $('#wkSpanBody');
    if (!body) return;
    const isHidden = body.hidden;
    body.hidden = !isHidden;
    $('#wkSpanToggle')?.setAttribute('aria-expanded', String(isHidden));
  });

  const wkInput = $('#wkInput');
  const wkPreview = $('#wkQuickAddPreview');
  if (wkInput && wkPreview) {
    const dismissed = new Set();
    const withoutDismissed = parsed => {
      if (!dismissed.size || !parsed.ignored) return parsed;
      const ignored = parsed.ignored.filter(t => !dismissed.has(t));
      return ignored.length === parsed.ignored.length ? parsed : { ...parsed, ignored };
    };
    wkInput.addEventListener('input', () => {
      const raw = wkInput.value;
      const parsed = withoutDismissed(parseQuickAdd(raw));
      for (const token of dismissed) if (!raw.includes(token)) dismissed.delete(token);
      renderQuickAddPreview(wkPreview, parsed, key => {
        if (key === 'ignored') {
          (parsed.ignored || []).forEach(t => {
            dismissed.add(t);
            wkInput.value = stripQuickAddToken(wkInput.value, t);
          });
          wkInput.dispatchEvent(new Event('input'));
          return;
        }
        const token = parsed.tokens?.[key];
        if (token) {
          wkInput.value = stripQuickAddToken(wkInput.value, token);
          wkInput.dispatchEvent(new Event('input'));
        } else {
          wkPreview.querySelector(`[data-key="${key}"]`)?.remove();
          if (!wkPreview.children.length) wkPreview.hidden = true;
        }
      });
    });
  }

  $('#wkAdd').addEventListener('submit', onSubmit);
  $('#wkFrom').addEventListener('change', syncSpan);
  $('#wkTo').addEventListener('change', syncSpan);

  $('#calDay').addEventListener('click', e => {
    const row = e.target.closest('.wk-row');
    if (!row) return;
    const task = getTask(row.dataset.id);
    if (!task) return;
    if (e.target.closest('.wk-check')) setTaskDone(task.id, !task.done);
    else if (e.target.closest('.wk-del')) collapse(row, task.id);
    else if (e.target.closest('.wk-edit')) {
      const editBtn = e.target.closest('.wk-edit');
      openTaskEditor(task, c => applyEdits(task, c), editBtn);
    }
  });

  $('#moveUndoBtn')?.addEventListener('click', performMoveUndo);

  /* Moving a task to another day: by hand off the grip, or by arrow key from the
     row's own buttons. Both land in js/tasks.js (moveTaskToDay), because the
     Tasks page's due picker is the other door to the same change.

     Only the press is on the panel, because only the press has to come from a
     grip inside it. The rest of the gesture is on the window: the week strip
     sits *above* the panel, so the day a task is aimed at is reached by lifting
     the finger off the panel altogether — a release heard only inside the panel
     would never arrive, and the page would keep a card stuck under the finger
     with a row faded out. On the window the same release always lands. */
  $('#calDay').addEventListener('pointerdown', pressRow);
  $('#calDay').addEventListener('keydown', moveByKey);
  addEventListener('pointermove', moveDrag);
  addEventListener('pointerup', releaseRow);
  addEventListener('pointercancel', cancelDrag);
  addEventListener('keydown', e => { if (e.key === 'Escape' && drag) cancelDrag(); });
}

/* Twenty-four hours, told twice: the way it is spoken and the way the app prints
   it. A plan typed as «۲» and a task row reading «۱۴:۰۰» are then the same hour
   to the reader looking at both. */
function fillHourPicks() {
  const opts = Array.from({ length: 24 }, (_, h) => {
    const min = h * 60;
    return `<option value="${min}">${hourLabel(min)} · ${formatClock(min)}</option>`;
  }).join('');
  $('#wkFrom').innerHTML = opts;
  $('#wkTo').innerHTML = opts;
  $('#wkFrom').value = String(14 * 60);
  $('#wkTo').value = String(16 * 60);

  /* The two ends of the span wear the app's select pill (js/pickmenu.js): the
     clock on the button, the spoken hour («دو بعدازظهر · ۱۴:۰۰») in the list. */
  const hourText = t => t.split('·').pop().trim();
  mountSelectMenu($('#wkFrom'), { text: hourText });
  mountSelectMenu($('#wkTo'), { text: hourText });
}

function pickSpan(key) {
  const before = currentSpan();
  spanSlot = key;
  if (spanPicker) spanPicker.mark(spanSlot);
  /* Arriving at «دلخواه» from a span that was already chosen starts from that
     span rather than from an arbitrary hour — the reader is refining, not
     starting over. */
  if (key === 'custom' && before) {
    $('#wkFrom').value = String(before.from);
    $('#wkTo').value = String(before.to);
    $('#wkFrom').__smSync?.();
    $('#wkTo').__smSync?.();
  }
  syncSpan();
}

function syncSpan() {
  const picks = $('#wkSpanPicks');
  const out = $('#wkSpanOut');
  const hint = $('#wkSpanHint');
  const custom = spanSlot === 'custom';
  if (picks) picks.hidden = !custom;
  if (hint) hint.hidden = true;
  const span = currentSpan();
  if (out) out.textContent = span ? `${formatClock(span.from)} تا ${formatClock(span.to)}` : '';
  if (custom && !span && hint) {
    hint.textContent = 'پایان باید بعد از شروع باشد.';
    hint.hidden = false;
  }
}

function onSubmit(e) {
  e.preventDefault();
  const form = $('#wkAdd');
  const input = $('#wkInput');
  const preview = $('#wkQuickAddPreview');
  const raw = input ? input.value.trim() : '';
  if (!raw) {
    form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
    setTimeout(() => form.classList.remove('shake'), 380);
    input?.focus();
    return;
  }
  const parsed = parseQuickAdd(raw);
  const text = parsed.text || raw;
  const due = parsed.dueDate || shownKey();
  const cat = parsed.cat || 'misc';
  const dur = parsed.durationMin;
  /* An inferred end that would run past midnight is brought back to 23:59
     rather than thrown away: «ساعت ۲۳:۳۰» is a real plan, and the whole span
     used to be dropped because the end did not fit inside the day. */
  const inferredTo = (from, minutes) =>
    from === null || from === undefined ? null : Math.min(1439, from + (minutes || 60));
  const time = (parsed.timeFrom !== null && parsed.timeTo !== null)
    ? { from: parsed.timeFrom, to: parsed.timeTo }
    : (parsed.timeFrom !== null
        ? { from: parsed.timeFrom, to: inferredTo(parsed.timeFrom, dur) }
        : currentSpan());

  /* An impossible custom span is refused, and the reason is already on screen
     under the picks — writing the task without its span would be a silent loss
     of the one thing the reader had just said. */
  if (spanSlot === 'custom' && !time) { syncSpan(); return; }
  addTask(text, 'mid', cat, due, dur, time);
  const wkBtn = form.querySelector('.wk-go');
  if (wkBtn) {
    wkBtn.classList.remove('add-pop');
    void wkBtn.offsetWidth;
    wkBtn.classList.add('add-pop');
    setTimeout(() => wkBtn.classList.remove('add-pop'), 340);
  }
  if (preview) { preview.hidden = true; preview.innerHTML = ''; }
  if (input) { input.value = ''; input.focus(); }
}

/* ═══ The day ═══ */

export function formatBirthdayGreeting(jy, birthday, name) {
  const b = normalizeBirthday(birthday);
  if (!b) return '';
  const age = (b.y !== null && (jy - b.y) > 0) ? (jy - b.y) : null;
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const greeting = cleanName ? `تولدت مبارک، ${cleanName}!` : 'تولدت مبارک!';
  return `${greeting}${age ? ` آغاز ${faNum(age)} سالگی` : ''}`;
}

function renderDayHead() {
  const key = shownKey();
  const head = $('#wkHead');
  if (head) head.textContent = fullDate(key);
  const rel = $('#wkRel');
  if (rel) {
    const r = relLabel(key);
    rel.textContent = r.text;
    rel.className = 'wk-rel ' + r.cls;
  }

  /* The other half of a day: what it *is*, beside what is planned on it. This
     panel is shared by both zooms, so the month's occasions are read here rather
     than in a second panel that would have to be kept in step with this one. */
  const j = dateToJalali(dateFromKey(key));
  const occasions = occasionsOf(j.jy, j.jm, j.jd);
  const off = occasions.some(o => o.holiday) || isFriday(j.jy, j.jm, j.jd);
  const badge = $('#calHoliday');
  if (badge) badge.hidden = !off;

  const rawBirthday = loadBirthday();
  const birthday = normalizeBirthday(rawBirthday);
  const bdayDay = effectiveBirthdayDay(birthday, j.jy);
  const isBirthdayDay = !!birthday && j.jm === birthday.m && j.jd === bdayDay;
  const bdayBadge = $('#calBirthdayBadge');
  if (bdayBadge) bdayBadge.hidden = !isBirthdayDay;

  const greg = $('#wkGreg');
  if (greg) {
    const g = jalaliToGregorian(j.jy, j.jm, j.jd);
    greg.textContent = `${faNum(g.gd)} ${GREGORIAN_MONTHS[g.gm - 1]} ${faDigits(g.gy)}`;
  }

  const occ = $('#wkOccList');
  if (occ) {
    const items = [];
    if (isBirthdayDay) {
      const name = loadName();
      const bdayTitle = formatBirthdayGreeting(j.jy, birthday, name);
      items.push({ title: bdayTitle, holiday: false, isBirthday: true });
    }
    for (const o of occasions) {
      items.push({ ...o, isBirthday: false });
    }

    if (items.length) {
      occ.replaceChildren(...items.map(o => {
        const li = document.createElement('li');
        if (o.holiday) li.className = 'is-holiday';
        if (o.isBirthday) li.className = (li.className ? li.className + ' ' : '') + 'is-birthday';
        const dot = document.createElement('span');
        dot.className = 'pcal-occ-dot';
        dot.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        const icon = o.isBirthday ? `<span class="pcal-occ-ico" aria-hidden="true">${ICONS.cake}</span>` : '';
        text.innerHTML = icon + esc(o.title);
        li.append(dot, text);
        return li;
      }));
    } else {
      const li = document.createElement('li');
      li.className = 'wk-occ-empty';
      li.textContent = 'برای این روز مناسبتی ثبت نشده.';
      occ.replaceChildren(li);
    }
  }

  const input = $('#wkInput');
  if (input) {
    input.placeholder = `+ برای ${weekdayName(key)} یه کار بنویس…`;
    input.setAttribute('aria-label', `افزودن کار به ${fullDate(key)}`);
  }
}

/* One row, both lists. A planned task and a task finished that day are the same
   thing seen from two sides, so they are not allowed to look like two species. */
/* `slot` marks the timeline variant: the same row, with the hour said before
   the title instead of after it. Both variants carry the same grip, tick, bin
   and span chip, so a timed task is ticked, deleted, dragged and arrow-moved
   exactly like a floating one. */
function rowEl(task, slot) {
  const li = document.createElement('li');
  li.className = 'wk-row' + (slot ? ' wk-timeline-slot' : '') + (task.done ? ' done' : '');
  li.dataset.id = task.id;
  li.dataset.p = task.p || 'mid';
  const span = timeRangeLabel(task) || formatClock(task.timeFrom);
  const spanChip = span ? `<span class="wk-span-chip">${span}</span>` : '';
  li.innerHTML = `
    <span class="wk-grip" aria-hidden="true" title="بکشش روی روز دیگه — یا با کلیدهای چپ و راست ببرش">${ICONS.grip}</span>
    <button class="wk-check" type="button" aria-label="تغییر وضعیت تکمیل">${ICONS.check}</button>
    <span class="wk-dot" aria-hidden="true"></span>
    ${slot && span ? `<span class="wk-slot-badge">${LIB_ICONS.clock} ${span}</span>` : ''}
    <span class="wk-title"></span>
    ${slot ? '' : spanChip}
    <button class="wk-edit" type="button" aria-label="ویرایش">${ICONS.edit}</button>
    <button class="wk-del" type="button" aria-label="حذف">${ICONS.trash}</button>`;
  li.querySelector('.wk-title').textContent = task.text;
  return li;
}

function emptyNote(key) {
  const li = document.createElement('li');
  li.className = 'wk-empty';
  const today = todayKey();
  li.textContent = key === today
    ? 'برای امروز چیزی ننوشتی — همون بالا بنویس.'
    : key > today
      ? 'برای این روز کاری برنامه‌ریزی نشده.'
      : 'این روز خالی بود.';
  return li;
}

/* The day as the day book remembers it: what was ticked, what was focused on,
   what was read, and how the day felt. All of it was already being recorded —
   this only says it back. Only a day that has happened has anything to say. */
function renderActivity(key) {
  const sec = $('#wkActSec');
  const chips = $('#wkActChips');
  const note = $('#wkActNote');
  if (!sec || !chips) return;
  if (key > todayKey()) { sec.hidden = true; return; }

  const day = collectTotals().days.find(d => d.key === key) || null;
  const items = [];
  if (day) {
    if (day.done) items.push(`${faNum(day.done)} کار جلو رفت`);
    if (day.focusMin) items.push(`${faNum(day.focusMin)} دقیقه تمرکز`);
    if (day.readMin) items.push(`${faNum(day.readMin)} دقیقه مطالعه`);
    if (day.pages) items.push(`${faNum(day.pages)} صفحه`);
    if (day.mood && MOODS[day.mood - 1]) items.push(`حال: ${MOODS[day.mood - 1].label}`);
    if (day.freeze) items.push('مرخصی پیوستگی');
  }
  sec.hidden = false;
  chips.replaceChildren(...items.map(t => {
    const span = document.createElement('span');
    span.className = 'wk-chip';
    span.textContent = t;
    return span;
  }));
  const quiet = !items.length;
  chips.hidden = quiet;
  if (note) {
    note.hidden = !quiet;
    note.textContent = quiet
      ? (key === todayKey() ? 'امروز هنوز چیزی ثبت نشده.' : 'از این روز چیزی ثبت نشده.')
      : '';
  }
}

function renderLists() {
  const key = shownKey();

  /* Planned: timed first, in the order of the day; untimed after them, because a
     span is an anchor and the rest of the day hangs off it. Sorted by time
     alone, so ticking a task never makes its row jump away from the finger. */
  const untimed = 24 * 60;
  const tasks = (Array.isArray(state.tasks) ? state.tasks : []).filter(t => t && typeof t === 'object' && !t.deletedAt);
  const planned = tasks
    .filter(t => t.dueDate === key)
    .sort((a, b) => (a.timeFrom == null ? untimed : a.timeFrom) - (b.timeFrom == null ? untimed : b.timeFrom));

  const timed = planned.filter(t => t.timeFrom != null);
  const untimedTasks = planned.filter(t => t.timeFrom == null);

  const timelineSec = $('#wkTimelineSec');
  const timelineEl = $('#wkTimeline');
  const untimedSec = $('#wkUntimedSec');
  const list = $('#wkList');

  if (timelineEl) {
    if (timed.length) {
      if (timelineSec) timelineSec.hidden = false;
      /* Rows, not markup: the timeline used to paint bare divs with no tick and
         no bin, so a timed task could be read but not touched. */
      timelineEl.replaceChildren(...timed.map(t => rowEl(t, true)));
    } else {
      if (timelineSec) timelineSec.hidden = !untimedTasks.length;
      timelineEl.innerHTML = `<div class="wk-timeline-empty">هیچ کار زمان‌بندی‌شده‌ای ثبت نشده؛ کارها شناور هستند.</div>`;
    }
  }

  if (list) {
    if (untimedTasks.length) {
      if (untimedSec) untimedSec.hidden = false;
      list.replaceChildren(...untimedTasks.map(rowEl));
    } else if (!timed.length) {
      if (untimedSec) untimedSec.hidden = false;
      list.replaceChildren(emptyNote(key));
    } else {
      if (untimedSec) untimedSec.hidden = true;
      list.replaceChildren();
    }
  }

  /* Finished that day, but planned for another one (or for no day at all): the
     tick belongs to the day it happened on. */
  const doneHere = tasks.filter(t =>
    t.done && t.doneAt && dayKey(new Date(t.doneAt)) === key && t.dueDate !== key);
  const sec = $('#wkDoneSec');
  const doneList = $('#wkDoneList');
  if (sec && doneList) {
    sec.hidden = !doneHere.length;
    doneList.replaceChildren(...doneHere.map(rowEl));
  }

  renderActivity(key);
}

/* ═══ Carrying a task to another day ═══
   A week is the one place where a plan's day is a single gesture away, so a row
   can be picked up by its grip and put down on another day. Pointer events
   rather than the HTML5 drag the Tasks page uses, because that one needs a
   mouse: this app is held in one hand, and a gesture that only worked on a
   desktop would be a promise the page cannot keep.

   Which day is chosen never depends on how high the finger is — only on which
   of the week's seven columns it is over. So the gesture is the same whether the
   strip is on screen or a screen and a half above it, and the card under the
   finger says where the task is going the whole way: «میره به پنجشنبه ۹ مهر».
   A release between two columns takes the nearer one: aiming with a thumb is not
   a mouse click, and a hair off an edge throwing the whole journey away would be
   the page punishing the hand rather than reading it. Escape is the way out, and
   letting go without ever having moved is not a drag at all. */

const DRAG_SLOP = 8;   // how far a press may wander before it counts as a drag
let drag = null;       // { taskId, row, pointerId, x, y, on, key, ghost }

/* The day a point is over: the month answers in two dimensions, because its
   days are laid out in rows. A grid that is not on screen has no width and is
   never a target. */
function dayAt(x, y) {
  return monthDrop && monthDrop.hit ? monthDrop.hit(x, y) : null;
}

function pressRow(e) {
  const grip = e.target.closest('.wk-grip');
  if (!grip || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const row = grip.closest('.wk-row');
  if (!row) return;
  drag = { taskId: row.dataset.id, row, pointerId: e.pointerId, x: e.clientX, y: e.clientY, on: false, key: null, ghost: null };
}

/* The row is lifted only once the finger has actually travelled. A press that
   never moves is a press — and the grip is right next to the tick.*/
function liftDrag(e) {
  drag.on = true;
  drag.row.classList.add('dragging');
  document.documentElement.classList.add('wk-dragging');
  armedRoot()?.classList.add('armed');
  drag.ghost = ghostFor(drag.row);
  /* The capture keeps a mouse that wanders off the panel still pointing at the
     row it picked up; the `try` is for a pointer that is already gone. */
  try { drag.row.setPointerCapture(drag.pointerId); } catch (err) { /* stale pointer */ }
}

function moveDrag(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_SLOP) return;
    liftDrag(e);
    /* The same move that lifts the row also chooses the day it is over: a quick
       flick puts a task down in one gesture, not two. */
  }
  const key = dayAt(e.clientX, e.clientY);
  if (key !== drag.key) {
    if (drag.key) zoneEl(drag.key)?.classList.remove('drop');
    drag.key = key;
    if (key) zoneEl(key)?.classList.add('drop');
    drag.ghost.to.textContent = key && key !== shownKey() ? `میره به ${fullDate(key)}` : '';
  }
  /* Placed last, against the width the card has *now*: writing the destination
     makes the card wider, and a wider card in a right-to-left page reaches
     further left, so a position measured before the words were written down
     would leave the card half off the screen. */
  moveGhost(e);
}

function releaseRow(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  if (!d.on) return;                 // never travelled: not a drag at all
  endDrag(d);
  const prevKey = getTask(d.taskId)?.dueDate || shownKey();
  if (d.key && d.key !== prevKey && moveTaskToDay(d.taskId, d.key)) {
    landTask(d.taskId, d.key);
    showMoveUndo(d.taskId, prevKey, d.key);
  }
}

function cancelDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.on) endDrag(d);
}

function endDrag(d) {
  d.row.classList.remove('dragging');
  document.documentElement.classList.remove('wk-dragging');
  armedRoot()?.classList.remove('armed');
  if (d.key) zoneEl(d.key)?.classList.remove('drop');
  if (d.ghost) d.ghost.el.remove();
  /* The row may already be gone: a drop re-renders the day's two lists. */
  try { d.row.releasePointerCapture(d.pointerId); } catch (err) { /* already released */ }
}

/* What the reader is holding: the task, its span, and where it is going. Built
   for one line and a half, because a phone shows it with a thumb resting on the
   glass next to it. */
function ghostFor(row) {
  const el = document.createElement('div');
  el.className = 'wk-ghost';
  el.setAttribute('aria-hidden', 'true');
  const title = document.createElement('span');
  title.className = 'wk-ghost-t';
  title.textContent = row.querySelector('.wk-title').textContent;
  el.append(title);
  const span = row.querySelector('.wk-span-chip');
  if (span) {
    const chip = document.createElement('span');
    chip.className = 'wk-span-chip';
    chip.textContent = span.textContent;
    el.append(chip);
  }
  const to = document.createElement('span');
  to.className = 'wk-ghost-to';
  el.append(to);
  document.body.append(el);
  /* Measured once, before anything moves it: the card's width (it is clamped to
     a slice of the screen, so it can be the wider of the two) and the place it
     starts from, which in a right-to-left page is the right edge — the one
     source of truth about which way a positive translate goes. */
  return { el, to };
}

/* Centred over the finger, above it where there is room and under it where there
   is not — a thumb dropped on the card would hide the one thing the card exists
   to say — and never half off the glass, because a card being read must not be
   the thing that runs off the page.

   Where the card *starts* from is read off the element itself on every move
   (`offsetWidth`/`offsetLeft` ignore transforms), not remembered: the page is
   right-to-left, so the card hangs off the screen's right edge, and a card that
   grows a destination line is a wider card hanging further left. Two reads of a
   small fixed box cost a layout nobody had dirtied; a remembered position would
   have cost the reader a card half outside the screen. */
function moveGhost(e) {
  const el = drag.ghost.el;
  const w = el.offsetWidth;
  const half = w / 2;
  const room = document.documentElement.clientWidth;
  const left = Math.min(Math.max(e.clientX - half, 8), Math.max(room - w - 8, 8));
  const y = e.clientY < 96 ? e.clientY + 26 : e.clientY - 62;
  el.style.transform = `translate(${Math.round(left - el.offsetLeft)}px, ${y}px)`;
}

/* Where a task just landed, said in the one place the reader is already looking:
   the day itself, which is also the row of numbers they will scan afterwards. */
function flashCell(key) {
  const cell = zoneEl(key);
  if (!cell) return;
  cell.classList.remove('drop');
  cell.classList.add('flash');
  setTimeout(() => cell.classList.remove('flash'), 700);
}

/* A task that just landed somewhere: that day becomes the day on screen. With a
   finger the destination was under the hand; with a keyboard there is nothing to
   see otherwise. The focus goes back to the task's own tick, so moving a task
   three days on is three presses, not a walk into the next week and back. The
   drag and the arrow keys both come through here, so they cannot drift. */
function landTask(id, key) {
  focusKey = key;
  /* The month, when it is the zoom on screen, takes its own selection along — it
     repaints itself here, and the panel is repainted below, once. */
  if (monthDrop && monthDrop.focus) monthDrop.focus(key);
  renderPlanner();
  flashCell(key);
  const moved = $('#calDay').querySelector(`.wk-row[data-id="${id}"] .wk-check`);
  if (moved) moved.focus();
  else zoneEl(key)?.focus();
}

/* Keyboard: a row's own tick and bin are already tab stops, so moving hangs off
   them and no extra stop is added to the page. Left is on a day and right is
   back a day, the way the strip already reads.

   The day a task goes to becomes the day on screen, with the focus back on the
   row's own tick — because with a finger the destination was under it, and with
   a keyboard there is nothing to see otherwise. Moving a task three days on is
   then three presses, not a walk into the next week and back. */
/* ── Undo Toast for moving a task ── */
let moveUndoTimer = null;
let moveHideTimer = null;
let lastMove = null;

function showMoveUndo(taskId, prevKey, newKey) {
  lastMove = { taskId, prevKey, newKey };
  const toast = $('#moveToast');
  if (!toast) return;
  const task = getTask(taskId);
  const title = task && task.text ? (task.text.length > 20 ? task.text.slice(0, 19).trim() + '…' : task.text) : 'کار';
  const label = toast.querySelector('.toast-text');
  if (label) {
    label.textContent = `${title} جابه‌جا شد`;
  }
  const bar = toast.querySelector('.toast-bar');
  if (bar) {
    bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
  }
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(moveUndoTimer);
  clearTimeout(moveHideTimer);
  moveUndoTimer = setTimeout(hideMoveUndo, 5000);
}

function hideMoveUndo() {
  clearTimeout(moveUndoTimer);
  moveUndoTimer = null;
  const toast = $('#moveToast');
  if (!toast) return;
  toast.classList.remove('show');
  clearTimeout(moveHideTimer);
  moveHideTimer = setTimeout(() => {
    toast.hidden = true;
    moveHideTimer = null;
  }, 300);
  lastMove = null;
}

function performMoveUndo() {
  if (!lastMove) return;
  const { taskId, prevKey } = lastMove;
  hideMoveUndo();
  if (taskId && prevKey && moveTaskToDay(taskId, prevKey)) {
    landTask(taskId, prevKey);
  }
}

function moveByKey(e) {
  const step = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
  if (!step) return;
  const row = e.target.closest('.wk-row');
  if (!row) return;
  const task = getTask(row.dataset.id);
  if (!task) return;
  e.preventDefault();
  const id = task.id;
  const prevKey = task.dueDate || shownKey();
  const key = shiftKey(prevKey, step);
  if (!moveTaskToDay(id, key)) return;
  landTask(id, key);
  showMoveUndo(id, prevKey, key);
}

export function renderPlanner() {
  renderDayHead();
  renderLists();
}

/* Every save in the app arrives here. Nothing is redrawn while the page is not
   on screen — the panel is a view, and a view nobody is looking at costs
   nothing. */
function onData() {
  const page = document.getElementById('page-calendar');
  if (!page || !page.classList.contains('active')) return;
  renderDayHead();
  renderLists();
}

/* The month knows a Jalali date; the panel is keyed by the Gregorian day key the
   tasks already carry, so the shell converts and hands one over. */
export function focusPlannerDay(key) {
  if (!key) return;
  focusKey = key;
}

export function initPlanner() {
  buildShell();
  syncSpan();
  if (spanPicker) spanPicker.mark(spanSlot);
  subscribe(onData);
  /* Painted only when active at boot (e.g. a #calendar hash); otherwise the
     first visit paints it. */
  if (document.getElementById('page-calendar')?.classList.contains('active')) {
    renderPlanner();
  }
}
