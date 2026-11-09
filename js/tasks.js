import { state, getTask } from './state.js';
import { saveTasks, requestPersistentStorage } from './store.js';
import { prefersReducedMotion } from './motion.js';
import { $, faNum, startOfToday, dueKeyFromOffset, normalizeFa, parseDurationMin, formatDuration, formatClock, parseTimeRange, reorderSubset, isOverdueTask, stepOrder } from './utils.js';
import { P_LABEL, CATS, ICONS, PRI_ICONS, LIB_ICONS } from './constants.js';
import { notify } from './bus.js';
import { bellHtml, refreshBell, setTaskNotify, notificationsSupported, bindPersistence } from './notifications.js';
import { confetti } from './confetti.js';
import { recordDay } from './week.js';
import { openFocus, clearFocus } from './focus.js';
import { openDuePicker } from './duepicker.js';
import { formatJalaliDate } from './jalali.js';
import { rememberDone } from './ledger.js';
import { openChipPicker, closeChipPicker, openTaskEditor, initTaskEditor, catOptions, priOptions, durOptions } from './taskedit.js';
import { parseQuickAdd, renderQuickAddPreview, stripQuickAddToken } from './quickadd.js';

let listEl = typeof document !== 'undefined' ? $('#taskList') : null;
const save = () => saveTasks(state.tasks);

/* The notifications module persists through these hooks so it never touches
   the task list's internals directly. */
bindPersistence({ save, notify });

/* Status is one question (what state is it in?) and «بدون مهلت» is another (does
   it have a date?). They used to share one row of pills, so «بدون مهلت» silently
   hid every finished task and could not be combined with a category. Status
   decides here; the no-deadline flag narrows whatever status is chosen. */
export const matches = t => {
  if (state.filter === 'overdue') return isOverdueTask(t, dueKeyFromOffset(0));
  if (state.filter === 'active') return !t.done;
  if (state.filter === 'done') return t.done;
  return true;
};
export const visible = () => state.tasks.filter(t =>
  matches(t) &&
  (!state.noDue || !t.dueDate) &&
  (state.catFilter === 'all' || (t.cat || 'misc') === state.catFilter) &&
  (!state.query || normalizeFa(t.text).includes(normalizeFa(state.query)))
);

function animatePriDotChange(dot) {
  dot.classList.remove('changed'); void dot.offsetWidth; dot.classList.add('changed');
  setTimeout(() => dot.classList.remove('changed'), 650);
}

/* A row near the bottom of the screen would otherwise open its menu under the
   floating dock. Measure the menu once it is visible and, if it would reach
   into the dock's strip, flip it above the button instead. */
function openMenuAboveNav(menu) {
  menu.classList.remove('up');
  menu.style.insetInlineStart = '';
  menu.style.insetInlineEnd = '';
  const rect = menu.getBoundingClientRect();
  const navHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 64;
  const navTop = innerHeight - navHeight - 16;
  if (rect.bottom > navTop) menu.classList.add('up');
  if (rect.left < 4) {
    menu.style.insetInlineEnd = 'auto';
    menu.style.insetInlineStart = '0';
  } else if (rect.right > innerWidth - 4) {
    menu.style.insetInlineStart = 'auto';
    menu.style.insetInlineEnd = '0';
  }
}

function animateChipFlip(chip) {
  chip.classList.remove('flipped'); void chip.offsetWidth; chip.classList.add('flipped');
  setTimeout(() => chip.classList.remove('flipped'), 450);
}

/* ── Estimated Duration ── */
function refreshDurChip(li, task) {
  const btn = li.querySelector('.dur-chip');
  if (!btn) return;
  if (!task.durationMin) {
    btn.className = 'dur-chip none';
    btn.textContent = '+ زمان';
    btn.title = 'افزودن زمان تقریبی';
    return;
  }
  const label = formatDuration(task.durationMin);
  btn.className = 'dur-chip';
  btn.textContent = label;
  btn.title = `زمان تقریبی: ${label} — کلیک برای تغییر`;
}

/* ── Due Date (Jalali) ── */
export function dueLabel(key) {
  if (!key) return null;
  const d = new Date(key + 'T00:00:00');
  const diff = Math.round((d - startOfToday()) / 864e5);
  const date = formatJalaliDate(d);
  if (diff < 0) return { cls: 'late', text: 'گذشته از مهلت', date };
  if (diff === 0) return { cls: 'today', text: 'امروز', date };
  if (diff === 1) return { cls: 'soon', text: 'فردا', date };
  if (diff === 2) return { cls: 'soon', text: 'پس‌فردا', date };
  if (diff <= 7) return { cls: 'soon', text: `${faNum(diff)} روز دیگه`, date };
  return { cls: 'far', text: date, date, ltr: true };
}
function refreshDueChip(li, task) {
  const btn = li.querySelector('.due-chip');
  if (!btn) return;
  if (!task.dueDate) { btn.className = 'due-chip none'; btn.innerHTML = '+ مهلت'; btn.title = 'افزودن مهلت'; return; }
  const dl = dueLabel(task.dueDate);
  // A completed task never reads as overdue — show its date neutrally instead
  const doneLate = task.done && dl.cls === 'late';
  btn.className = `due-chip ${doneLate ? 'far' : dl.cls}`;
  btn.innerHTML = doneLate || dl.ltr ? `<span dir="ltr">${doneLate ? dl.date : dl.text}</span>` : dl.text;
  btn.title = `مهلت — ${dl.date} — کلیک برای تغییر`;
}

/* ── Planned span ──
   «۱۴:۰۰ تا ۱۶:۰۰» — the part of the day a task is meant for, or null when it
   has none. One function because three lists show it (the planner, the task
   list, today): a span that read differently in each would be a bug in two of
   them. It is a plan, not an alarm — nothing rings from it. */
export function timeRangeLabel(task) {
  const from = formatClock(task && task.timeFrom);
  const to = formatClock(task && task.timeTo);
  return from && to ? `${from} تا ${to}` : null;
}

