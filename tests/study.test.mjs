/* ═══ Sprint 3.3 Tests: Academic Workflow (Courses, Schedule, Exams, Links & Backup) ═══ */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_COURSE_NAME,
  MAX_COURSE_CODE,
  MAX_INSTRUCTOR,
  MAX_CREDITS,
  STUDY_ROLES,
  SCHOOL_BELL_PRESETS,
  COURSE_COLOR_TOKENS,
  courseColorCss,
  getStudyRoleLabels,
  getJalaliWeekParity,
  detectScheduleConflicts,
  getNextClassHighlight,
  validateSession,
  normalizeCourse,
  normalizeStudyData,
  iranianWeekdayFromKey,
  getUpcomingExams,
  getTodayClasses,
  getClassStatus,
  computeCourseStats,
  computeSemesterSummary,
  mergeStudyData,
} from '../js/study-logic.js';
import { createTask, updateTask } from '../js/taskrepo.js';
import { state, normalizeTask } from '../js/state.js';
import { projectTaskForSync, projectBookProgressForSync } from '../js/sync-projection.js';
import { collectBackup, parseBackup, applyBackup, mergeBackup } from '../js/backup.js';
import { STORAGE_KEYS } from '../js/constants.js';
import { resetPending } from '../js/store.js';

class FakeStorage {
  constructor(init = {}) {
    this.map = new Map(Object.entries(init));
  }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

test('normalizeStudyData & normalizeCourse: clamps fields, validates sessions, and uses semantic color tokens', () => {
  const empty = normalizeStudyData(null);
  assert.equal(empty.activeSemester, 'ترم جاری');
  assert.deepEqual(empty.courses, []);

  assert.equal(normalizeCourse({ name: '   ' }), null);
  assert.equal(normalizeCourse(null), null);

  assert.equal(validateSession({ dayOfWeek: -1, timeFrom: 600, timeTo: 700 }), null);
  assert.equal(validateSession({ dayOfWeek: 7, timeFrom: 600, timeTo: 700 }), null);
  assert.equal(validateSession({ dayOfWeek: 0, timeFrom: 700, timeTo: 600 }), null);

  const validSess = validateSession({ dayOfWeek: 0, timeFrom: 480, timeTo: 600, room: '  کلاس ۱۰۲  ' });
  assert.deepEqual(validSess, { dayOfWeek: 0, timeFrom: 480, timeTo: 600, room: 'کلاس ۱۰۲' });

  const c = normalizeCourse({
    id: 'c-1',
    name: '  ' + 'س'.repeat(MAX_COURSE_NAME + 15) + '  ',
    code: 'CE-1234567890123456789012345',
    instructor: 'ا'.repeat(MAX_INSTRUCTOR + 10),
    colorToken: '#ff0000', // invalid raw hex rejected -> falls back to 'accent'
    credits: 99,
    examDate: '2026-12-10',
    examTime: '9:05',
    sessions: [
      { dayOfWeek: 2, timeFrom: 600, timeTo: 720 },
      { dayOfWeek: 0, timeFrom: 480, timeTo: 570 },
      { dayOfWeek: 9, timeFrom: 480, timeTo: 570 }, // dropped
    ],
  });

  assert.equal(c.name.length, MAX_COURSE_NAME);
  assert.equal(c.code.length, MAX_COURSE_CODE);
  assert.equal(c.instructor.length, MAX_INSTRUCTOR);
  assert.equal(c.colorToken, 'accent');
  assert.equal(courseColorCss(c.colorToken), 'var(--color-accent)');
  assert.ok(COURSE_COLOR_TOKENS.includes('success'));
  assert.equal(c.credits, MAX_CREDITS);
  assert.equal(c.examDate, '2026-12-10');
  assert.equal(c.examTime, '09:05');
  assert.equal(normalizeCourse({ id: 'fa-time', name: 'فیزیک', examDate: '2026-12-10', examTime: '۰۹:۳۰' }).examTime, '09:30');
  assert.equal(normalizeCourse({ id: 'badt', name: 'تست', examDate: '2026-12-10', examTime: '25:99' }).examTime, null);
  assert.equal(c.sessions.length, 2);
  // Sessions sorted by dayOfWeek ascending
  assert.equal(c.sessions[0].dayOfWeek, 0);
  assert.equal(c.sessions[1].dayOfWeek, 2);
});

test('getUpcomingExams: filters past/deleted courses, sorts ascending, and formats Persian countdown', () => {
  const today = '2026-11-25';
  const courses = [
    { id: 'c-past', name: 'گذشته', examDate: '2026-11-24' },
    { id: 'c-del', name: 'حذف‌شده', examDate: '2026-11-26', deletedAt: 123 },
    { id: 'c-far', name: 'الگوریتم', examDate: '2026-12-01', examTime: '14:00' },
    { id: 'c-today', name: 'ریاضی', examDate: '2026-11-25', examTime: '09:00', colorToken: 'danger' },
    { id: 'c-tomorrow', name: 'فیزیک', examDate: '2026-11-26', colorToken: 'success' },
  ];

  const upcoming = getUpcomingExams(courses, today);
  assert.deepEqual(upcoming.map(e => e.courseId), ['c-today', 'c-tomorrow', 'c-far']);
  assert.equal(upcoming[0].countdownLabel, 'امروز');
  assert.equal(upcoming[1].countdownLabel, 'فردا');
  assert.match(upcoming[2].countdownLabel, /روز مانده/);
});

test('getTodayClasses: maps Iranian week (Saturday=0 .. Friday=6) and sorts by timeFrom', () => {
  // 2026-11-21 = Saturday (0), 2026-11-25 = Wednesday (4), 2026-11-27 = Friday (6)
  assert.equal(iranianWeekdayFromKey('2026-11-21'), 0);
  assert.equal(iranianWeekdayFromKey('2026-11-25'), 4);
  assert.equal(iranianWeekdayFromKey('2026-11-27'), 6);

  const courses = [
    {
      id: 'c1',
      name: 'هوش مصنوعی',
      colorToken: 'accent',
      sessions: [
        { dayOfWeek: 4, timeFrom: 14 * 60, timeTo: 16 * 60, room: '۳۰۱' },
        { dayOfWeek: 0, timeFrom: 8 * 60, timeTo: 10 * 60 },
      ],
    },
    {
      id: 'c2',
      name: 'پایگاه داده',
      colorToken: 'warning',
      sessions: [
        { dayOfWeek: 4, timeFrom: 9 * 60, timeTo: 11 * 60, room: '۲۰۴' },
      ],
    },
    {
      id: 'c3',
      name: 'حذف‌شده',
      deletedAt: 999,
      sessions: [{ dayOfWeek: 4, timeFrom: 7 * 60, timeTo: 8 * 60 }],
    },
  ];

  const wed = getTodayClasses(courses, '2026-11-25');
  assert.deepEqual(wed.map(x => x.courseId), ['c2', 'c1']);
  assert.equal(wed[0].room, '۲۰۴');
  assert.deepEqual(getTodayClasses(courses, '2026-11-27'), []);
});

test('computeCourseStats: counts linked active tasks and PDF books accurately', () => {
  const tasks = [
    { id: 't1', text: 'تمرین ۱', done: false, courseId: 'c1' },
    { id: 't2', text: 'تمرین ۲', done: true, courseId: 'c1' },
    { id: 't3', text: 'حذف‌شده', done: false, courseId: 'c1', deletedAt: 100 },
    { id: 't4', text: 'درس دیگر', done: false, courseId: 'c2' },
  ];
  const books = [
    { id: 'b1', title: 'جزوه ۱', courseId: 'c1' },
    { id: 'b2', title: 'کتاب ۲', courseId: 'c2' },
    { id: 'b3', title: 'جزوه حذف‌شده', courseId: 'c1', deletedAt: 55 },
  ];

  assert.deepEqual(computeCourseStats('c1', tasks, books), {
    openTasksCount: 1,
    doneTasksCount: 1,
    linkedBooksCount: 1,
  });

  assert.equal(getClassStatus({ timeFrom: 540, timeTo: 660 }, 500), 'upcoming');
  assert.equal(getClassStatus({ timeFrom: 540, timeTo: 660 }, 600), 'live');
  assert.equal(getClassStatus({ timeFrom: 540, timeTo: 660 }, 700), 'done');

  const summary = computeSemesterSummary([
    { id: 'c1', name: 'ریاضی', credits: 3, examDate: '2026-12-01' },
    { id: 'c2', name: 'فیزیک', credits: 4, examDate: '2026-11-20' },
    { id: 'c3', name: 'حذف‌شده', credits: 3, deletedAt: 10 },
  ], '2026-11-25');
  assert.deepEqual(summary, { courseCount: 2, totalCredits: 7, upcomingExamsCount: 1 });
});

test('mergeStudyData: resolves conflicts by version, updatedAt, and tombstones', () => {
  const local = {
    activeSemester: 'پاییز ۱۴۰۵',
    courses: [
      { id: 'c1', name: 'محلی جدیدتر', version: 2, updatedAt: 500 },
      { id: 'c2', name: 'تایم‌استمپ قدیمی‌تر', version: 1, updatedAt: 100 },
      { id: 'c3', name: 'فقط محلی', version: 1, updatedAt: 100 },
    ],
  };
  const incoming = {
    activeSemester: 'بهار ۱۴۰۶',
    courses: [
      { id: 'c1', name: 'ورودی قدیمی‌تر', version: 1, updatedAt: 9999 },
      { id: 'c2', name: 'حذف‌شده در ورودی', version: 1, updatedAt: 300, deletedAt: 300 },
      { id: 'c4', name: 'فقط ورودی', version: 1, updatedAt: 200 },
    ],
  };

  const merged = mergeStudyData(local, incoming);
  assert.equal(merged.activeSemester, 'پاییز ۱۴۰۵');
  const byId = new Map(merged.courses.map(c => [c.id, c]));
  assert.equal(byId.get('c1').name, 'محلی جدیدتر');
  assert.equal(byId.get('c2').deletedAt, 300);
  assert.ok(byId.has('c3'));
  assert.ok(byId.has('c4'));
});

test('taskrepo, sync-projection, and backup preserve courseId and daftarche-study seamlessly', () => {
  const prevTasks = state.tasks;
  try {
    state.tasks = [];

    // Legacy task without courseId gets clean null
    const legacy = normalizeTask({ id: 'leg-1', text: 'کار قدیمی' });
    assert.equal(legacy.courseId, null);

    const created = createTask({ text: 'حل تمرین شبکه', courseId: 'crs-net', cat: 'study' });
    assert.equal(created.ok, true);
    assert.equal(created.record.courseId, 'crs-net');

    const updated = updateTask(created.record.id, { courseId: 'crs-algo' });
    assert.equal(updated.ok, true);
    assert.equal(updated.record.courseId, 'crs-algo');

    const taskWire = projectTaskForSync(updated.record);
    assert.equal(taskWire.courseId, 'crs-algo');

    const bookWire = projectBookProgressForSync({ id: 'b1', title: 'جزوه شبکه', courseId: 'crs-net', lastPage: 4, numPages: 50 });
    assert.equal(bookWire.courseId, 'crs-net');

    const studyKey = STORAGE_KEYS.study;
    const src = new FakeStorage({
      [studyKey]: JSON.stringify({
        activeSemester: 'پاییز ۱۴۰۵',
        courses: [{ id: 'c1', name: 'معماری کامپیوتر', credits: 3, version: 2, updatedAt: 500 }],
      }),
    });
    const exported = collectBackup(src, { release: '3.5.0' });
    const parsed = parseBackup(JSON.stringify(exported));
    assert.equal(parsed.ok, true);
    assert.ok(studyKey in parsed.backup.data);

    const dest = new FakeStorage({
      [studyKey]: JSON.stringify({
        activeSemester: 'پاییز ۱۴۰۵',
        courses: [
          { id: 'c1', name: 'نسخه قدیمی', credits: 2, version: 1, updatedAt: 100 },
          { id: 'c2', name: 'درس دوم', credits: 3, version: 1, updatedAt: 100 },
        ],
      }),
    });
    const merged = mergeBackup(dest, parsed.backup);
    assert.equal(merged.ok, true);
    const mergedStudy = JSON.parse(dest.getItem(studyKey));
    assert.equal(mergedStudy.courses.find(c => c.id === 'c1').name, 'معماری کامپیوتر');
    assert.ok(mergedStudy.courses.some(c => c.id === 'c2'));

    const appliedStorage = new FakeStorage();
    const applied = applyBackup(appliedStorage, parsed.backup);
    assert.equal(applied.ok, true);
    assert.equal(JSON.parse(appliedStorage.getItem(studyKey)).courses.length, 1);
  } finally {
    resetPending();
    state.tasks = prevTasks;
  }
});

test('student roles (university vs school), bell presets, exam kind/scope & backward compatibility', () => {
  const schoolData = normalizeStudyData({
    role: STUDY_ROLES.SCHOOL,
    courses: [{ id: 's1', name: 'شیمی دهم', examDate: '2026-12-02', examKind: '  پرسش کلاسی  ', examScope: '  فصل ۱ و ۲  ' }],
  });
  assert.equal(schoolData.role, 'school');
  assert.equal(schoolData.activeSemester, 'سال تحصیلی');
  assert.equal(schoolData.courses[0].examKind, 'پرسش کلاسی');
  assert.equal(schoolData.courses[0].examScope, 'فصل ۱ و ۲');

  const schoolLabels = getStudyRoleLabels('school');
  const uniLabels = getStudyRoleLabels('university');
  assert.equal(schoolLabels.showCodeCredits, false);
  assert.equal(uniLabels.showCodeCredits, true);
  assert.match(schoolLabels.instructorLabel, /دبیر/);
  assert.ok(SCHOOL_BELL_PRESETS.length >= 4);

  const upcoming = getUpcomingExams(schoolData.courses, '2026-11-25');
  assert.equal(upcoming[0].examKind, 'پرسش کلاسی');
  assert.equal(upcoming[0].examScope, 'فصل ۱ و ۲');

  const merged = mergeStudyData(
    { role: 'school', activeSemester: 'پایه دهم', courses: [] },
    { role: 'university', activeSemester: 'پاییز ۱۴۰۵', courses: [] },
  );
  assert.equal(merged.role, 'school');
  assert.equal(merged.activeSemester, 'پایه دهم');
});

test('Jalali week parity, schedule conflict detection & next class highlight', () => {
  // 2026-11-21 (Sat) .. 2026-11-27 (Fri) belong to the exact same week; +7 days flips parity
  const satParity = getJalaliWeekParity('2026-11-21');
  const wedParity = getJalaliWeekParity('2026-11-25');
  const friParity = getJalaliWeekParity('2026-11-27');
  const nextSatParity = getJalaliWeekParity('2026-11-28');
  assert.equal(satParity, wedParity);
  assert.equal(wedParity, friParity);
  assert.notEqual(satParity, nextSatParity);

  const courses = [
    {
      id: 'c-even',
      name: 'آزمایشگاه فیزیک',
      sessions: [{ dayOfWeek: 0, timeFrom: 8 * 60, timeTo: 10 * 60, parity: 'even' }],
    },
    {
      id: 'c-odd',
      name: 'آزمایشگاه شیمی',
      sessions: [{ dayOfWeek: 0, timeFrom: 8 * 60, timeTo: 10 * 60, parity: 'odd' }],
    },
    {
      id: 'c-all',
      name: 'ریاضی عمومی',
      sessions: [{ dayOfWeek: 0, timeFrom: 10 * 60 + 30, timeTo: 12 * 60 }],
    },
  ];

  // Saturday parity filtering
  const evenClasses = getTodayClasses(courses, '2026-11-21', { parityOverride: 'even' });
  assert.deepEqual(evenClasses.map(c => c.courseId), ['c-even', 'c-all']);
  const oddClasses = getTodayClasses(courses, '2026-11-21', { parityOverride: 'odd' });
  assert.deepEqual(oddClasses.map(c => c.courseId), ['c-odd', 'c-all']);

  // Conflict detection: even vs odd on same hour -> NO conflict; all vs even -> conflict
  const noOverlapBetweenAlternating = detectScheduleConflicts(courses, {
    dayOfWeek: 0, timeFrom: 8 * 60 + 30, timeTo: 9 * 60 + 30, parity: 'odd',
  }, { excludeCourseId: 'c-odd' });
  assert.equal(noOverlapBetweenAlternating.length, 0);

  const overlapWithAll = detectScheduleConflicts(courses, {
    dayOfWeek: 0, timeFrom: 11 * 60, timeTo: 12 * 60 + 30, parity: 'even',
  });
  assert.equal(overlapWithAll.length, 1);
  assert.equal(overlapWithAll[0].courseId, 'c-all');

  // Next class highlight states: live, upcoming, done
  const liveSpot = getNextClassHighlight(courses, '2026-11-21', 9 * 60, { parityOverride: 'even' });
  assert.equal(liveSpot.state, 'live');
  assert.equal(liveSpot.item.courseId, 'c-even');
  assert.equal(liveSpot.minutesDelta, 60);

  const upSpot = getNextClassHighlight(courses, '2026-11-21', 10 * 60 + 5, { parityOverride: 'even' });
  assert.equal(upSpot.state, 'upcoming');
  assert.equal(upSpot.item.courseId, 'c-all');
  assert.equal(upSpot.minutesDelta, 25);

  const doneSpot = getNextClassHighlight(courses, '2026-11-21', 15 * 60, { parityOverride: 'even' });
  assert.equal(doneSpot.state, 'done');
});
