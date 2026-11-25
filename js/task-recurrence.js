/* ═══ Pure Recurrence & Subtask Logic ═══
   Zero DOM dependencies — 100% testable in Node.js.
   Handles:
     · Subtask normalization, progress calculation, and immutable mutations (max 20)
     · Recurring task validation and Jalali-aware next due-date computation */

import { dayKey, shiftKey } from './utils.js';
import { dateToJalali, jalaliDaysInMonth, jalaliToDate } from './jalali.js';

export const REPEAT_OPTIONS = Object.freeze(['daily', 'weekly', 'monthly']);
export const REPEAT_LABELS = Object.freeze({
  daily: 'روزانه',
  weekly: 'هفتگی',
  monthly: 'ماهانه',
});
export const MAX_SUBTASKS = 20;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function makeSubId(index = 0) {
  return `sub-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Normalizes a subtasks list safely, capping at MAX_SUBTASKS (20).
 * @param {unknown} list
 * @returns {Array<{ id: string, text: string, done: boolean }>}
 */
export function normalizeSubtasks(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();

  for (let i = 0; i < list.length && out.length < MAX_SUBTASKS; i++) {
    const item = list[i];
    if (!item || typeof item !== 'object') continue;
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) continue;
    let id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : makeSubId(i);
    if (seen.has(id)) id = makeSubId(i);
    seen.add(id);
    out.push({
      id,
      text: text.slice(0, 120),
      done: Boolean(item.done),
    });
  }

  return out;
}

/**
 * Computes completion progress for a task's subtasks.
 * @param {Array<Object>} subtasks
 * @returns {{ done: number, total: number, pct: number }}
 */
export function calcSubtaskProgress(subtasks) {
  const list = normalizeSubtasks(subtasks);
  const total = list.length;
  const done = list.filter(s => s.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

/**
 * Toggles a subtask item by ID immutably.
 * @param {Array<Object>} subtasks
 * @param {string} subId
 * @returns {Array<{ id: string, text: string, done: boolean }>}
 */
export function toggleSubtaskItem(subtasks, subId) {
  const list = normalizeSubtasks(subtasks);
  if (!subId) return list;
  return list.map(s => (s.id === subId ? { ...s, done: !s.done } : s));
}

/**
 * Adds a subtask item immutably up to MAX_SUBTASKS.
 * @param {Array<Object>} subtasks
 * @param {string} text
 * @param {string} [id]
 * @returns {Array<{ id: string, text: string, done: boolean }>}
 */
export function addSubtaskItem(subtasks, text, id) {
  const list = normalizeSubtasks(subtasks);
  const clean = typeof text === 'string' ? text.trim().slice(0, 120) : '';
  if (!clean || list.length >= MAX_SUBTASKS) return list;
  const nextId = typeof id === 'string' && id.trim() ? id.trim() : makeSubId(list.length);
  return [...list, { id: nextId, text: clean, done: false }];
}

/**
 * Removes a subtask item by ID immutably.
 * @param {Array<Object>} subtasks
 * @param {string} subId
 * @returns {Array<{ id: string, text: string, done: boolean }>}
 */
export function removeSubtaskItem(subtasks, subId) {
  const list = normalizeSubtasks(subtasks);
  if (!subId) return list;
  return list.filter(s => s.id !== subId);
}

/**
 * Normalizes a repeat frequency value.
 * @param {unknown} repeat
 * @returns {'daily'|'weekly'|'monthly'|null}
 */
export function normalizeRepeat(repeat) {
  return REPEAT_OPTIONS.includes(repeat) ? repeat : null;
}

/**
 * Computes the next due date string (YYYY-MM-DD) for a recurring task.
 * Advances relative to todayStr if currentDueDate is null or already overdue.
 * Monthly recurrence advances one Jalali calendar month with safe day clamping.
 * @param {string|null} currentDueDate
 * @param {string|null} repeat
 * @param {string} [todayStr]
 * @returns {string|null}
 */
export function computeNextDueDate(currentDueDate, repeat, todayStr = dayKey(new Date())) {
  const freq = normalizeRepeat(repeat);
  if (!freq) return null;

  const today = typeof todayStr === 'string' && DATE_RE.test(todayStr) ? todayStr : dayKey(new Date());
  const base = typeof currentDueDate === 'string' && DATE_RE.test(currentDueDate) && currentDueDate >= today
    ? currentDueDate
    : today;

  if (freq === 'daily') return shiftKey(base, 1);
  if (freq === 'weekly') return shiftKey(base, 7);

  // 'monthly' — Jalali calendar month +1 with day-of-month clamping
  const [gy, gm, gd] = base.split('-').map(Number);
  const baseDate = new Date(gy, gm - 1, gd);
  const { jy, jm, jd } = dateToJalali(baseDate);
  const nextJy = jm === 12 ? jy + 1 : jy;
  const nextJm = jm === 12 ? 1 : jm + 1;
  const maxDay = jalaliDaysInMonth(nextJy, nextJm);
  const nextJd = Math.min(jd, maxDay);
  return dayKey(jalaliToDate(nextJy, nextJm, nextJd));
}

/**
 * Builds the creation payload for the next occurrence of a completed recurring task.
 * Resets all subtasks to done: false and sets done: false with the next dueDate.
 * @param {Object} completedTask
 * @param {string} [todayStr]
 * @returns {Object|null}
 */
export function buildNextRecurringTaskPayload(completedTask, todayStr = dayKey(new Date())) {
  if (!completedTask || typeof completedTask !== 'object') return null;
  const repeat = normalizeRepeat(completedTask.repeat);
  if (!repeat) return null;

  const nextDue = computeNextDueDate(completedTask.dueDate || null, repeat, todayStr);
  const resetSubtasks = normalizeSubtasks(completedTask.subtasks).map(s => ({ ...s, done: false }));

  return {
    text: String(completedTask.text || '').trim(),
    p: ['low', 'mid', 'high'].includes(completedTask.p) ? completedTask.p : 'mid',
    cat: typeof completedTask.cat === 'string' && completedTask.cat.trim() ? completedTask.cat.trim() : 'misc',
    dueDate: nextDue,
    durationMin: completedTask.durationMin ?? null,
    timeFrom: completedTask.timeFrom ?? null,
    timeTo: completedTask.timeTo ?? null,
    notify: Boolean(completedTask.notify),
    repeat,
    subtasks: resetSubtasks,
    done: false,
  };
}