/* ── Build Item ── */
function createTaskEl(task, delay = 0) {
  const li = document.createElement('li');
  li.className = 'task' + (task.done ? ' done' : '');
  li.dataset.id = task.id; li.dataset.p = task.p || 'mid';
  li.draggable = true; li.style.animationDelay = delay + 'ms';
  const cat = CATS.find(c => c.key === (task.cat || 'misc')) || CATS[5];
  const dl = dueLabel(task.dueDate);
  const doneLate = dl && task.done && dl.cls === 'late';
  const dueText = dl && (doneLate || dl.ltr) ? `<span dir="ltr">${doneLate ? dl.date : dl.text}</span>` : dl ? dl.text : '';
  const dueHtml = dl
    ? `<button class="due-chip ${doneLate ? 'far' : dl.cls}" title="مهلت — ${dl.date} — کلیک برای تغییر">${dueText}</button>`
    : `<button class="due-chip none" title="افزودن مهلت">+ مهلت</button>`;
  const durLabel = formatDuration(task.durationMin);
  const durHtml = durLabel
    ? `<button class="dur-chip" title="زمان تقریبی: ${durLabel} — کلیک برای تغییر" aria-haspopup="menu">${durLabel}</button>`
    : `<button class="dur-chip none" title="افزودن زمان تقریبی" aria-haspopup="menu">+ زمان</button>`;
  const spanLabel = timeRangeLabel(task);
  const spanHtml = spanLabel ? `<span class="span-chip" title="بازهٔ این کار در روز">${spanLabel}</span>` : '';
  li.innerHTML = `
    <span class="grip" aria-hidden="true">${ICONS.grip}</span>
    <button class="pri-dot" title="اولویت: ${P_LABEL[li.dataset.p]} — کلیک برای تغییر" aria-label="اولویت: ${P_LABEL[li.dataset.p]} — تغییر" aria-haspopup="menu">${PRI_ICONS[li.dataset.p]}</button>
    <button class="check" aria-label="تکمیل">${ICONS.check}</button>
    <span class="title"></span>
    <button class="cat-tag" style="--cc:${cat.color}" title="دسته: ${cat.label} — کلیک برای تغییر" aria-haspopup="menu">${cat.label}</button>
    ${spanHtml}
    ${durHtml}
    ${dueHtml}
    ${notificationsSupported() ? bellHtml(task) : ''}
    <div class="task-menu-wrap">
      <button class="task-more-btn" type="button" aria-label="عملیات کار" title="عملیات بیشتر" aria-haspopup="menu" aria-expanded="false">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
      </button>
      <div class="task-menu" role="menu" hidden>
        <button type="button" class="task-menu-item item-edit" role="menuitem">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
          <span>ویرایش</span>
        </button>
        <button type="button" class="task-menu-item item-up" role="menuitem">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
          <span>بردن بالا</span>
        </button>
        <button type="button" class="task-menu-item item-down" role="menuitem">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>
          <span>بردن پایین</span>
        </button>
        <button type="button" class="task-menu-item item-focus" role="menuitem">
          ${ICONS.clock}
          <span>شروع تمرکز</span>
        </button>
        <button type="button" class="task-menu-item item-del danger" role="menuitem">
          ${ICONS.trash}
          <span>حذف</span>
        </button>
      </div>
    </div>`;
  li.querySelector('.title').textContent = task.text;
  return li;
}

/* ── Lightweight Header Counters & Today's Progress Bar ──
   Updates the footer counter, category chips, and Today's progress track
   (aria-valuenow and width percentage) directly without rebuilding list DOM nodes. */
export function updateCountersAndProgress() {
  const total = state.tasks.length;
  const doneCount = state.tasks.filter(t => t.done).length;
  const t0 = startOfToday().getTime();
  const todayDoneCount = state.tasks.filter(t => t.done && t.doneAt && t.doneAt >= t0).length;

  // 1. Task list footer counter
  const counter = $('#counter');
  if (counter) {
    counter.textContent = total
      ? `${faNum(total - doneCount)} کار باقی‌مانده` + (todayDoneCount ? ` · امروز ${faNum(todayDoneCount)} کار انجام دادی` : '')
      : '';
  }
  const clearBtn = $('#clearBtn');
  if (clearBtn) clearBtn.style.visibility = doneCount ? 'visible' : 'hidden';

  // 2. Category badge counts
  document.querySelectorAll('.cats .cat-chip').forEach(ch => {
    const cntEl = ch.querySelector('.cnt');
    if (!cntEl) return;
    const k = ch.dataset.cat;
    if (ch.dataset.flag === 'nodue') {
      const n = state.tasks.filter(t => !t.done && !t.dueDate).length;
      cntEl.textContent = n ? faNum(n) : '';
      return;
    }
    const n = k === 'all'
      ? state.tasks.filter(t => !t.done).length
      : state.tasks.filter(t => !t.done && (t.cat || 'misc') === k).length;
    cntEl.textContent = n ? faNum(n) : '';
  });

  // 3. Today's Progress Bar (aria-valuenow and width percentage)
  const bar = $('#todayProgBar');
  const track = $('#todayProgTrack');
  const text = $('#todayProgText');
  if (bar && track) {
    const todayK = dueKeyFromOffset(0);
    const pendingToday = state.tasks.filter(t => !t.done && t.dueDate && t.dueDate <= todayK);
    const doneToday = state.tasks.filter(t => t.done && ((t.doneAt && t.doneAt >= t0) || (t.dueDate && t.dueDate === todayK)));
    const todayTotal = pendingToday.length + doneToday.length;
    if (!todayTotal) {
      bar.style.width = '0%';
      track.setAttribute('aria-valuenow', '0');
      if (text) text.textContent = 'هنوز کاری برای امروز ثبت نشده';
    } else {
      const pct = Math.round((doneToday.length / todayTotal) * 100);
      bar.style.width = pct + '%';
      track.setAttribute('aria-valuenow', String(pct));
      bar.classList.toggle('full', pct === 100);
      if (text) {
        text.innerHTML = pct === 100
          ? `آفرین! هر <b>${faNum(todayTotal)}</b> کار امروز انجام شد ${LIB_ICONS?.spark || '✨'}`
          : `<b>${faNum(doneToday.length)}</b> از <b>${faNum(todayTotal)}</b> کار انجام شده · ${faNum(pct)}٪`;
      }
    }
  }
}

/* Surgical DOM update for a single task row — updates attributes, title, tags, chips in-place */
export function updateTaskRow(li, task) {
  if (!li || !task) return;
  li.dataset.p = task.p || 'mid';
  li.classList.toggle('done', !!task.done);

  const titleEl = li.querySelector('.title');
  if (titleEl) titleEl.textContent = task.text;

  const dot = li.querySelector('.pri-dot');
  if (dot) {
    dot.innerHTML = PRI_ICONS[li.dataset.p];
    dot.title = `اولویت: ${P_LABEL[li.dataset.p]} — کلیک برای تغییر`;
    dot.setAttribute('aria-label', `اولویت: ${P_LABEL[li.dataset.p]} — تغییر`);
  }

  const cat = CATS.find(c => c.key === (task.cat || 'misc')) || CATS[5];
  const catBtn = li.querySelector('.cat-tag');
  if (catBtn) {
    catBtn.style.setProperty('--cc', cat.color);
    catBtn.textContent = cat.label;
    catBtn.title = `دسته: ${cat.label} — کلیک برای تغییر`;
  }

  refreshDueChip(li, task);
  refreshDurChip(li, task);
  if (notificationsSupported()) refreshBell(li, task);

  const spanLabel = timeRangeLabel(task);
  let spanEl = li.querySelector('.span-chip');
  if (spanLabel) {
    if (!spanEl) {
      spanEl = document.createElement('span');
      spanEl.className = 'span-chip';
      spanEl.title = 'بازهٔ این کار در روز';
      li.querySelector('.cat-tag')?.after(spanEl);
    }
    spanEl.textContent = spanLabel;
  } else if (spanEl) {
    spanEl.remove();
  }
}

