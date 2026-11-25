/* ═══ Academic / Student Workflow Pure Logic ═══
   Zero DOM dependencies — 100% deterministic & Node-testable.
   Includes:
     · Schema normalization (activeSemester, courses, weekly sessions, exams)
     · Exam countdown calculation & sorting (getUpcomingExams)
     · Iranian week (Saturday=0 .. Friday=6) schedule resolution (getTodayClasses)
     · Course progress & linking stats (computeCourseStats)
     · Backup conflict-resolution merging (mergeStudyData)
*/

import { formatJalaliDate, gregorianToJalali, jalaliToGregorian } from './jalali.js';
import { faNum, parseTimeRange, formatClock, nextId } from './utils.js';

export const MAX_SEMESTER_LEN = 48;
export const MAX_COURSE_NAME = 80;
export const MAX_COURSE_CODE = 24;
export const MAX_INSTRUCTOR = 60;
export const MAX_ROOM = 40;
export const MAX_CREDITS = 12;
export const MAX_EXAM_KIND = 24;
export const MAX_EXAM_SCOPE = 120;

export const STUDY_ROLES = Object.freeze({
  UNIVERSITY: 'university',
  SCHOOL: 'school',
});

export const SESSION_PARITIES = Object.freeze(['all', 'even', 'odd']);

export const PARITY_LABELS = Object.freeze({
  all: 'هر هفته',
  even: 'هفتهٔ زوج',
  odd: 'هفتهٔ فرد',
});

export const SCHOOL_BELL_PRESETS = Object.freeze([
  { id: 'bell-1', label: 'زنگ ۱', timeFrom: 8 * 60, timeTo: 9 * 60 + 15 },
  { id: 'bell-2', label: 'زنگ ۲', timeFrom: 9 * 60 + 30, timeTo: 10 * 60 + 45 },
  { id: 'bell-3', label: 'زنگ ۳', timeFrom: 11 * 60, timeTo: 12 * 60 + 15 },
  { id: 'bell-4', label: 'زنگ ۴', timeFrom: 12 * 60 + 30, timeTo: 13 * 60 + 45 },
]);

export const EXAM_KIND_PRESETS = Object.freeze({
  university: ['میان‌ترم', 'پایان‌ترم', 'کوئیز', 'ارائه'],
  school: ['پرسش کلاسی', 'مستمر', 'نوبت اول', 'نوبت دوم'],
});

const ROLE_LABELS = Object.freeze({
  university: Object.freeze({
    role: 'university',
    badgeLabel: 'دانشجو',
    periodDefault: 'ترم جاری',
    periodPlaceholder: 'مثلاً پاییز ۱۴۰۵',
    periodTitle: 'ویرایش عنوان ترم',
    instructorLabel: 'نام استاد (اختیاری)',
    instructorPlaceholder: 'دکتر …',
    instructorPrefix: 'استاد',
    roomPlaceholder: 'نام کلاس یا دانشکده (اختیاری)',
    showCodeCredits: true,
    sectionCoursesTitle: 'درس‌های ترم',
    emptyTitle: 'برنامهٔ ترمت رو اینجا مرتب کن',
    emptySub: 'برنامهٔ کلاسی هفتگی، شمارشگر امتحان‌ها و اتصال کارها و جزوه‌های PDF به هر درس.',
    taskQuickPlaceholder: '+ افزودن کار جدید برای این درس…',
    quickActionLabel: '+ کار',
    examKindPlaceholder: 'مثلاً میان‌ترم',
    examScopePlaceholder: 'مباحث امتحان (مثلاً فصل ۱ تا ۴)',
    scheduleDoneLabel: 'کلاس‌های امروز به پایان رسید.',
  }),
  school: Object.freeze({
    role: 'school',
    badgeLabel: 'دانش‌آموز',
    periodDefault: 'سال تحصیلی',
    periodPlaceholder: 'مثلاً پایه دهم · ۱۴۰۵',
    periodTitle: 'ویرایش پایه یا سال تحصیلی',
    instructorLabel: 'نام دبیر / معلم (اختیاری)',
    instructorPlaceholder: 'خانم / آقای …',
    instructorPrefix: 'دبیر',
    roomPlaceholder: 'شماره کلاس یا آزمایشگاه (اختیاری)',
    showCodeCredits: false,
    sectionCoursesTitle: 'درس‌های من',
    emptyTitle: 'برنامهٔ مدرسه و درس‌هات رو اینجا بچین',
    emptySub: 'زنگ‌های هفتگی، شمارشگر امتحان‌ها و تکالیف هر درس در یک جای آرام.',
    taskQuickPlaceholder: '+ افزودن تکلیف جدید برای این درس…',
    quickActionLabel: '+ تکلیف',
    examKindPlaceholder: 'مثلاً پرسش کلاسی',
    examScopePlaceholder: 'مباحث امتحان (مثلاً درس ۱ تا ۳)',
    scheduleDoneLabel: 'زنگ‌های امروز به پایان رسید.',
  }),
});

