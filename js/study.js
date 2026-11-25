/* ═══ Academic / Student Workspace UI (#page-study) ═══
   Calm hub for Semesters, Courses, Class Schedule (Saturday..Friday),
   Exam Countdowns, and Linked Tasks & PDF Books.
*/

import { state } from './state.js';
import { $, esc, faNum, dayKey, formatClock, parseTimeRange } from './utils.js';
import { loadStudy, saveStudy } from './store.js';
import { subscribe, notify } from './bus.js';
import { createTask, toggleTaskDone } from './taskrepo.js';
import { getBooks, updateBook, renderShelf } from './library.js';
import { openDuePicker } from './duepicker.js';
import { openFocus } from './focus.js';
import { confirmDialog } from './dialog.js';
import { LIB_ICONS } from './constants.js';
import { formatJalaliDate } from './jalali.js';
import {
  STUDY_WEEKDAYS,
  STUDY_ROLES,
  COURSE_COLOR_TOKENS,
  COURSE_COLOR_LABELS,
  PARITY_LABELS,
  SCHOOL_BELL_PRESETS,
  EXAM_KIND_PRESETS,
  courseColorCss,
  getStudyRoleLabels,
  getJalaliWeekParity,
  detectScheduleConflicts,
  getNextClassHighlight,
  normalizeExamTime,
  normalizeCourse,
  normalizeStudyData,
  iranianWeekdayFromKey,
  getUpcomingExams,
  getTodayClasses,
  getClassStatus,
  computeCourseStats,
  computeSemesterSummary,
} from './study-logic.js';

let scheduleMode = 'today'; // 'today' | 'week'
let weekParityFilter = 'all'; // 'all' | 'even' | 'odd'
let activeDetailCourseId = null;
let editingCourseId = null;
let returnToDetailId = null;
let draftExamDate = null;
let draftColorToken = 'accent';
let draftSessions = [];

const initializedRoots = new WeakSet();

const CLASS_STATUS_LABEL = {
  live: 'در حال برگزاری',
  done: 'برگزار شده',
  upcoming: 'پیش رو',
};

function getStudyData() {
  const norm = normalizeStudyData(state.study && typeof state.study === 'object' ? state.study : loadStudy());
  state.study = norm;
  return norm;
}

function persistStudy(nextData) {
  const norm = normalizeStudyData(nextData);
  state.study = norm;
  saveStudy(norm);
  notify();
  return norm;
}

function activeCoursesOf(data = getStudyData()) {
  return data.courses.filter(c => c && !c.deletedAt);
}

function findCourse(id) {
  return getStudyData().courses.find(c => c && c.id === id && !c.deletedAt) || null;
}

function activeTasksList() {
  return (Array.isArray(state.tasks) ? state.tasks : []).filter(t => t && !t.deletedAt);
}

function hasAnyParitySessions(courses) {
  return courses.some(c => !c.deletedAt && c.sessions.some(s => s.parity === 'even' || s.parity === 'odd'));
}

function switchStudentRole(nextRole) {
  const cur = getStudyData();
  const normRole = nextRole === STUDY_ROLES.SCHOOL ? STUDY_ROLES.SCHOOL : STUDY_ROLES.UNIVERSITY;
  if (cur.role === normRole) return;
  const oldDefault = getStudyRoleLabels(cur.role).periodDefault;
  const newDefault = getStudyRoleLabels(normRole).periodDefault;
  const activeSemester = (!cur.activeSemester || cur.activeSemester === oldDefault)
    ? newDefault
    : cur.activeSemester;
  persistStudy({ ...cur, role: normRole, activeSemester });
  renderStudyPage();
}

/* ── Header: Role Switcher, Period & Exams Strip ── */
function renderHeader(data) {
  const labels = getStudyRoleLabels(data.role);
  const label = $('#studySemesterLabel');
  const semBtn = $('#studySemesterEditBtn');
  const semInput = $('#studySemesterInput');
  if (label) label.textContent = data.activeSemester || labels.periodDefault;
  if (semBtn) semBtn.setAttribute('title', labels.periodTitle);
  if (semInput) semInput.setAttribute('placeholder', labels.periodPlaceholder);

  document.querySelectorAll('#studyRoleSwitch [data-role]').forEach(btn => {
    const isSel = btn.dataset.role === data.role;
    btn.classList.toggle('is-active', isSel);
    btn.setAttribute('aria-pressed', String(isSel));
  });
}