/* ── Chunked Rendering (Infinite Scroll) for Large Lists ──
   In unbounded lists ("All Tasks", "Completed Tasks", etc.), rendering hundreds of
   rows at once blocks the main thread. We render an initial batch of 40 items, and
   observe a sentinel element via IntersectionObserver to append subsequent 40-item
   chunks with DocumentFragment as the user scrolls. */
const CHUNK_SIZE = 40;
const STAGGER_MS = 45;
const STAGGER_CAP = 6;

let renderedCount = 0;
let sentinelEl = null;
let listObserver = null;

function appendNextChunk(allRows) {
  if (renderedCount >= allRows.length) {
    if (listObserver) { listObserver.disconnect(); listObserver = null; }
    if (sentinelEl && sentinelEl.isConnected) sentinelEl.remove();
    sentinelEl = null;
    return;
  }

  const nextBatch = allRows.slice(renderedCount, renderedCount + CHUNK_SIZE);
  renderedCount += nextBatch.length;

  const frag = document.createDocumentFragment();
  nextBatch.forEach(t => frag.appendChild(createTaskEl(t, 0)));

  if (sentinelEl && sentinelEl.isConnected) {
    listEl.insertBefore(frag, sentinelEl);
  } else {
    listEl.appendChild(frag);
  }

  if (renderedCount >= allRows.length) {
    if (listObserver) { listObserver.disconnect(); listObserver = null; }
    if (sentinelEl && sentinelEl.isConnected) sentinelEl.remove();
    sentinelEl = null;
  }
}

function setupSentinelObserver(allRows) {
  if (!sentinelEl) return;
  if (typeof IntersectionObserver === 'undefined') {
    // Graceful fallback for non-browser / test environments
    if (sentinelEl.isConnected) sentinelEl.remove();
    sentinelEl = null;
    const remaining = allRows.slice(renderedCount);
    if (remaining.length) {
      const frag = document.createDocumentFragment();
      remaining.forEach(t => frag.appendChild(createTaskEl(t, 0)));
      listEl.appendChild(frag);
      renderedCount = allRows.length;
    }
    return;
  }

  listObserver = new IntersectionObserver(entries => {
    const entry = entries[0];
    if (entry && entry.isIntersecting) {
      appendNextChunk(allRows);
    }
  }, { rootMargin: '300px 0px' });

  listObserver.observe(sentinelEl);
}

export function renderList() {
  if (listObserver) {
    listObserver.disconnect();
    listObserver = null;
  }
  const rows = visible();
  const initialBatch = rows.slice(0, CHUNK_SIZE);
  renderedCount = initialBatch.length;

  const frag = document.createDocumentFragment();
  initialBatch.forEach((t, i) => frag.appendChild(createTaskEl(t, Math.min(i, STAGGER_CAP) * STAGGER_MS)));

  if (renderedCount < rows.length) {
    sentinelEl = document.createElement('li');
    sentinelEl.className = 'task-sentinel';
    sentinelEl.setAttribute('aria-hidden', 'true');
    sentinelEl.style.cssText = 'height:1px;list-style:none;margin:0;padding:0;border:0;pointer-events:none;';
    frag.appendChild(sentinelEl);
  } else {
    sentinelEl = null;
  }

  listEl.replaceChildren(frag);
  if (sentinelEl) {
    setupSentinelObserver(rows);
  }
  updateEmpty();
  updateCountersAndProgress();
}

export function updateEmpty() {
  const anyVisible = [...listEl.querySelectorAll('.task')].some(el => !el.classList.contains('removing'));
  $('#empty').hidden = anyVisible;
  // The empty-state CTA is presentation-only and rebuilt on each render
  $('#emptyAddBtn')?.remove();
  if (anyVisible) return;
  const allDone = state.tasks.length && state.tasks.every(t => t.done);
  $('#artDone').hidden = !allDone; $('#artEmpty').hidden = allDone;
  const voc = state.userName ? `${state.userName} جان، ` : '';
  $('#emptyMsg').textContent =
    state.query ? 'چیزی پیدا نشد. عبارت دیگری را امتحان کن.'
    : !state.tasks.length ? 'فعلاً کاری روی میز نیست.'
    : state.catFilter !== 'all' ? `توی دستهٔ «${CATS.find(c => c.key === state.catFilter)?.label}» کاری نیست.`
    : state.noDue ? 'کار بدون مهلتی پیدا نشد.'
    : state.filter === 'overdue' ? 'هیچ کاری عقب نیفتاده. آفرین.'
    : state.filter === 'done' ? 'هنوز کاری را تمام نکرده‌ای.'
    : allDone ? 'همهٔ کارهات انجام شده.'
    : voc + 'لیستت خالیه. اولین کارت رو اضافه کن.';
  // A single calm CTA when the shelf is truly empty — no pressure copy
  if (!state.tasks.length || allDone) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'empty-add';
    btn.id = 'emptyAddBtn';
    btn.textContent = allDone ? 'افزودن کار جدید' : 'افزودن کار';
    btn.addEventListener('click', () => $('#taskInput')?.focus());
    $('#empty').appendChild(btn);
  }
}

/* ── Actions ── */

/* Shared completion helper used by the Tasks page and the Today list */
export function setTaskDone(id, done) {
  const task = getTask(id);
  if (!task || task.done === done) return;
  task.done = done;
  if (done) {
    task.doneAt = Date.now();
    recordDay();
    /* The day book keeps what this day showed, so a task deleted tomorrow cannot
       take today's tick back out of the achievements (js/ledger.js). */
    rememberDone();
  } else task.doneAt = null;
  save(); notify();
  if (done && state.tasks.every(t => t.done)) confetti();
}

function toggleTask(li, task) {
  setTaskDone(task.id, !task.done);
  li.classList.toggle('done', task.done);
  refreshDueChip(li, task);
  /* A small answer to every tick, not just to the last one: the box pops, and the
     «امروز N کار» line in the footer bumps (js/progress.js writes it). */
  if (task.done) {
    li.classList.add('just-done'); setTimeout(() => li.classList.remove('just-done'), 700);
    const c = $('#counter'); if (c) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  }
  updateCountersAndProgress();
  if (!matches(task)) setTimeout(() => hideFromView(li), 650);
}

