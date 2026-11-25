/* ═══ Day Activity Marker ═══
   Records active days in history when tasks are completed or books are read.
   Daily moods now live exclusively in the Journal workspace (#page-journal). */

import { state } from './state.js';
import { saveHistory } from './store.js';
import { dayKey } from './utils.js';

export function recordDay() {
  const k = dayKey(new Date());
  if (!Array.isArray(state.history)) state.history = [];
  if (!state.history.includes(k)) {
    state.history.push(k);
    saveHistory(state.history);
  }
}

export function initWeek() {}