/**
 * Returns role-specific labels & UI flags for 'university' or 'school'.
 * @param {string} [role]
 */
export function getStudyRoleLabels(role) {
  return role === STUDY_ROLES.SCHOOL ? ROLE_LABELS.school : ROLE_LABELS.university;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXAM_TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 864e5;

export const STUDY_WEEKDAYS = Object.freeze([
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنج‌شنبه',
  'جمعه',
]);

/* Semantic token keys matching --color-* tokens in css/base.css (zero raw hex) */
export const COURSE_COLOR_TOKENS = Object.freeze([
  'accent',
  'success',
  'warning',
  'danger',
  'accent-strong',
  'text-secondary',
]);

export const COURSE_COLOR_LABELS = Object.freeze({
  accent: 'آبی / اصلی',
  success: 'سبز',
  warning: 'نارنجی',
  danger: 'قرمز',
  'accent-strong': 'تیره',
  'text-secondary': 'خنثی',
});

export function courseColorCss(token) {
  const safe = COURSE_COLOR_TOKENS.includes(token) ? token : 'accent';
  return `var(--color-${safe})`;
}

/**
 * Parses a valid YYYY-MM-DD key into local Date midnight.
 * @param {string} key
 * @returns {Date|null}
 */
function parseDayKey(key) {
  if (typeof key !== 'string' || !DAY_KEY_RE.test(key)) return null;
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const check = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  return check === key ? dt : null;
}

/**
 * Normalizes a 24h exam time string ("9:5" or "14:30") -> "HH:MM" or null.
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
export function normalizeExamTime(raw) {
  if (typeof raw !== 'string') return null;
  const ascii = raw
    .replace(/[۰-۹]/g, ch => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, ch => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .trim();
  const m = EXAM_TIME_RE.exec(ascii);
  if (!m) return null;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

/**
 * Computes live class status ('live' | 'done' | 'upcoming') relative to nowMinutes (0..1439).
 * @param {{ timeFrom: number, timeTo: number }} session
 * @param {number} nowMinutes
 * @returns {'live'|'done'|'upcoming'}
 */
export function getClassStatus(session, nowMinutes) {
  if (!session || !Number.isFinite(nowMinutes)) return 'upcoming';
  if (nowMinutes >= session.timeFrom && nowMinutes < session.timeTo) return 'live';
  if (nowMinutes >= session.timeTo) return 'done';
  return 'upcoming';
}

/**
 * Summarizes active courses count, total credits, and upcoming exams count.
 * @param {Array<Object>} courses
 * @param {string} [todayKey]
 * @returns {{ courseCount: number, totalCredits: number, upcomingExamsCount: number }}
 */
export function computeSemesterSummary(courses, todayKey = '') {
  const active = (Array.isArray(courses) ? courses : []).map(normalizeCourse).filter(c => c && !c.deletedAt);
  const totalCredits = active.reduce((sum, c) => sum + (Number(c.credits) || 0), 0);
  const upcomingExamsCount = todayKey ? getUpcomingExams(active, todayKey).length : 0;
  return {
    courseCount: active.length,
    totalCredits,
    upcomingExamsCount,
  };
}

/**
 * Validates and normalizes one weekly class session.
 * dayOfWeek: 0=Saturday .. 6=Friday.
 * @param {Object} session
 * @returns {{ dayOfWeek: number, timeFrom: number, timeTo: number, room: string, parity?: 'even'|'odd' }|null}
 */
export function validateSession(session) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) return null;
  const dow = Number(session.dayOfWeek);
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return null;
  const span = parseTimeRange(session.timeFrom, session.timeTo);
  if (!span) return null;
  const rawRoom = typeof session.room === 'string' ? session.room.trim() : '';
  const room = rawRoom.length > MAX_ROOM ? rawRoom.slice(0, MAX_ROOM) : rawRoom;
  const out = {
    dayOfWeek: dow,
    timeFrom: span.from,
    timeTo: span.to,
    room,
  };
  if (session.parity === 'even' || session.parity === 'odd') {
    out.parity = session.parity;
  }
  return out;
}