/* Shared creation used by the Tasks form and the Today quick add */
export function addTask(text, p = 'mid', cat = 'misc', dueDate, durationMin = null, time = null) {
  const task = {
    id: Date.now() + '' + Math.random().toString(16).slice(2),
    text, done: false, p, cat,
    created: Date.now(),
    durationMin: parseDurationMin(durationMin),
  };
  task.dueDate = dueDate || null;
  /* The optional span of the day («۲ تا ۴»). Only the planner's quick add asks
     for one; the other two doors pass nothing and the task has no span. */
  const span = parseTimeRange(time && time.from, time && time.to);
  task.timeFrom = span ? span.from : null;
  task.timeTo = span ? span.to : null;
  state.tasks.unshift(task);
  save(); notify();
  tryPersistStorage();
  return task;
}

function tryPersistStorage() {
  requestPersistentStorage();
}

/* ── Moving a task to another day ──
   Changing which day a task is for is a due-date change and nothing else, and
   the due picker already knew how to make one. This is that same change as one
   shared door, so the planner's drag and its arrow keys cannot drift from the
   picker: the span is left alone («۲ تا ۴» is which hours of the day, not which
   day, so a task carried to Thursday is still an afternoon task on Thursday),
   and a moved deadline re-arms the reminder exactly as the picker does — a task
   that already rang has to be able to ring again on its new day. */
export function moveTaskToDay(id, key) {
  const task = getTask(id);
  const to = key || null;
  if (!task || (task.dueDate || null) === to) return false;
  task.dueDate = to;
  if (task.notifiedStatus) task.notifiedStatus = 'none';
  save(); notify();
  return true;
}

/* ── Undo Toast ── */
/* Deletions arrive in the order they were made, because a hand that is tidying
   a list rarely stops after one. Each entry remembers the task and *where it
   sat among that day's visible rows* — an index into state.tasks is useless
   for putting it back, since the list a reader is looking at is filtered and
   the array is not. */
let undoTimer = null, undoQueue = [];
function showUndo(task, index) {
  undoQueue.push({ task, index });
  /* The toast names the task that was just deleted, not the first of the run. */
  const toast = $('#undoToast');
  const title = task && task.text ? (task.text.length > 25 ? task.text.slice(0, 24).trim() + '…' : task.text) : 'کار';
  const label = toast?.querySelector('.toast-text');
  if (label) {
    label.textContent = undoQueue.length > 1
      ? `${faNum(undoQueue.length)} کار حذف شد`
      : `${title} حذف شد`;
  }
  // Reset the toast bar animation
  const bar = toast.querySelector('.toast-bar');
  bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(undoTimer);
  undoTimer = setTimeout(commitUndo, 5000);
}
function commitUndo() {
  const toast = $('#undoToast');
  toast.classList.remove('show');
  setTimeout(() => { toast.hidden = true; }, 300);
  undoQueue = [];
}
function performUndo() {
  if (!undoQueue.length) return;
  clearTimeout(undoTimer);
  /* Newest first, so the list ends up in the order it was before the run of
     deletions rather than reversed. */
  const restored = undoQueue.slice().reverse();
  undoQueue = [];
  for (const { task, index } of restored) {
    const at = Math.min(index, state.tasks.length);
    state.tasks.splice(at, 0, task);
  }
  save();
  /* The DOM is filtered, so the row is put back by matching the task that
     follows it in the model — the same `normalizeFa` comparison the filter
     itself uses — instead of by an array index that counts rows it is not in. */
  const shown = visible();
  for (const { task } of restored) {
    if (!shown.includes(task)) continue;
    const el = createTaskEl(task);
    const at = shown.indexOf(task);
    const nextId = shown[at + 1]?.id;
    const nextEl = nextId ? listEl.querySelector(`[data-id="${nextId}"]`) : null;
    if (nextEl) listEl.insertBefore(el, nextEl);
    else listEl.appendChild(el);
  }
  updateEmpty();
  notify();
  commitUndo();
}

/* Shared exit animation for removing an item from the list (visual only, no state change) */
function animateOut(el, onDone) {
  /* Marked before the first frame so a reconcile on another page (the Today
     list) can tell "leaving on purpose" from "no longer in this view" and
     leave the exit animation alone. */
  el.dataset.exiting = '1';
  const startH = el.offsetHeight;
  el.style.height = startH + 'px';
  el.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.classList.add('removing');
      el.style.height = '0';
      el.style.paddingTop = '0';
      el.style.paddingBottom = '0';
      el.style.marginTop = '0';
      el.style.marginBottom = '0';
      el.style.opacity = '0';
    });
  });
  setTimeout(() => {
    el.remove();
    updateEmpty();
    onDone && onDone();
  }, 290);
}

/* Actually delete a task (trash button) — removes it from state and shows the undo toast */
export function collapse(el, id) {
  const task = state.tasks.find(t => t.id === id);
  /* Where the row sat in the list the reader is looking at, so Undo can put it
     back among the same neighbours rather than at a raw array position. */
  const shown = visible();
  const shownAt = shown.findIndex(t => t.id === id);
  const index = shownAt >= 0 ? shownAt : state.tasks.findIndex(t => t.id === id);
  state.tasks = state.tasks.filter(t => t.id !== id);
  save();
  if (state.session && state.session.taskId === id) clearFocus();
  animateOut(el, () => {
    updateCountersAndProgress();
  });
  notify();
  if (task) showUndo(task, index);
}

/* Hide a task from the current view when it no longer matches the filter/category
   (e.g. after checking it off in the "Active" filter, or changing its category while a category filter is set)
   Unlike collapse, this function does not remove any data from state.tasks. */
export function hideFromView(el) {
  animateOut(el, () => {
    updateCountersAndProgress();
  });
}

function startEditTitle(titleEl, task) {
  const inp = document.createElement('input'); inp.className = 'title-input'; inp.value = task.text;
  titleEl.replaceWith(inp); inp.focus(); inp.select();
  let doneE = false;
  const finish = () => {
    if (doneE) return;
    doneE = true;
    const v = inp.value.trim();
    if (v && v !== task.text) {
      task.text = v;
      save();
      notify();
    }
    titleEl.textContent = task.text;
    inp.replaceWith(titleEl);
  };
  inp.addEventListener('blur', finish);
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') finish();
    if (ev.key === 'Escape') {
      doneE = true;
      titleEl.textContent = task.text;
      inp.replaceWith(titleEl);
    }
  });
}

export function flashTask(id) {
  const el = listEl.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
}

/* ── Drag and Drop ── */
function syncOrder() {
  /* Only the rows on screen were reordered. Tasks a filter or a search hides keep
     the slots they held — they used to be appended after the visible ones, so
     dragging inside «انجام شده» silently re-sorted the whole list. */
  const order = [...listEl.querySelectorAll('.task')].map(el => el.dataset.id);
  state.tasks = reorderSubset(state.tasks, order);
  save();
}

/* ── Edits from the pickers and the sheet ── */
function setPriority(li, task, p) {
  if (!P_LABEL[p] || p === (task.p || 'mid')) return;
  task.p = p; save();
  li.dataset.p = p;
  const dot = li.querySelector('.pri-dot');
  if (dot) {
    dot.innerHTML = PRI_ICONS[p];
    dot.title = `اولویت: ${P_LABEL[p]} — کلیک برای تغییر`;
    dot.setAttribute('aria-label', `اولویت: ${P_LABEL[p]} — تغییر`);
    animatePriDotChange(dot);
  }
  notify();
}