function renderExamsStrip(courses, todayKeyStr) {
  const sec = $('#studyExamsSec');
  const list = $('#studyExamsList');
  if (!sec || !list) return;

  const upcoming = getUpcomingExams(courses, todayKeyStr);
  sec.hidden = upcoming.length === 0;
  if (!upcoming.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = upcoming.map(ex => `
    <button type="button" class="study-exam-card" data-course-id="${esc(ex.courseId)}" style="--course-c:${courseColorCss(ex.colorToken)}">
      <div class="study-exam-top">
        <span class="study-exam-name">${esc(ex.name)}</span>
        <span class="study-exam-badge${ex.daysLeft <= 2 ? ' is-soon' : ''}">${esc(ex.countdownLabel)}</span>
      </div>
      <div class="study-exam-meta">
        ${ex.examKind ? `<span>${esc(ex.examKind)}</span><span>·</span>` : ''}
        <span dir="ltr">${esc(ex.jalaliDate)}</span>
        ${ex.examTime ? `<span>· ساعت ${esc(ex.examTime)}</span>` : ''}
      </div>
      ${ex.examScope ? `<div class="study-exam-scope">${esc(ex.examScope)}</div>` : ''}
    </button>
  `).join('');
}

/* ── Schedule Section (Today Spotlight / Weekly Sat..Fri) ── */
function renderNextBanner(active, todayKeyStr, nowMin, labels) {
  const host = $('#studyNextBannerHost');
  if (!host) return;
  const spot = getNextClassHighlight(active, todayKeyStr, nowMin);
  if (!spot) {
    host.innerHTML = '';
    return;
  }
  if (spot.state === 'live') {
    host.innerHTML = `
      <button type="button" class="study-next-banner is-live" data-course-id="${esc(spot.item.courseId)}" style="--course-c:${courseColorCss(spot.item.colorToken)}">
        <span>در حال برگزاری: <strong>${esc(spot.item.courseName)}</strong>${spot.item.room ? ` · ${esc(spot.item.room)}` : ''}</span>
        <span class="study-next-pill">${faNum(spot.minutesDelta)} دقیقه مانده</span>
      </button>`;
    return;
  }
  if (spot.state === 'upcoming') {
    const waitText = spot.minutesDelta < 60
      ? `تا ${faNum(spot.minutesDelta)} دقیقهٔ دیگر`
      : `ساعت ${formatClock(spot.item.timeFrom)}`;
    host.innerHTML = `
      <button type="button" class="study-next-banner is-upcoming" data-course-id="${esc(spot.item.courseId)}" style="--course-c:${courseColorCss(spot.item.colorToken)}">
        <span>برنامهٔ بعدی: <strong>${esc(spot.item.courseName)}</strong>${spot.item.room ? ` · ${esc(spot.item.room)}` : ''}</span>
        <span class="study-next-pill">${esc(waitText)}</span>
      </button>`;
    return;
  }
  host.innerHTML = `<div class="study-next-banner is-done"><span>${esc(labels.scheduleDoneLabel)}</span></div>`;
}

function renderTodayClassRow(item, nowMin) {
  const st = getClassStatus(item, nowMin);
  const parityNote = item.parity && item.parity !== 'all' ? ` · ${PARITY_LABELS[item.parity]}` : '';
  const metaParts = [esc(item.timeLabel)];
  if (item.room) metaParts.push(`کلاس ${esc(item.room)}`);
  if (item.instructor) metaParts.push(esc(item.instructor));
  if (parityNote) metaParts.push(esc(PARITY_LABELS[item.parity]));

  return `
    <li class="study-class-row is-${st}" data-course-id="${esc(item.courseId)}" style="--course-c:${courseColorCss(item.colorToken)}">
      <span class="study-class-dot" aria-hidden="true"></span>
      <div class="study-class-info">
        <div class="study-class-top">
          <strong>${esc(item.courseName)}</strong>
          <span class="study-class-status is-${st}">${esc(CLASS_STATUS_LABEL[st])}</span>
        </div>
        <span class="study-class-sub">${metaParts.join(' · ')}</span>
      </div>
    </li>`;
}

function renderWeekSessionPill(s) {
  const pBadge = s.parity !== 'all' ? ` · ${s.parity === 'even' ? 'زوج' : 'فرد'}` : '';
  const roomStr = s.room ? ` (${esc(s.room)})` : '';
  return `
    <button type="button" class="study-week-pill" data-course-id="${esc(s.courseId)}" style="--course-c:${courseColorCss(s.colorToken)}">
      <strong>${esc(s.courseName)}</strong>
      <span>${esc(s.timeLabel)}${roomStr}${esc(pBadge)}</span>
    </button>`;
}

function renderWeekDayCard(d) {
  const itemsHtml = d.daySessions.map(renderWeekSessionPill).join('');
  return `
    <div class="study-week-day${d.isToday ? ' is-today' : ''}">
      <div class="study-week-day-head">
        <span class="study-week-day-name">${esc(d.dayName)}</span>
        ${d.isToday ? '<span class="study-week-today-pill">امروز</span>' : ''}
      </div>
      <div class="study-week-day-items">${itemsHtml}</div>
    </div>`;
}

function renderSchedule(data, todayKeyStr) {
  const sec = $('#studyScheduleSec');
  const host = $('#studyScheduleBody');
  const nextHost = $('#studyNextBannerHost');
  const parityBadge = $('#studyWeekParityBadge');
  const parityFilterEl = $('#studyWeekParityFilter');
  const active = activeCoursesOf(data);
  const labels = getStudyRoleLabels(data.role);
  if (sec) sec.hidden = active.length === 0;
  if (!host || active.length === 0) return;

  const showParity = hasAnyParitySessions(active);
  const currentParity = getJalaliWeekParity(todayKeyStr);
  if (parityBadge) {
    parityBadge.hidden = !showParity;
    if (showParity) parityBadge.textContent = currentParity === 'even' ? 'این هفته: زوج' : 'این هفته: فرد';
  }
  if (parityFilterEl) {
    parityFilterEl.hidden = !(showParity && scheduleMode === 'week');
    parityFilterEl.querySelectorAll('[data-parity]').forEach(btn => {
      const sel = btn.dataset.parity === weekParityFilter;
      btn.classList.toggle('is-active', sel);
      btn.setAttribute('aria-pressed', String(sel));
    });
  }

  const todayBtn = $('#studySchedTodayBtn');
  const weekBtn = $('#studySchedWeekBtn');
  todayBtn?.classList.toggle('is-active', scheduleMode === 'today');
  todayBtn?.setAttribute('aria-pressed', String(scheduleMode === 'today'));
  weekBtn?.classList.toggle('is-active', scheduleMode === 'week');
  weekBtn?.setAttribute('aria-pressed', String(scheduleMode === 'week'));

  if (scheduleMode === 'today') {
    const todayClasses = getTodayClasses(active, todayKeyStr);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    renderNextBanner(active, todayKeyStr, nowMin, labels);
    if (!todayClasses.length) {
      host.innerHTML = `<p class="study-empty-note">${data.role === STUDY_ROLES.SCHOOL ? 'امروز زنگی در برنامهٔ مدرسه ثبت نشده است.' : 'امروز کلاسی در برنامه ثبت نشده است.'}</p>`;
      return;
    }
    const rowsHtml = todayClasses.map(item => renderTodayClassRow(item, nowMin)).join('');
    host.innerHTML = `<ul class="study-class-list">${rowsHtml}</ul>`;
    return;
  }

  if (nextHost) nextHost.innerHTML = '';

  // Weekly Grid (0 = شنبه .. 6 = جمعه) with today highlighted
  const todayDow = iranianWeekdayFromKey(todayKeyStr);
  const days = STUDY_WEEKDAYS.map((dayName, dow) => {
    const daySessions = [];
    for (const c of active) {
      for (const s of c.sessions) {
        if (s.dayOfWeek !== dow) continue;
        const p = s.parity === 'even' || s.parity === 'odd' ? s.parity : 'all';
        if (weekParityFilter !== 'all' && p !== 'all' && p !== weekParityFilter) continue;
        daySessions.push({
          courseId: c.id,
          courseName: c.name,
          colorToken: c.colorToken,
          timeFrom: s.timeFrom,
          timeLabel: `${formatClock(s.timeFrom)} تا ${formatClock(s.timeTo)}`,
          room: s.room,
          parity: p,
        });
      }
    }
    daySessions.sort((a, b) => a.timeFrom - b.timeFrom);
    return { dayName, dow, isToday: dow === todayDow, daySessions };
  });

  const nonEmptyDays = days.filter(d => d.daySessions.length > 0);
  if (!nonEmptyDays.length) {
    host.innerHTML = '<p class="study-empty-note">هنوز ساعت کلاسی برای این نما ثبت نشده است؛ از بخش ویرایش درس اضافه کن.</p>';
    return;
  }

  const weekHtml = nonEmptyDays.map(renderWeekDayCard).join('');
  host.innerHTML = `<div class="study-week-grid">${weekHtml}</div>`;
}

/* ── Courses Grid ── */
function renderCourseCard(c, labels, stats, exam) {
  const metaParts = [];
  if (labels.showCodeCredits && c.code) metaParts.push(esc(c.code));
  if (c.instructor) metaParts.push(esc(c.instructor));
  if (labels.showCodeCredits && c.credits > 0) metaParts.push(`${faNum(c.credits)} واحد`);

  const metaHtml = metaParts.length ? `<p class="scc-meta">${metaParts.join(' · ')}</p>` : '';
  const examBadge = exam
    ? `<span class="scc-badge is-exam">${esc(exam.countdownLabel)} تا ${esc(exam.examKind || 'امتحان')}</span>`
    : '';
  const sessBadge = c.sessions.length
    ? `<span class="scc-badge">${faNum(c.sessions.length)} جلسه/هفته</span>`
    : '';
  const editIcon = LIB_ICONS.edit;

  return `
    <article class="study-course-card" data-course-id="${esc(c.id)}" style="--course-c:${courseColorCss(c.colorToken)}">
      <div class="scc-top">
        <button type="button" class="scc-main-btn" data-act="open">
          <h3 class="scc-title">${esc(c.name)}</h3>
          ${metaHtml}
        </button>
        <button type="button" class="scc-edit-btn" data-act="edit" aria-label="ویرایش درس ${esc(c.name)}" title="ویرایش درس">${editIcon}</button>
      </div>
      <div class="scc-badges">${examBadge}${sessBadge}</div>
      <div class="scc-foot">
        <div class="scc-foot-stats">
          <span>${faNum(stats.openTasksCount)} کار باز</span>
          <span>·</span>
          <span>${faNum(stats.linkedBooksCount)} کتاب/جزوه</span>
        </div>
        <button type="button" class="scc-quick-task-btn" data-act="quick-task">${esc(labels.quickActionLabel)}</button>
      </div>
    </article>
  `;
}

function renderCoursesGrid(data, todayKeyStr) {
  const grid = $('#studyCoursesGrid');
  const emptyEl = $('#studyCoursesEmpty');
  const countEl = $('#studyCoursesCount');
  const headingEl = $('#studyCoursesHeading');
  const emptyTitleEl = $('#studyEmptyTitle');
  const emptySubEl = $('#studyEmptySub');
  if (!grid) return;

  const labels = getStudyRoleLabels(data.role);
  if (headingEl) headingEl.textContent = labels.sectionCoursesTitle;
  if (emptyTitleEl) emptyTitleEl.textContent = labels.emptyTitle;
  if (emptySubEl) emptySubEl.textContent = labels.emptySub;
  document.querySelectorAll('#studyEmptyRoleRow [data-empty-role]').forEach(btn => {
    btn.classList.toggle('is-selected', btn.dataset.emptyRole === data.role);
  });

  const active = activeCoursesOf(data);
  const summary = computeSemesterSummary(active, todayKeyStr);
  if (countEl) {
    if (!summary.courseCount) countEl.textContent = '';
    else if (labels.showCodeCredits && summary.totalCredits > 0) {
      countEl.textContent = `${faNum(summary.courseCount)} درس · ${faNum(summary.totalCredits)} واحد`;
    } else {
      countEl.textContent = `${faNum(summary.courseCount)} درس`;
    }
  }
  if (emptyEl) emptyEl.hidden = active.length > 0;
  if (!active.length) {
    grid.innerHTML = '';
    return;
  }

  const tasks = activeTasksList();
  const books = getBooks();
  const upcomingMap = new Map(getUpcomingExams(active, todayKeyStr).map(ex => [ex.courseId, ex]));

  grid.innerHTML = active
    .map(c => renderCourseCard(c, labels, computeCourseStats(c.id, tasks, books), upcomingMap.get(c.id)))
    .join('');
}

/* ── Course Detail Modal ── */
function renderCourseDetailModal() {
  const overlay = $('#studyCourseDetailOverlay');
  if (!overlay || overlay.hidden || !activeDetailCourseId) return;
  const course = findCourse(activeDetailCourseId);
  if (!course) {
    overlay.hidden = true;
    activeDetailCourseId = null;
    return;
  }

  const data = getStudyData();
  const labels = getStudyRoleLabels(data.role);
  const titleEl = $('#scdTitle');
  const metaEl = $('#scdMeta');
  const cardEl = $('#studyCourseDetailCard');
  if (cardEl) cardEl.style.setProperty('--course-c', courseColorCss(course.colorToken));
  if (titleEl) titleEl.textContent = course.name;
  const quickInput = $('#scdQuickTaskInput');
  if (quickInput) quickInput.setAttribute('placeholder', labels.taskQuickPlaceholder);

  if (metaEl) {
    const parts = [];
    if (labels.showCodeCredits && course.code) parts.push(`کد: ${course.code}`);
    if (course.instructor) parts.push(`${labels.instructorPrefix}: ${course.instructor}`);
    if (labels.showCodeCredits && course.credits > 0) parts.push(`${faNum(course.credits)} واحد`);
    if (course.examDate) {
      const [y, m, d] = course.examDate.split('-').map(Number);
      const j = formatJalaliDate(new Date(y, m - 1, d));
      const kindStr = course.examKind ? `${course.examKind}: ` : 'امتحان: ';
      parts.push(`${kindStr}${j}${course.examTime ? ` ساعت ${course.examTime}` : ''}`);
    }
    if (course.examScope) parts.push(`مباحث: ${course.examScope}`);
    metaEl.textContent = parts.join(' · ') || 'بدون جزئیات تکمیلی';
  }

  const sessEl = $('#scdSessions');
  if (sessEl) {
    if (!course.sessions.length) {
      sessEl.innerHTML = '<span class="scd-muted">برنامهٔ کلاسی ثبت نشده است.</span>';
    } else {
      sessEl.innerHTML = course.sessions.map(s => {
        const pStr = s.parity === 'even' || s.parity === 'odd' ? ` · ${PARITY_LABELS[s.parity]}` : '';
        return `<span class="scd-session-pill">${esc(STUDY_WEEKDAYS[s.dayOfWeek])} · ${esc(formatClock(s.timeFrom))}–${esc(formatClock(s.timeTo))}${s.room ? ` · ${esc(s.room)}` : ''}${esc(pStr)}</span>`;
      }).join('');
    }
  }

  const tasksEl = $('#scdTasksList');
  const tasks = activeTasksList().filter(t => t.courseId === course.id);
  const focusBtn = $('#scdFocusBtn');
  if (focusBtn) {
    const hasOpen = tasks.some(t => !t.done);
    focusBtn.hidden = !hasOpen;
  }
  if (tasksEl) {
    if (!tasks.length) {
      tasksEl.innerHTML = '<li class="scd-empty-li">هنوز کاری به این درس وصل نشده است.</li>';
    } else {
      tasksEl.innerHTML = tasks.map(t => `
        <li class="scd-task-row${t.done ? ' is-done' : ''}" data-task-id="${esc(t.id)}">
          <button type="button" class="scd-task-check" aria-label="تغییر وضعیت تکمیل">
            <span class="scd-check-box" aria-hidden="true">${t.done ? '✓' : ''}</span>
            <span class="scd-task-text">${esc(t.text)}</span>
          </button>
        </li>
      `).join('');
    }
  }

  const booksEl = $('#scdBooksList');
  const linkSelect = $('#scdBookLinkSelect');
  const linkRow = $('#scdBookLinkRow');
  const allBooks = getBooks().filter(b => b && !b.deletedAt);
  const linkedBooks = allBooks.filter(b => b.courseId === course.id);
  const unlinkedBooks = allBooks.filter(b => b.courseId !== course.id);

  if (booksEl) {
    if (!linkedBooks.length) {
      booksEl.innerHTML = '<li class="scd-empty-li">هنوز کتاب یا جزوه‌ای به این درس متصل نشده است.</li>';
    } else {
      booksEl.innerHTML = linkedBooks.map(b => `
        <li class="scd-book-row" data-book-id="${esc(b.id)}">
          <span class="scd-book-title">${esc(b.title || 'کتاب PDF')}</span>
          <div class="scd-book-acts">
            <button type="button" class="scd-book-open" data-act="open-book">مطالعه</button>
            <button type="button" class="scd-book-unlink" data-act="unlink-book" aria-label="جدا کردن کتاب">جدا کردن</button>
          </div>
        </li>
      `).join('');
    }
  }

  if (linkRow && linkSelect) {
    linkRow.hidden = unlinkedBooks.length === 0;
    linkSelect.innerHTML = `<option value="">اتصال جزوه یا PDF از کتابخانه…</option>` +
      unlinkedBooks.map(b => `<option value="${esc(b.id)}">${esc(b.title || 'کتاب PDF')}</option>`).join('');
  }
}

function openCourseDetailModal(courseId, { focusQuickTask = false } = {}) {
  const course = findCourse(courseId);
  const overlay = $('#studyCourseDetailOverlay');
  if (!course || !overlay) return;
  activeDetailCourseId = course.id;
  const quickIn = $('#scdQuickTaskInput');
  if (quickIn) quickIn.value = '';
  renderCourseDetailModal();
  overlay.hidden = false;
  if (focusQuickTask && quickIn) {
    requestAnimationFrame(() => quickIn.focus());
  }
}

/* ── Add / Edit Course Form Modal ── */
function renderFormColorTokens() {
  const host = $('#scfColors');
  if (!host) return;
  host.innerHTML = COURSE_COLOR_TOKENS.map(tok => `
    <button type="button" class="scf-color-btn${draftColorToken === tok ? ' sel' : ''}" data-token="${esc(tok)}" aria-checked="${draftColorToken === tok}" role="radio" title="${esc(COURSE_COLOR_LABELS[tok] || tok)}" style="--course-c:${courseColorCss(tok)}">
      <i aria-hidden="true"></i>
    </button>
  `).join('');
}

function renderFormSessions() {
  const host = $('#scfSessionsList');
  if (!host) return;
  if (!draftSessions.length) {
    host.innerHTML = '<p class="scf-no-sess">هنوز ساعت کلاسی اضافه نشده است.</p>';
    return;
  }
  host.innerHTML = draftSessions.map((s, idx) => {
    const pStr = s.parity === 'even' || s.parity === 'odd' ? ` · ${PARITY_LABELS[s.parity]}` : '';
    return `
      <div class="scf-sess-chip" data-idx="${idx}">
        <span>${esc(STUDY_WEEKDAYS[s.dayOfWeek])} · ${esc(formatClock(s.timeFrom))} تا ${esc(formatClock(s.timeTo))}${s.room ? ` · ${esc(s.room)}` : ''}${esc(pStr)}</span>
        <button type="button" class="scf-sess-del" aria-label="حذف جلسه">×</button>
      </div>`;
  }).join('');
}

function updateFormExamLabel() {
  const btn = $('#scfExamDateBtn');
  const clearBtn = $('#scfExamDateClear');
  if (btn) {
    if (draftExamDate) {
      const [y, m, d] = draftExamDate.split('-').map(Number);
      btn.textContent = formatJalaliDate(new Date(y, m - 1, d));
    } else {
      btn.textContent = 'انتخاب تاریخ امتحان…';
    }
  }
  if (clearBtn) clearBtn.hidden = !draftExamDate;
}

function refreshSessionConflictWarning() {
  const warnEl = $('#scfSessWarning');
  if (!warnEl) return;
  const dow = Number($('#scfSessDay')?.value ?? 0);
  const fVal = Number($('#scfSessFrom')?.value);
  const tVal = Number($('#scfSessTo')?.value);
  const parity = $('#scfSessParity')?.value || 'all';
  if (!parseTimeRange(fVal, tVal)) {
    warnEl.hidden = true;
    return;
  }
  const active = activeCoursesOf();
  const hits = detectScheduleConflicts(
    active,
    { dayOfWeek: dow, timeFrom: fVal, timeTo: tVal, parity },
    { excludeCourseId: editingCourseId, draftSessions },
  );
  if (!hits.length) {
    warnEl.hidden = true;
    warnEl.textContent = '';
    return;
  }
  const names = [...new Set(hits.map(h => `«${h.courseName}»`))].slice(0, 2).join(' و ');
  warnEl.hidden = false;
  warnEl.textContent = `توجه: این بازه با ${names} هم‌پوشانی زمانی دارد.`;
}

function renderFormRoleAdaptation(role) {
  const labels = getStudyRoleLabels(role);
  const codeRow = $('#scfCodeCreditsRow');
  if (codeRow) codeRow.hidden = !labels.showCodeCredits;
  const instLabel = $('#scfInstructorLabel');
  if (instLabel) instLabel.textContent = labels.instructorLabel;
  if ($('#scfInstructor')) $('#scfInstructor').setAttribute('placeholder', labels.instructorPlaceholder);
  if ($('#scfRoomInput')) $('#scfRoomInput').setAttribute('placeholder', labels.roomPlaceholder);
  if ($('#scfExamKind')) $('#scfExamKind').setAttribute('placeholder', labels.examKindPlaceholder);
  if ($('#scfExamScope')) $('#scfExamScope').setAttribute('placeholder', labels.examScopePlaceholder);

  const kindPresetsHost = $('#scfExamKindPresets');
  if (kindPresetsHost) {
    const kinds = EXAM_KIND_PRESETS[role] || EXAM_KIND_PRESETS.university;
    kindPresetsHost.innerHTML = kinds.map(k =>
      `<button type="button" class="scf-preset-chip" data-kind="${esc(k)}">${esc(k)}</button>`
    ).join('');
  }

  const bellHost = $('#scfBellPresets');
  if (bellHost) {
    bellHost.hidden = role !== STUDY_ROLES.SCHOOL;
    if (role === STUDY_ROLES.SCHOOL) {
      bellHost.innerHTML = `<span class="scf-bell-title">زنگ‌های آماده:</span>` + SCHOOL_BELL_PRESETS.map(b =>
        `<button type="button" class="scf-preset-chip" data-bell-from="${b.timeFrom}" data-bell-to="${b.timeTo}">${esc(b.label)} (${esc(formatClock(b.timeFrom))})</button>`
      ).join('');
    } else {
      bellHost.innerHTML = '';
    }
  }
}

function openCourseFormModal(courseId = null, { fromDetail = false } = {}) {
  const overlay = $('#studyCourseFormOverlay');
  if (!overlay) return;

  const data = getStudyData();
  const existing = courseId ? findCourse(courseId) : null;
  editingCourseId = existing ? existing.id : null;
  returnToDetailId = (fromDetail && existing) ? existing.id : null;
  draftExamDate = existing ? existing.examDate : null;
  draftColorToken = existing ? existing.colorToken : 'accent';
  draftSessions = existing ? existing.sessions.map(s => ({ ...s })) : [];

  const heading = $('#scfHeading');
  if (heading) heading.textContent = existing ? 'ویرایش درس' : 'افزودن درس جدید';
  const delBtn = $('#scfDeleteBtn');
  if (delBtn) delBtn.hidden = !existing;

  if ($('#scfName')) $('#scfName').value = existing?.name || '';
  if ($('#scfCode')) $('#scfCode').value = existing?.code || '';
  if ($('#scfInstructor')) $('#scfInstructor').value = existing?.instructor || '';
  if ($('#scfCredits')) $('#scfCredits').value = existing?.credits ? String(existing.credits) : '';
  if ($('#scfExamTime')) $('#scfExamTime').value = existing?.examTime || '';
  if ($('#scfExamKind')) $('#scfExamKind').value = existing?.examKind || '';
  if ($('#scfExamScope')) $('#scfExamScope').value = existing?.examScope || '';
  if ($('#scfRoomInput')) $('#scfRoomInput').value = '';
  if ($('#scfSessParity')) $('#scfSessParity').value = 'all';
  if ($('#scfError')) $('#scfError').hidden = true;
  if ($('#scfExamTimeError')) $('#scfExamTimeError').hidden = true;
  if ($('#scfSessError')) $('#scfSessError').hidden = true;

  renderFormRoleAdaptation(data.role);
  renderFormColorTokens();
  updateFormExamLabel();
  renderFormSessions();
  refreshSessionConflictWarning();
  overlay.hidden = false;
}

function closeCourseFormModal({ restoreDetail = true } = {}) {
  const overlay = $('#studyCourseFormOverlay');
  if (!overlay || overlay.hidden) return;
  const backId = restoreDetail ? returnToDetailId : null;
  overlay.hidden = true;
  editingCourseId = null;
  returnToDetailId = null;
  if (backId && findCourse(backId)) {
    openCourseDetailModal(backId);
  }
}

export function renderStudyPage() {
  if (typeof document === 'undefined') return;
  const page = $('#page-study');
  if (!page) return;

  const data = getStudyData();
  const todayKeyStr = dayKey(new Date());
  const courses = activeCoursesOf(data);

  renderHeader(data);
  renderExamsStrip(courses, todayKeyStr);
  renderSchedule(data, todayKeyStr);
  renderCoursesGrid(data, todayKeyStr);
  renderCourseDetailModal();
}

export function initStudyPage() {
  if (typeof document === 'undefined') return;
  const page = $('#page-study');
  if (!page || initializedRoots.has(page)) {
    renderStudyPage();
    return;
  }
  initializedRoots.add(page);

  // Student Role Switcher (University <-> School)
  $('#studyRoleSwitch')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-role]');
    if (btn?.dataset.role) switchStudentRole(btn.dataset.role);
  });
  $('#studyEmptyRoleRow')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-empty-role]');
    if (btn?.dataset.emptyRole) switchStudentRole(btn.dataset.emptyRole);
  });

  // Period / Semester inline editor
  const semBtn = $('#studySemesterEditBtn');
  const semForm = $('#studySemesterForm');
  const semInput = $('#studySemesterInput');
  semBtn?.addEventListener('click', () => {
    const data = getStudyData();
    if (semInput) semInput.value = data.activeSemester || '';
    if (semForm) semForm.hidden = false;
    semBtn.hidden = true;
    semInput?.focus();
    semInput?.select();
  });
  const finishSemesterEdit = save => {
    if (save && semInput) {
      const val = semInput.value.trim();
      if (val) {
        const cur = getStudyData();
        persistStudy({ ...cur, activeSemester: val });
      }
    }
    if (semForm) semForm.hidden = true;
    if (semBtn) semBtn.hidden = false;
    renderStudyPage();
  };
  semForm?.addEventListener('submit', e => { e.preventDefault(); finishSemesterEdit(true); });
  $('#studySemesterCancelBtn')?.addEventListener('click', () => finishSemesterEdit(false));

  // Add Course buttons (header + empty-state CTA)
  $('#studyAddCourseBtn')?.addEventListener('click', () => openCourseFormModal(null));
  $('#studyEmptyAddBtn')?.addEventListener('click', () => openCourseFormModal(null));

  // Schedule mode & weekly parity toggles
  $('#studySchedTodayBtn')?.addEventListener('click', () => {
    scheduleMode = 'today';
    renderStudyPage();
  });
  $('#studySchedWeekBtn')?.addEventListener('click', () => {
    scheduleMode = 'week';
    renderStudyPage();
  });
  $('#studyWeekParityFilter')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-parity]');
    if (!btn) return;
    weekParityFilter = btn.dataset.parity || 'all';
    renderStudyPage();
  });

  // Exam card / Banner / Weekly pill / Class row / Course card -> Course Detail or Quick Task
  $('#studyExamsList')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-course-id]');
    if (btn?.dataset.courseId) openCourseDetailModal(btn.dataset.courseId);
  });
  $('#studyNextBannerHost')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-course-id]');
    if (btn?.dataset.courseId) openCourseDetailModal(btn.dataset.courseId);
  });
  $('#studyScheduleBody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-course-id]');
    if (btn?.dataset.courseId) openCourseDetailModal(btn.dataset.courseId);
  });
  $('#studyCoursesGrid')?.addEventListener('click', e => {
    const card = e.target.closest('.study-course-card');
    if (!card) return;
    const cid = card.dataset.courseId;
    if (!cid) return;
    if (e.target.closest('[data-act="edit"]')) {
      openCourseFormModal(cid, { fromDetail: false });
    } else if (e.target.closest('[data-act="quick-task"]')) {
      openCourseDetailModal(cid, { focusQuickTask: true });
    } else {
      openCourseDetailModal(cid);
    }
  });

  // Course Detail Modal events
  const detailOverlay = $('#studyCourseDetailOverlay');
  detailOverlay?.addEventListener('click', e => {
    if (e.target === detailOverlay) detailOverlay.hidden = true;
  });
  $('#scdCloseBtn')?.addEventListener('click', () => { if (detailOverlay) detailOverlay.hidden = true; });
  $('#scdEditCourseBtn')?.addEventListener('click', () => {
    const cid = activeDetailCourseId;
    if (detailOverlay) detailOverlay.hidden = true;
    if (cid) openCourseFormModal(cid, { fromDetail: true });
  });
  $('#scdFocusBtn')?.addEventListener('click', () => {
    if (!activeDetailCourseId) return;
    const firstOpen = activeTasksList().find(t => !t.done && t.courseId === activeDetailCourseId);
    if (firstOpen) {
      if (detailOverlay) detailOverlay.hidden = true;
      openFocus(firstOpen.id);
    }
  });
  $('#scdTasksList')?.addEventListener('click', e => {
    const row = e.target.closest('.scd-task-row');
    if (!row?.dataset.taskId) return;
    if (e.target.closest('.scd-task-check')) {
      toggleTaskDone(row.dataset.taskId);
      renderCourseDetailModal();
      renderStudyPage();
    }
  });
  $('#scdQuickTaskForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#scdQuickTaskInput');
    const text = input?.value.trim() || '';
    if (!text || !activeDetailCourseId) return;
    const res = createTask({ text, courseId: activeDetailCourseId, cat: 'study', p: 'mid' });
    if (res.ok && input) {
      input.value = '';
      renderCourseDetailModal();
      renderStudyPage();
    }
  });
  $('#scdBooksList')?.addEventListener('click', e => {
    const row = e.target.closest('.scd-book-row');
    const bookId = row?.dataset.bookId;
    if (!bookId) return;
    if (e.target.closest('[data-act="open-book"]')) {
      if (detailOverlay) detailOverlay.hidden = true;
      window.dispatchEvent(new CustomEvent('navigate', { detail: 'library' }));
      window.dispatchEvent(new CustomEvent('open-book', { detail: bookId }));
    } else if (e.target.closest('[data-act="unlink-book"]')) {
      updateBook(bookId, { courseId: null });
      renderCourseDetailModal();
      renderStudyPage();
    }
  });
  $('#scdBookLinkSelect')?.addEventListener('change', e => {
    const bookId = e.target.value;
    if (!bookId || !activeDetailCourseId) return;
    updateBook(bookId, { courseId: activeDetailCourseId });
    e.target.value = '';
    renderCourseDetailModal();
    renderStudyPage();
  });

  // Course Form Modal setup (15-min granularity supports both university slots & school bells)
  const daySel = $('#scfSessDay');
  const fromSel = $('#scfSessFrom');
  const toSel = $('#scfSessTo');
  const paritySel = $('#scfSessParity');
  if (daySel) {
    daySel.innerHTML = STUDY_WEEKDAYS.map((d, i) => `<option value="${i}">${esc(d)}</option>`).join('');
  }
  if (fromSel && toSel) {
    const timeOpts = [];
    for (let m = 7 * 60; m <= 21 * 60; m += 15) {
      timeOpts.push(`<option value="${m}">${formatClock(m)}</option>`);
    }
    fromSel.innerHTML = timeOpts.join('');
    toSel.innerHTML = timeOpts.join('');
    fromSel.value = String(8 * 60);
    toSel.value = String(10 * 60);
  }

  $('#scfName')?.addEventListener('input', () => {
    const errEl = $('#scfError');
    if (errEl) errEl.hidden = true;
  });
  $('#scfExamTime')?.addEventListener('input', () => {
    const errEl = $('#scfExamTimeError');
    if (errEl) errEl.hidden = true;
  });
  $('#scfExamTimePresets')?.addEventListener('click', e => {
    const btn = e.target.closest('.scf-preset-chip[data-time]');
    if (!btn) return;
    const inp = $('#scfExamTime');
    if (inp) inp.value = btn.dataset.time;
    const errEl = $('#scfExamTimeError');
    if (errEl) errEl.hidden = true;
  });
  $('#scfExamKindPresets')?.addEventListener('click', e => {
    const btn = e.target.closest('.scf-preset-chip[data-kind]');
    if (!btn) return;
    const inp = $('#scfExamKind');
    if (inp) inp.value = btn.dataset.kind;
  });
  $('#scfBellPresets')?.addEventListener('click', e => {
    const btn = e.target.closest('.scf-preset-chip[data-bell-from]');
    if (!btn || !fromSel || !toSel) return;
    fromSel.value = btn.dataset.bellFrom;
    toSel.value = btn.dataset.bellTo;
    const errEl = $('#scfSessError');
    if (errEl) errEl.hidden = true;
    refreshSessionConflictWarning();
  });

  const onSessPickerChange = () => {
    const errEl = $('#scfSessError');
    if (errEl) errEl.hidden = true;
    refreshSessionConflictWarning();
  };
  daySel?.addEventListener('change', onSessPickerChange);
  fromSel?.addEventListener('change', onSessPickerChange);
  toSel?.addEventListener('change', onSessPickerChange);
  paritySel?.addEventListener('change', onSessPickerChange);

  $('#scfColors')?.addEventListener('click', e => {
    const btn = e.target.closest('.scf-color-btn[data-token]');
    if (!btn) return;
    draftColorToken = btn.dataset.token;
    renderFormColorTokens();
  });

  $('#scfExamDateBtn')?.addEventListener('click', () => {
    openDuePicker({
      current: draftExamDate,
      onPick: key => {
        draftExamDate = key || null;
        updateFormExamLabel();
      },
    });
  });
  $('#scfExamDateClear')?.addEventListener('click', () => {
    draftExamDate = null;
    updateFormExamLabel();
  });

  $('#scfAddSessionBtn')?.addEventListener('click', () => {
    const dow = Number($('#scfSessDay')?.value ?? 0);
    const fVal = Number($('#scfSessFrom')?.value);
    const tVal = Number($('#scfSessTo')?.value);
    const room = ($('#scfRoomInput')?.value || '').trim();
    const parity = ($('#scfSessParity')?.value || 'all');
    const errEl = $('#scfSessError');
    if (!parseTimeRange(fVal, tVal)) {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'ساعت پایان باید بعد از شروع باشد.'; }
      return;
    }
    const duplicate = draftSessions.some(s =>
      s.dayOfWeek === dow && s.timeFrom === fVal && s.timeTo === tVal && (s.parity || 'all') === parity
    );
    if (duplicate) {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'این بازهٔ کلاسی قبلاً اضافه شده است.'; }
      return;
    }
    if (errEl) errEl.hidden = true;
    const nextSess = { dayOfWeek: dow, timeFrom: fVal, timeTo: tVal, room };
    if (parity === 'even' || parity === 'odd') nextSess.parity = parity;
    draftSessions.push(nextSess);
    if ($('#scfRoomInput')) $('#scfRoomInput').value = '';
    renderFormSessions();
    refreshSessionConflictWarning();
  });

  $('#scfSessionsList')?.addEventListener('click', e => {
    if (!e.target.closest('.scf-sess-del')) return;
    const chip = e.target.closest('.scf-sess-chip');
    const idx = Number(chip?.dataset.idx);
    if (Number.isInteger(idx) && idx >= 0) {
      draftSessions.splice(idx, 1);
      renderFormSessions();
      refreshSessionConflictWarning();
    }
  });

  const formOverlay = $('#studyCourseFormOverlay');
  formOverlay?.addEventListener('click', e => {
    if (e.target === formOverlay) closeCourseFormModal({ restoreDetail: true });
  });
  $('#scfCloseBtn')?.addEventListener('click', () => closeCourseFormModal({ restoreDetail: true }));
  $('#scfCancelBtn')?.addEventListener('click', () => closeCourseFormModal({ restoreDetail: true }));

  $('#scfDeleteBtn')?.addEventListener('click', async () => {
    if (!editingCourseId) return;
    const targetId = editingCourseId;
    const course = findCourse(targetId);
    const ok = await confirmDialog({
      title: 'حذف درس؟',
      body: `«${course?.name || 'این درس'}» حذف می‌شود؛ کارها و کتاب‌های قبلی حذف نمی‌شوند.`,
      confirmLabel: 'حذف کن',
      cancelLabel: 'انصراف',
      danger: true,
    });
    if (!ok) return;

    const data = getStudyData();
    const now = Date.now();
    const courses = data.courses.map(c => c.id === targetId
      ? { ...c, deletedAt: now, updatedAt: now, version: (c.version || 1) + 1 }
      : c);
    persistStudy({ ...data, courses });

    for (const b of getBooks()) {
      if (b && b.courseId === targetId) updateBook(b.id, { courseId: null });
    }
    closeCourseFormModal({ restoreDetail: false });
    renderStudyPage();
    renderShelf(true);
  });

  $('#studyCourseForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const name = ($('#scfName')?.value || '').trim();
    const errEl = $('#scfError');
    if (!name) {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'نام درس نمی‌تونه خالی باشه.'; }
      $('#scfName')?.focus();
      return;
    }
    if (errEl) errEl.hidden = true;

    const rawExamTime = ($('#scfExamTime')?.value || '').trim();
    const normalizedTime = rawExamTime ? normalizeExamTime(rawExamTime) : null;
    const timeErrEl = $('#scfExamTimeError');
    if (rawExamTime && !normalizedTime) {
      if (timeErrEl) {
        timeErrEl.hidden = false;
        timeErrEl.textContent = 'فرمت ساعت امتحان نامعتبر است؛ مثلاً ۰۹:۰۰ وارد کنید.';
      }
      $('#scfExamTime')?.focus();
      return;
    }
    if (timeErrEl) timeErrEl.hidden = true;

    const data = getStudyData();
    const existing = editingCourseId ? findCourse(editingCourseId) : null;
    const now = Date.now();

    const candidate = normalizeCourse({
      id: existing ? existing.id : undefined,
      name,
      code: $('#scfCode')?.value || '',
      instructor: $('#scfInstructor')?.value || '',
      colorToken: draftColorToken,
      credits: $('#scfCredits')?.value || 0,
      examDate: draftExamDate,
      examTime: normalizedTime,
      examKind: $('#scfExamKind')?.value || '',
      examScope: $('#scfExamScope')?.value || '',
      sessions: draftSessions,
      updatedAt: now,
      version: existing ? (existing.version || 1) + 1 : 1,
      deletedAt: null,
    });

    if (!candidate) return;

    const courses = existing
      ? data.courses.map(c => c.id === existing.id ? candidate : c)
      : [candidate, ...data.courses];

    persistStudy({ ...data, courses });
    const savedId = candidate.id;
    const hadDetail = Boolean(returnToDetailId);
    closeCourseFormModal({ restoreDetail: false });
    renderStudyPage();
    if (hadDetail) openCourseDetailModal(savedId);
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('#dueOverlay') && !$('#dueOverlay').hidden) return;
    if (formOverlay && !formOverlay.hidden) {
      e.stopPropagation();
      closeCourseFormModal({ restoreDetail: true });
    } else if (detailOverlay && !detailOverlay.hidden) {
      e.stopPropagation();
      detailOverlay.hidden = true;
    }
  });

  renderStudyPage();
  subscribe(() => {
    if ($('#page-study')?.classList.contains('active') || (detailOverlay && !detailOverlay.hidden)) {
      renderStudyPage();
    }
  });
}