/**
 * Normalizes a course record with safe clamping and envelope defaults.
 * @param {Object} course
 * @returns {Object|null}
 */
export function normalizeCourse(course) {
  if (!course || typeof course !== 'object' || Array.isArray(course)) return null;

  const delRaw = Number(course.deletedAt);
  const deletedAt = Number.isFinite(delRaw) && delRaw > 0 ? Math.floor(delRaw) : null;

  const rawName = typeof course.name === 'string' ? course.name.trim() : '';
  const name = rawName.length > MAX_COURSE_NAME ? rawName.slice(0, MAX_COURSE_NAME) : rawName;
  if (!name && !deletedAt) return null;

  const id = typeof course.id === 'string' && course.id.trim()
    ? course.id.trim()
    : `crs-${nextId()}`;

  const rawCode = typeof course.code === 'string' ? course.code.trim() : '';
  const code = rawCode.length > MAX_COURSE_CODE ? rawCode.slice(0, MAX_COURSE_CODE) : rawCode;

  const rawInst = typeof course.instructor === 'string' ? course.instructor.trim() : '';
  const instructor = rawInst.length > MAX_INSTRUCTOR ? rawInst.slice(0, MAX_INSTRUCTOR) : rawInst;

  const colorToken = COURSE_COLOR_TOKENS.includes(course.colorToken) ? course.colorToken : 'accent';

  const rawCredits = Number(course.credits);
  const credits = Number.isFinite(rawCredits)
    ? Math.max(0, Math.min(MAX_CREDITS, Math.round(rawCredits)))
    : 0;

  const examDate = parseDayKey(course.examDate) ? course.examDate : null;
  const examTime = examDate ? normalizeExamTime(course.examTime) : null;

  const rawKind = typeof course.examKind === 'string' ? course.examKind.trim() : '';
  const examKind = rawKind.length > MAX_EXAM_KIND ? rawKind.slice(0, MAX_EXAM_KIND) : rawKind;

  const rawScope = typeof course.examScope === 'string' ? course.examScope.trim() : '';
  const examScope = rawScope.length > MAX_EXAM_SCOPE ? rawScope.slice(0, MAX_EXAM_SCOPE) : rawScope;

  const sessions = Array.isArray(course.sessions)
    ? course.sessions.map(validateSession).filter(Boolean)
    : [];
  sessions.sort((a, b) => (a.dayOfWeek - b.dayOfWeek) || (a.timeFrom - b.timeFrom));

  const upRaw = Number(course.updatedAt);
  const updatedAt = Number.isFinite(upRaw) && upRaw > 0 ? Math.floor(upRaw) : Date.now();

  const verRaw = Number(course.version);
  const version = Number.isInteger(verRaw) && verRaw >= 1 ? verRaw : 1;

  return {
    id,
    name: name || 'درس حذف‌شده',
    code,
    instructor,
    colorToken,
    credits,
    examDate,
    examTime,
    examKind,
    examScope,
    sessions,
    updatedAt,
    version,
    deletedAt,
  };
}

/**
 * Normalizes the complete study slice ({ role, activeSemester, courses }).
 * @param {Object} raw
 * @returns {{ role: 'university'|'school', activeSemester: string, courses: Array<Object> }}
 */