function applyEdits(task, c) {
  task.text = c.text;
  task.p = P_LABEL[c.p] ? c.p : (task.p || 'mid');
  task.cat = CATS.some(x => x.key === c.cat) ? c.cat : (task.cat || 'misc');
  const dateChanged = (task.dueDate || null) !== (c.dueDate || null);
  task.dueDate = c.dueDate || null;
  // A new deadline re-arms the reminder so nothing fires twice for one date
  if (dateChanged && task.notifiedStatus) task.notifiedStatus = 'none';
  task.durationMin = parseDurationMin(c.durationMin);
  save(); notify();

  const row = listEl.querySelector(`[data-id="${task.id}"]`);
  if (row) {
    if (!matches(task) || (state.catFilter !== 'all' && (task.cat || 'misc') !== state.catFilter) || (state.noDue && task.dueDate)) {
      hideFromView(row);
    } else {
      updateTaskRow(row, task);
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 1200);
    }
  } else if (matches(task) && (state.catFilter === 'all' || (task.cat || 'misc') === state.catFilter) && (!state.noDue || !task.dueDate)) {
    renderList();
  }
  updateEmpty();
  updateCountersAndProgress();
}

/* ── Reordering without a mouse ──
   One step up or down among the rows on screen: the ⋯ menu's «بردن بالا/پایین»
   and Alt+↑/↓ on a focused row both land here. The DOM is swapped and the
   saved order follows through syncOrder, the same path a drag uses. */
const liveNote = msg => { const n = $('#taskLive'); if (n) { n.textContent = ''; n.textContent = msg; } };
export function moveTask(id, step) {
  const rows = [...listEl.querySelectorAll('.task:not(.removing)')];
  const ids = rows.map(r => r.dataset.id);
  const next = stepOrder(ids, id, step);
  if (next === ids) { liveNote(step < 0 ? 'این کار بالاترین است.' : 'این کار پایین‌ترین است.'); return false; }
  const li = rows[ids.indexOf(id)], other = rows[ids.indexOf(id) + step];
  const hadFocus = li.contains(document.activeElement);
  const first = li.getBoundingClientRect().top;
  if (step < 0) listEl.insertBefore(li, other); else listEl.insertBefore(other, li);
  syncOrder();
  if (hadFocus) { li.setAttribute('tabindex', '-1'); li.focus({ preventScroll: true }); }
  li.scrollIntoView({ block: 'nearest' });
  const dy = first - li.getBoundingClientRect().top;
  if (dy && !prefersReducedMotion()) {
    li.style.transition = 'none'; li.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => { li.style.transition = 'transform 200ms cubic-bezier(.2,0,0,1)'; li.style.transform = ''; });
  }
  liveNote(`به جایگاه ${faNum(ids.indexOf(id) + step + 1)} از ${faNum(ids.length)} رفت.`);
  return true;
}

/* Re-seats `dragging` among its siblings for a pointer at `clientY`. Shared by the
   mouse drag (dragover) and the touch drag (the grip), so the two cannot differ. */
function placeRow(dragging, clientY) {
  const siblings = [...listEl.querySelectorAll('.task')].filter(el => el !== dragging);
  const target = siblings.find(el => clientY < el.getBoundingClientRect().top + el.offsetHeight / 2) || null;
  if (target === dragging.nextElementSibling) return;
  if (!target && dragging === listEl.lastElementChild) return;
  const rects = new Map();
  siblings.forEach(el => rects.set(el, el.getBoundingClientRect().top));
  if (target) listEl.insertBefore(dragging, target); else listEl.appendChild(dragging);
  siblings.forEach(el => {
    const delta = rects.get(el) - el.getBoundingClientRect().top;
    if (delta !== 0) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 220ms cubic-bezier(.2,0,0,1)';
        el.style.transform = '';
      });
    }
  });
}

/* ── Events ── */
export function initTasks() {
  if (!listEl && typeof document !== 'undefined') listEl = $('#taskList');
  if (!listEl) return;
  initTaskEditor();
  listEl.addEventListener('click', async e => {
    const li = e.target.closest('.task'); if (!li) return;
    const task = getTask(li.dataset.id); if (!task) return;
    if (e.target.closest('.check')) toggleTask(li, task);
    else if (e.target.closest('.task-more-btn')) {
      const wrap = e.target.closest('.task-menu-wrap');
      const menu = wrap?.querySelector('.task-menu');
      const btn = wrap?.querySelector('.task-more-btn');
      const wasHidden = menu?.hidden;
      document.querySelectorAll('.task-menu').forEach(m => { m.hidden = true; });
      document.querySelectorAll('.task-more-btn').forEach(b => { b.setAttribute('aria-expanded', 'false'); });
      if (menu && wasHidden) {
        menu.hidden = false;
        btn?.setAttribute('aria-expanded', 'true');
        openMenuAboveNav(menu);
      }
    }
    else if (e.target.closest('.item-edit')) {
      const menu = li.querySelector('.task-menu');
      if (menu) menu.hidden = true;
      openTaskEditor(task, changes => applyEdits(task, changes), li.querySelector('.task-more-btn'));
    }
    else if (e.target.closest('.item-up') || e.target.closest('.item-down')) {
      const up = !!e.target.closest('.item-up');
      const menu = li.querySelector('.task-menu');
      if (menu) menu.hidden = true;
      li.querySelector('.task-more-btn')?.setAttribute('aria-expanded', 'false');
      moveTask(task.id, up ? -1 : 1);
    }
    else if (e.target.closest('.item-focus') || e.target.closest('.focus-btn')) {
      const menu = li.querySelector('.task-menu');
      if (menu) menu.hidden = true;
      openFocus(task.id);
    }
    else if (e.target.closest('.item-del') || e.target.closest('.del')) {
      const menu = li.querySelector('.task-menu');
      if (menu) menu.hidden = true;
      collapse(li, task.id);
    }
    else if (e.target.closest('.pri-dot')) {
      const dot = e.target.closest('.pri-dot');
      openChipPicker(dot, {
        label: 'اولویت', options: priOptions(), current: task.p || 'mid',
        onPick: v => { setPriority(li, task, v); dot.isConnected && dot.focus({ preventScroll: true }); },
      });
    }
    else if (e.target.closest('.cat-tag')) {
      const btn = e.target.closest('.cat-tag');
      openChipPicker(btn, {
        label: 'دسته', options: catOptions(), current: task.cat || 'misc',
        onPick: v => {
          const nxt = CATS.find(c => c.key === v); if (!nxt || nxt.key === (task.cat || 'misc')) { btn.focus({ preventScroll: true }); return; }
          task.cat = nxt.key; save();
          btn.style.setProperty('--cc', nxt.color); btn.textContent = nxt.label;
          btn.title = `دسته: ${nxt.label} — کلیک برای تغییر`;
          animateChipFlip(btn); notify();
          if (state.catFilter !== 'all' && state.catFilter !== nxt.key) setTimeout(() => hideFromView(li), 500);
          else btn.focus({ preventScroll: true });
        },
      });
    }
    else if (e.target.closest('.due-chip')) {
      // Open the Jalali date picker to add / change / remove the deadline
      openDuePicker({
        current: task.dueDate || null,
        onPick: key => {
          const dateChanged = task.dueDate !== key;
          task.dueDate = key; save();
          // A new deadline re-arms the reminder so nothing fires twice for one date
          if (dateChanged && task.notifiedStatus) task.notifiedStatus = 'none';
          refreshDueChip(li, task);
          const chip = li.querySelector('.due-chip');
          if (chip) animateChipFlip(chip);
          notify();
        },
      });
    }
    else if (e.target.closest('.bell-btn')) {
      const next = !(task.notify === true);
      const granted = await setTaskNotify(task, next);
      if (granted) {
        refreshBell(li, task);
        const bell = li.querySelector('.bell-btn');
        if (bell) animateChipFlip(bell);
      }
    }
    else if (e.target.closest('.dur-chip')) {
      const btn = e.target.closest('.dur-chip');
      openChipPicker(btn, {
        label: 'زمان تقریبی', options: durOptions(), current: task.durationMin || null,
        custom: { label: 'یا زمان دلخواه (دقیقه)' },
        onPick: v => {
          task.durationMin = parseDurationMin(v); save();
          refreshDurChip(li, task); const chip = li.querySelector('.dur-chip');
          if (chip) { animateChipFlip(chip); chip.focus({ preventScroll: true }); }
          notify();
        },
      });
    }
  });

  /* Outside click and Escape to close task menus */
  document.addEventListener('click', e => {
    if (!e.target.closest('.task-menu-wrap')) {
      document.querySelectorAll('.task-menu').forEach(m => { m.hidden = true; });
      document.querySelectorAll('.task-more-btn').forEach(b => { b.setAttribute('aria-expanded', 'false'); });
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.task-menu').forEach(m => { m.hidden = true; });
      document.querySelectorAll('.task-more-btn').forEach(b => { b.setAttribute('aria-expanded', 'false'); });
    }
  });

  /* Double-click on a title renames it in place; every other field has its picker. */
  listEl.addEventListener('dblclick', e => {
    const li = e.target.closest('.task'); if (!li) return;
    const task = getTask(li.dataset.id); if (!task) return;
    const titleEl = e.target.closest('.title');
    if (titleEl) {
      startEditTitle(titleEl, task);
      return;
    }
  });

  let activeDragId = null;
  const clearDragVisuals = () => {
    document.querySelectorAll('.task.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.task').forEach(el => {
      el.style.transition = '';
      el.style.transform = '';
    });
    document.querySelectorAll('.drag-target-over').forEach(el => el.classList.remove('drag-target-over'));
    activeDragId = null;
  };

  listEl.addEventListener('dragstart', e => {
    const li = e.target.closest('.task');
    if (!li) return;
    activeDragId = li.dataset.id;
    e.dataTransfer.setData('text/plain', li.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      li.classList.add('dragging');
    }, 0);
  });

  listEl.addEventListener('dragend', () => {
    clearDragVisuals();
    syncOrder();
  });

  listEl.addEventListener('drop', e => {
    e.preventDefault();
    clearDragVisuals();
    syncOrder();
  });

  listEl.addEventListener('dragover', e => {
    e.preventDefault();
    const dragging = listEl.querySelector('.task.dragging') || (activeDragId ? listEl.querySelector(`[data-id="${activeDragId}"]`) : null);
    if (!dragging) return;
    placeRow(dragging, e.clientY);
  });

  /* Touch / pen: the grip is the handle. Native drag-and-drop does not start from
     a finger on most phones, so the grip follows the pointer itself. */
  listEl.addEventListener('pointerdown', e => {
    const grip = e.target.closest('.grip');
    if (!grip || e.pointerType === 'mouse' || e.button > 0) return;
    const li = grip.closest('.task'); if (!li) return;
    e.preventDefault();
    li.classList.add('dragging', 'touch-drag');
    try { grip.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    const move = ev => { placeRow(li, ev.clientY); const r = li.getBoundingClientRect();
      if (ev.clientY < 90) scrollBy(0, -12); else if (ev.clientY > innerHeight - 140) scrollBy(0, 12); void r; };
    const end = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      li.classList.remove('dragging', 'touch-drag');
      clearDragVisuals(); syncOrder();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  });

  /* Cross-section drag: Category chips (#cats) */
  const catsBar = $('#cats');
  if (catsBar) {
    catsBar.addEventListener('dragover', e => {
      const chip = e.target.closest('.cat-chip');
      if (!chip || chip.dataset.cat === 'all') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      catsBar.querySelectorAll('.cat-chip.drag-target-over').forEach(c => {
        if (c !== chip) c.classList.remove('drag-target-over');
      });
      chip.classList.add('drag-target-over');
    });
    catsBar.addEventListener('dragleave', e => {
      const chip = e.target.closest('.cat-chip');
      if (chip && !chip.contains(e.relatedTarget)) {
        chip.classList.remove('drag-target-over');
      }
    });
    catsBar.addEventListener('drop', e => {
      const chip = e.target.closest('.cat-chip');
      if (!chip || chip.dataset.cat === 'all') return;
      e.preventDefault();
      chip.classList.remove('drag-target-over');
      const id = e.dataTransfer.getData('text/plain') || activeDragId;
      const task = getTask(id);
      if (!task) return;
      /* Dropping on «بدون مهلت» takes the deadline off (it used to be a pill). */
      if (chip.dataset.flag === 'nodue') {
        if (task.dueDate) {
          task.dueDate = undefined; save(); notify();
          const el = listEl.querySelector(`[data-id="${id}"]`);
          if (el) {
            refreshDueChip(el, task);
            if (state.noDue) hideFromView(el);
          }
          updateCountersAndProgress();
        }
        return;
      }
      const targetCat = chip.dataset.cat;
      if (task.cat !== targetCat) {
        task.cat = targetCat;
        save();
        notify();
        chip.classList.remove('drop-pop');
        void chip.offsetWidth;
        chip.classList.add('drop-pop');
        setTimeout(() => chip.classList.remove('drop-pop'), 260);
        const el = listEl.querySelector(`[data-id="${id}"]`);
        if (el) {
          if (state.catFilter !== 'all' && state.catFilter !== targetCat) {
            hideFromView(el);
          } else {
            updateTaskRow(el, task);
          }
        }
        updateCountersAndProgress();
      }
    });
  }

  /* Cross-section drag: Filter buttons (#filters) */
  const filtersBar = $('#filters');
  if (filtersBar) {
    filtersBar.addEventListener('dragover', e => {
      const btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      filtersBar.querySelectorAll('button.drag-target-over').forEach(b => {
        if (b !== btn) b.classList.remove('drag-target-over');
      });
      btn.classList.add('drag-target-over');
    });
    filtersBar.addEventListener('dragleave', e => {
      const btn = e.target.closest('button[data-filter]');
      if (btn && !btn.contains(e.relatedTarget)) {
        btn.classList.remove('drag-target-over');
      }
    });
    filtersBar.addEventListener('drop', e => {
      const btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      e.preventDefault();
      btn.classList.remove('drag-target-over');
      const id = e.dataTransfer.getData('text/plain') || activeDragId;
      const task = getTask(id);
      if (!task) return;
      const f = btn.dataset.filter;
      btn.classList.remove('drop-pop');
      void btn.offsetWidth;
      btn.classList.add('drop-pop');
      setTimeout(() => btn.classList.remove('drop-pop'), 260);

      if (f === 'done' && !task.done) {
        setTaskDone(task.id, true);
        const el = listEl.querySelector(`[data-id="${task.id}"]`);
        if (el) {
          el.classList.toggle('done', true);
          refreshDueChip(el, task);
          if (!matches(task)) hideFromView(el);
        }
        updateCountersAndProgress();
      } else if (f === 'active' && task.done) {
        setTaskDone(task.id, false);
        const el = listEl.querySelector(`[data-id="${task.id}"]`);
        if (el) {
          el.classList.toggle('done', false);
          refreshDueChip(el, task);
          if (!matches(task)) hideFromView(el);
        }
        updateCountersAndProgress();
      }
    });
  }

  /* Cross-section drag: Today nav tabs ([data-page="today"]) */
  document.querySelectorAll('[data-page="today"]').forEach(tab => {
    tab.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tab.classList.add('drag-target-over');
    });
    tab.addEventListener('dragleave', e => {
      if (!tab.contains(e.relatedTarget)) tab.classList.remove('drag-target-over');
    });
    tab.addEventListener('drop', e => {
      e.preventDefault();
      tab.classList.remove('drag-target-over');
      const id = e.dataTransfer.getData('text/plain') || activeDragId;
      const task = getTask(id);
      if (!task) return;
      task.dueDate = dueKeyFromOffset(0);
      save();
      notify();
      tab.classList.remove('drop-pop');
      void tab.offsetWidth;
      tab.classList.add('drop-pop');
      setTimeout(() => tab.classList.remove('drop-pop'), 260);
      const el = listEl.querySelector(`[data-id="${id}"]`);
      if (el) {
        refreshDueChip(el, task);
        if (state.noDue) hideFromView(el);
      }
      updateCountersAndProgress();
    });
  });

  window.addEventListener('dragend', clearDragVisuals);

  /* Clear-search button with 120ms debounce */
  const searchInput = $('#searchInput'), searchClear = $('#searchClear');
  if (searchInput && searchClear) {
    let sT = null;
    searchInput.addEventListener('input', () => {
      searchClear.hidden = !searchInput.value;
      clearTimeout(sT);
      sT = setTimeout(() => {
        state.query = searchInput.value.trim();
        renderList();
      }, 120);
    });
    searchClear.addEventListener('click', () => {
      clearTimeout(sT);
      searchInput.value = ''; state.query = ''; searchClear.hidden = true;
      renderList(); searchInput.focus();
    });
  }

  /* Undo button */
  const undoBtn = $('#undoBtn');
  if (undoBtn) undoBtn.addEventListener('click', performUndo);
}