export function normalizeStudyData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { role: STUDY_ROLES.UNIVERSITY, activeSemester: 'ترم جاری', courses: [] };
  }
  const role = raw.role === STUDY_ROLES.SCHOOL ? STUDY_ROLES.SCHOOL : STUDY_ROLES.UNIVERSITY;
  const fallbackPeriod = getStudyRoleLabels(role).periodDefault;
  const semRaw = typeof raw.activeSemester === 'string' ? raw.activeSemester.trim() : '';
  const activeSemester = semRaw
    ? (semRaw.length > MAX_SEMESTER_LEN ? semRaw.slice(0, MAX_SEMESTER_LEN) : semRaw)
    : fallbackPeriod;

  const byId = new Map();
  for (const c of (Array.isArray(raw.courses) ? raw.courses : [])) {
    const norm = normalizeCourse(c);
    if (!norm) continue;
    const prev = byId.get(norm.id);
    if (!prev || norm.version > prev.version || (norm.version === prev.version && norm.updatedAt > prev.updatedAt)) {
      byId.set(norm.id, norm);
    }
  }

  return {
    role,
    activeSemester,
    courses: Array.from(byId.values()),
  };
}

/**
 * Computes Iranian weekday (0=Saturday .. 6=Friday) for a YYYY-MM-DD key.
 * @param {string} dateKey
 * @returns {number|null}
 */
export function iranianWeekdayFromKey(dateKey) {
  const dt = parseDayKey(dateKey);
  if (!dt) return null;
  return (dt.getDay() + 1) % 7;
}

/**
 * Computes deterministic Jalali week parity ('odd' | 'even') aligned to Saturday..Friday.
 * Week 1 of a Jalali year (containing Farvardin 1) is 'odd', Week 2 is 'even', alternating cleanly.
 * @param {string} dateKey
 * @returns {'odd'|'even'}
 */