/* ── Add Form ── */
export function initAddForm() {
  /* The four option rows live behind «جزئیات». The text box alone is the fast
     path (the parser fills the rest from the sentence); the dot on the toggle says
     that something other than the defaults is already chosen, so a collapsed form
     never hides a setting that is about to be applied. */
  const more = $('#addMore'), moreBtn = $('#addMoreToggle'), addErr = $('#addError');
  const hasDetails = () => state.selPri !== 'mid' || state.selDue !== 'none' || state.selDur != null;
  const syncMoreBtn = () => { if (moreBtn) moreBtn.classList.toggle('has-values', hasDetails()); };
  /* Details that came from the typed sentence, as opposed to a chip the person
     tapped. Only these are given back when the sentence stops saying them, and
     when the task is saved — otherwise «فردا ۳۰ دقیقه #خرید» left tomorrow, thirty
     minutes and the shopping category on every task typed afterwards, and with
     the rows folded away nothing on screen said so. A tapped chip stays sticky. */
  const fromText = { due: false, dur: false };
  const resetDetail = key => {
    fromText[key] = false;
    if (key === 'due') {
      state.selDue = 'none';
      if (typeof renderDueRow === 'function') renderDueRow();
    } else if (key === 'dur') {
      state.selDur = null;
      $('#durRow .sel')?.classList.remove('sel');
      $('#durRow button[data-dur="none"]')?.classList.add('sel');
    }
    syncMoreBtn();
  };
  if (more && moreBtn) {
    moreBtn.addEventListener('click', () => {
      const open = more.hidden;
      more.hidden = !open;
      moreBtn.setAttribute('aria-expanded', String(open));
    });
  }

  $('#priRow').addEventListener('click', e => {
    const b = e.target.closest('button[data-p]'); if (!b) return;
    document.querySelector('.pri-row .sel')?.classList.remove('sel');
    b.classList.add('sel'); state.selPri = b.dataset.p;
  });
  /* The category is no longer chosen in this form: the chips bar above the list is
     the one place that holds it. A task is filed under the category chip that is
     open (or under #tag from the sentence), and the row's chip or the edit sheet
     changes it afterwards. */
  /* Due date row: quick options امروز/فردا/پس‌فردا + Jalali picker for a custom date */
  const dueRow = $('#dueRow');
  const dueCustomBtn = $('#dueCustom');
  const renderDueRow = () => {
    if (!dueRow || !dueCustomBtn) return;
    syncMoreBtn();
    dueRow.querySelectorAll('button[data-due]').forEach(b => b.classList.remove('sel'));
    if (/^\d{4}-\d{2}-\d{2}$/.test(state.selDue)) {
      dueCustomBtn.classList.add('sel');
      dueCustomBtn.textContent = formatJalaliDate(new Date(state.selDue + 'T00:00:00'));
    } else {
      const q = dueRow.querySelector(`button[data-due="${state.selDue}"]`);
      if (q) q.classList.add('sel');
      dueCustomBtn.textContent = 'تاریخ…';
    }
  };
  dueRow.addEventListener('click', e => {
    const b = e.target.closest('button[data-due]'); if (!b) return;
    fromText.due = false;
    if (b.dataset.due === 'custom') {
      openDuePicker({
        current: /^\d{4}-\d{2}-\d{2}$/.test(state.selDue) ? state.selDue : null,
        onPick: key => { state.selDue = key; renderDueRow(); },
      });
      return;
    }
    state.selDue = b.dataset.due;
    renderDueRow();
  });
  renderDueRow();

  /* Duration row: presets, plus a custom minute input with validation */
  const durInput = $('#durCustom');
  const durHint = $('#durHint');
  const showDurHint = show => {
    if (durHint) {
      durHint.textContent = 'زمان باید عددی صحیح بین ۱ تا ۴۸۰ دقیقه باشه';
      durHint.hidden = !show;
    }
  };
  $('#durRow').addEventListener('click', e => {
    const b = e.target.closest('button[data-dur]'); if (!b) return;
    fromText.dur = false;
    $('#durRow .sel')?.classList.remove('sel');
    b.classList.add('sel');
    const v = b.dataset.dur;
    if (v === 'custom') {
      if (durInput) { durInput.hidden = false; durInput.focus(); }
      state.selDur = parseDurationMin(durInput ? durInput.value : null);
    } else {
      if (durInput) { durInput.hidden = true; durInput.value = ''; }
      state.selDur = v === 'none' ? null : Number(v);
    }
    showDurHint(false);
  });
  if (durInput) {
    durInput.addEventListener('input', () => {
      state.selDur = parseDurationMin(durInput.value);
      showDurHint(durInput.value !== '' && state.selDur === null);
    });
    durInput.addEventListener('blur', () => { if (durInput.value === '') showDurHint(false); });
  }

  const taskInput = $('#taskInput');
  const taskPreview = $('#taskQuickAddPreview');
  let quickAddTimer = null;
  if (taskInput && taskPreview) {
    /* A token the parser set aside has no raw span in `parsed.tokens` yet, so
       the × used to be a dead button: the chip vanished, then the next
       keystroke parsed the same text and brought it straight back. The
       dismissed spellings are remembered and filtered out of every preview
       until the input changes under them. */
    const dismissed = new Set();
    const withoutDismissed = parsed => {
      if (!dismissed.size || !parsed.ignored) return parsed;
      const ignored = parsed.ignored.filter(t => !dismissed.has(t));
      return ignored.length === parsed.ignored.length ? parsed : { ...parsed, ignored };
    };

    const processQuickAdd = () => {
      const raw = taskInput.value;
      const parsed = withoutDismissed(parseQuickAdd(raw));
      /* A dismissed spelling is forgotten as soon as it is really gone from the
         field: retyping «ساعت ۲۵» afterwards is a fresh, deliberate act. */
      for (const token of dismissed) if (!raw.includes(token)) dismissed.delete(token);
      renderQuickAddPreview(taskPreview, parsed, key => {
        if (key === 'due') state.selDue = 'none';
        if (key === 'dur') state.selDur = null;
        if (key === 'ignored') {
          (parsed.ignored || []).forEach(t => {
            dismissed.add(t);
            taskInput.value = stripQuickAddToken(taskInput.value, t);
          });
          processQuickAdd();
          return;
        }
        renderDueRow();
        const token = parsed.tokens?.[key];
        if (token) {
          taskInput.value = stripQuickAddToken(taskInput.value, token);
          processQuickAdd();
        } else {
          taskPreview.querySelector(`[data-key="${key}"]`)?.remove();
          if (!taskPreview.children.length) taskPreview.hidden = true;
        }
      });
      if (parsed.dueDate) {
        state.selDue = parsed.dueDate; fromText.due = true;
        renderDueRow();
      } else if (fromText.due) resetDetail('due');
      if (parsed.durationMin) {
        state.selDur = parsed.durationMin; fromText.dur = true;
        $('#durRow .sel')?.classList.remove('sel');
        $(`#durRow button[data-dur="${parsed.durationMin}"]`)?.classList.add('sel');
      } else if (fromText.dur) resetDetail('dur');
    };

    taskInput.addEventListener('input', () => {
      clearTimeout(quickAddTimer);
      quickAddTimer = setTimeout(processQuickAdd, 120);
    });
  }

  /* Every chip, picker and parsed token ends up in `state`; one listener per kind
     of event on the form keeps the toggle's dot and the empty-submit message in
     step with it, instead of a call in each of those handlers. */
  $('#addForm').addEventListener('click', syncMoreBtn);
  $('#addForm').addEventListener('input', () => { syncMoreBtn(); if (addErr) addErr.hidden = true; });

  $('#addForm').addEventListener('submit', e => {
    e.preventDefault();
    clearTimeout(quickAddTimer);
    /* `e.currentTarget` is null once the handler has returned, so the timeout
       below must hold the form itself — reading it there threw, and the red
       shake border was never taken off again. */
    const form = e.currentTarget;
    const input = $('#taskInput'), raw = input ? input.value.trim() : '';
    if (!raw) {
      form.classList.add('shake'); setTimeout(() => form.classList.remove('shake'), 350);
      /* A shake alone says «no» without saying why. */
      if (addErr) addErr.hidden = false;
      if (input) input.focus();
      return;
    }
    if (addErr) addErr.hidden = true;
    const parsed = parseQuickAdd(raw);
    const text = parsed.text || raw;
    const dueVal = parsed.dueDate || (state.selDue === 'none' ? undefined
      : /^\d{4}-\d{2}-\d{2}$/.test(state.selDue) ? state.selDue : dueKeyFromOffset(Number(state.selDue)));
    const catVal = parsed.cat || (state.catFilter !== 'all' ? state.catFilter : 'misc');
    const durVal = parsed.durationMin !== null ? parsed.durationMin : state.selDur;
    const timeSpan = (parsed.timeFrom !== null && parsed.timeTo !== null) ? { from: parsed.timeFrom, to: parsed.timeTo } : null;
    const task = addTask(text, state.selPri, catVal, dueVal, durVal, timeSpan);
    const addBtn = e.currentTarget.querySelector('.add-btn');
    if (addBtn) {
      addBtn.classList.remove('add-pop');
      void addBtn.offsetWidth;
      addBtn.classList.add('add-pop');
      setTimeout(() => addBtn.classList.remove('add-pop'), 340);
    }
    if (matches(task) && (state.catFilter === 'all' || state.catFilter === catVal) && (!state.noDue || !task.dueDate) && !state.query) {
      const el = createTaskEl(task);
      listEl.prepend(el);
      // Glow highlight on the newly added task
      el.classList.add('just-added');
      setTimeout(() => el.classList.remove('just-added'), 1500);
      updateEmpty();
    }
    if (taskPreview) { taskPreview.hidden = true; taskPreview.innerHTML = ''; }
    input.value = ''; input.focus();
    for (const key of ['due', 'dur']) if (fromText[key]) resetDetail(key);
    // Hide the clear-search button
    const sc = $('#searchClear'); if (sc) sc.hidden = true;
  });
}