export function getJalaliWeekParity(dateKey) {
  const dt = parseDayKey(dateKey);
  if (!dt) return 'odd';
  const j = gregorianToJalali(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  const f1g = jalaliToGregorian(j.jy, 1, 1);
  const f1 = new Date(f1g.gy, f1g.gm - 1, f1g.gd);
  const f1SatOffset = (f1.getDay() + 1) % 7;
  const week1Sat = new Date(f1.getFullYear(), f1.getMonth(), f1.getDate() - f1SatOffset);
  const diffDays = Math.round((dt - week1Sat) / DAY_MS);
  const weekNum = Math.floor(diffDays / 7) + 1;
  return weekNum % 2 === 0 ? 'even' : 'odd';
}

function parityMatches(sessionParity, activeParity) {
  const p = sessionParity === 'even' || sessionParity === 'odd' ? sessionParity : 'all';
  if (p === 'all' || !activeParity || activeParity === 'all') return true;
  return p === activeParity;
}

function paritiesCollide(pA, pB) {
  const a = pA === 'even' || pA === 'odd' ? pA : 'all';
  const b = pB === 'even' || pB === 'odd' ? pB : 'all';
  return a === 'all' || b === 'all' || a === b;
}

/**
 * Detects weekly schedule time overlaps between candidateSession and existing active courses (or extra sessions).
 * @param {Array<Object>} courses
 * @param {Object} candidateSession
 * @param {{ excludeCourseId?: string|null, draftSessions?: Array<Object> }} [options]
 * @returns {Array<{ courseId: string|null, courseName: string, colorToken: string, dayOfWeek: number, timeFrom: number, timeTo: number, parity: string }>}
 */
export function detectScheduleConflicts(courses, candidateSession, options = {}) {
  const cand = validateSession(candidateSession);
  if (!cand) return [];
  const { excludeCourseId = null, draftSessions = [] } = options;
  const conflicts = [];

  for (const raw of (Array.isArray(courses) ? courses : [])) {
    const c = normalizeCourse(raw);
    if (!c || c.deletedAt || (excludeCourseId && c.id === excludeCourseId)) continue;
    for (const s of c.sessions) {
      if (s.dayOfWeek !== cand.dayOfWeek) continue;
      if (!paritiesCollide(s.parity, cand.parity)) continue;
      if (cand.timeFrom < s.timeTo && s.timeFrom < cand.timeTo) {
        conflicts.push({
          courseId: c.id,
          courseName: c.name,
          colorToken: c.colorToken,
          dayOfWeek: s.dayOfWeek,
          timeFrom: s.timeFrom,
          timeTo: s.timeTo,
          parity: s.parity || 'all',
        });
      }
    }
  }

  for (const rawDraft of (Array.isArray(draftSessions) ? draftSessions : [])) {
    const s = validateSession(rawDraft);
    if (!s || s.dayOfWeek !== cand.dayOfWeek) continue;
    if (!paritiesCollide(s.parity, cand.parity)) continue;
    if (cand.timeFrom < s.timeTo && s.timeFrom < cand.timeTo) {
      conflicts.push({
        courseId: null,
        courseName: 'همین درس',
        colorToken: 'accent',
        dayOfWeek: s.dayOfWeek,
        timeFrom: s.timeFrom,
        timeTo: s.timeTo,
        parity: s.parity || 'all',
      });
    }
  }

  return conflicts;
}

/**
 * Returns active courses with examDate >= todayKey, sorted ascending by daysLeft.
 * @param {Array<Object>} courses
 * @param {string} todayKey
 * @returns {Array<Object>}
 */
export function getUpcomingExams(courses, todayKey) {
  const todayDate = parseDayKey(todayKey);
  if (!todayDate || !Array.isArray(courses)) return [];

  const upcoming = [];
  for (const raw of courses) {
    const c = normalizeCourse(raw);
    if (!c || c.deletedAt || !c.examDate || c.examDate < todayKey) continue;
    const examDt = parseDayKey(c.examDate);
    if (!examDt) continue;
    const daysLeft = Math.max(0, Math.round((examDt - todayDate) / DAY_MS));

    let countdownLabel;
    if (daysLeft === 0) countdownLabel = 'امروز';
    else if (daysLeft === 1) countdownLabel = 'فردا';
    else if (daysLeft === 2) countdownLabel = 'پس‌فردا';
    else countdownLabel = `${faNum(daysLeft)} روز مانده`;

    upcoming.push({
      courseId: c.id,
      name: c.name,
      code: c.code,
      colorToken: c.colorToken,
      examDate: c.examDate,
      examTime: c.examTime,
      examKind: c.examKind,
      examScope: c.examScope,
      jalaliDate: formatJalaliDate(examDt),
      daysLeft,
      countdownLabel,
    });
  }

  upcoming.sort((a, b) => {
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    const ta = a.examTime || '99:99';
    const tb = b.examTime || '99:99';
    if (ta !== tb) return ta.localeCompare(tb);
    return a.name.localeCompare(b.name, 'fa');
  });
  return upcoming;
}

/**
 * Returns today's scheduled class sessions sorted ascending by timeFrom.
 * Uses Iranian week where 0 = Saturday .. 6 = Friday and filters even/odd parity if enabled.
 * @param {Array<Object>} courses
 * @param {string} todayKey
 * @param {{ respectParity?: boolean, parityOverride?: 'all'|'even'|'odd'|null }} [options]
 * @returns {Array<Object>}
 */
export function getTodayClasses(courses, todayKey, options = {}) {
  const dow = iranianWeekdayFromKey(todayKey);
  if (dow === null || !Array.isArray(courses)) return [];
  const { respectParity = true, parityOverride = null } = options;
  const activeParity = respectParity
    ? (parityOverride || getJalaliWeekParity(todayKey))
    : 'all';

  const items = [];
  for (const raw of courses) {
    const c = normalizeCourse(raw);
    if (!c || c.deletedAt) continue;
    for (const s of c.sessions) {
      if (s.dayOfWeek !== dow) continue;
      if (!parityMatches(s.parity, activeParity)) continue;
      items.push({
        courseId: c.id,
        courseName: c.name,
        code: c.code,
        instructor: c.instructor,
        colorToken: c.colorToken,
        dayOfWeek: s.dayOfWeek,
        timeFrom: s.timeFrom,
        timeTo: s.timeTo,
        room: s.room,
        parity: s.parity || 'all',
        timeLabel: `${formatClock(s.timeFrom)} تا ${formatClock(s.timeTo)}`,
      });
    }
  }

  items.sort((a, b) => (a.timeFrom - b.timeFrom) || (a.timeTo - b.timeTo));
  return items;
}

/**
 * Computes live/next class spotlight for today relative to nowMinutes (0..1439).
 * @param {Array<Object>} courses
 * @param {string} todayKey
 * @param {number} nowMinutes
 * @param {{ respectParity?: boolean, parityOverride?: 'all'|'even'|'odd'|null }} [options]
 * @returns {{ state: 'live'|'upcoming'|'done', item: Object, minutesDelta: number }|null}
 */
export function getNextClassHighlight(courses, todayKey, nowMinutes, options = {}) {
  const classes = getTodayClasses(courses, todayKey, options);
  if (!classes.length || !Number.isFinite(nowMinutes)) return null;

  const live = classes.find(item => getClassStatus(item, nowMinutes) === 'live');
  if (live) {
    return { state: 'live', item: live, minutesDelta: Math.max(1, live.timeTo - nowMinutes) };
  }

  const upcoming = classes.find(item => getClassStatus(item, nowMinutes) === 'upcoming');
  if (upcoming) {
    return { state: 'upcoming', item: upcoming, minutesDelta: Math.max(1, upcoming.timeFrom - nowMinutes) };
  }

  return { state: 'done', item: classes[classes.length - 1], minutesDelta: 0 };
}

/**
 * Computes open tasks, done tasks, and linked books counts for a course.
 * Ignores soft-deleted tasks.
 * @param {string} courseId
 * @param {Array<Object>} activeTasks
 * @param {Array<Object>} booksMeta
 * @returns {{ openTasksCount: number, doneTasksCount: number, linkedBooksCount: number }}
 */
export function computeCourseStats(courseId, activeTasks = [], booksMeta = []) {
  if (!courseId || typeof courseId !== 'string') {
    return { openTasksCount: 0, doneTasksCount: 0, linkedBooksCount: 0 };
  }
  let openTasksCount = 0;
  let doneTasksCount = 0;
  for (const t of (Array.isArray(activeTasks) ? activeTasks : [])) {
    if (!t || t.deletedAt || t.courseId !== courseId) continue;
    if (t.done) doneTasksCount += 1;
    else openTasksCount += 1;
  }

  let linkedBooksCount = 0;
  for (const b of (Array.isArray(booksMeta) ? booksMeta : [])) {
    if (!b || b.deletedAt || b.courseId !== courseId) continue;
    linkedBooksCount += 1;
  }

  return { openTasksCount, doneTasksCount, linkedBooksCount };
}

/**
 * Resolves conflict between two normalized course versions (higher version -> higher updatedAt -> tombstone).
 * @param {Object} local
 * @param {Object} incoming
 * @returns {Object}
 */
function pickCourse(local, incoming) {
  if (incoming.version > local.version) return incoming;
  if (local.version > incoming.version) return local;
  if (incoming.updatedAt > local.updatedAt) return incoming;
  if (local.updatedAt > incoming.updatedAt) return local;
  if (incoming.deletedAt && !local.deletedAt) return incoming;
  return local;
}

/**
 * Pure conflict-resolution merger for study data (role + periods + courses by id).
 * @param {Object} local
 * @param {Object} incoming
 * @returns {{ role: 'university'|'school', activeSemester: string, courses: Array<Object> }}
 */
export function mergeStudyData(local, incoming) {
  const localNorm = normalizeStudyData(local);
  const incomingNorm = normalizeStudyData(incoming);

  const localHasRole = Boolean(local && (local.role === STUDY_ROLES.SCHOOL || local.role === STUDY_ROLES.UNIVERSITY));
  const incomingHasRole = Boolean(incoming && (incoming.role === STUDY_ROLES.SCHOOL || incoming.role === STUDY_ROLES.UNIVERSITY));
  const role = localHasRole
    ? localNorm.role
    : (incomingHasRole ? incomingNorm.role : localNorm.role);

  const localHasSem = Boolean(local && typeof local.activeSemester === 'string' && local.activeSemester.trim());
  const incomingHasSem = Boolean(incoming && typeof incoming.activeSemester === 'string' && incoming.activeSemester.trim());
  const activeSemester = localHasSem
    ? localNorm.activeSemester
    : (incomingHasSem ? incomingNorm.activeSemester : getStudyRoleLabels(role).periodDefault);

  const byId = new Map();
  for (const c of localNorm.courses) byId.set(c.id, c);
  for (const c of incomingNorm.courses) {
    const cur = byId.get(c.id);
    byId.set(c.id, cur ? pickCourse(cur, c) : c);
  }

  return {
    role,
    activeSemester,
    courses: Array.from(byId.values()),
  };
}
