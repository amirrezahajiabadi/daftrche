/* Phase 2: Surgical DOM Updates, List Chunking & Input Debouncing */
import './_env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tasksCode = readFileSync(new URL('../js/tasks.js', import.meta.url), 'utf8');
const statsCode = readFileSync(new URL('../js/stats.js', import.meta.url), 'utf8');
const appCode = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const todayCode = readFileSync(new URL('../js/today.js', import.meta.url), 'utf8');

test('chunking: CHUNK_SIZE is 40 in tasks.js and stats.js for bounded batch rendering', () => {
  assert.match(tasksCode, /const CHUNK_SIZE = 40;/);
  assert.match(statsCode, /const HISTORY_CHUNK_SIZE = 40;/);
  assert.match(tasksCode, /IntersectionObserver/);
  assert.match(statsCode, /IntersectionObserver/);
});

test('surgical mutations: task rows have data-id and updateTaskRow updates in-place', () => {
  assert.match(tasksCode, /li\.dataset\.id = task\.id;/);
  assert.match(tasksCode, /export function updateTaskRow\(/);
  assert.match(tasksCode, /export function updateCountersAndProgress\(/);
});

test('debouncing: search input and natural language task parser are debounced by 120ms', () => {
  // Search input debounce in app.js and tasks.js
  assert.match(appCode, /setTimeout\(\(\) => \{ state\.query = e\.target\.value\.trim\(\); renderList\(\); \}, 120\)/);
  assert.match(tasksCode, /setTimeout\(\(\) => \{\s*state\.query = searchInput\.value\.trim\(\);\s*renderList\(\);\s*\}, 120\)/);
  // Quick-add input debounce in tasks.js and today.js
  assert.match(tasksCode, /quickAddTimer = setTimeout\(processQuickAdd, 120\)/);
  assert.match(todayCode, /todayTimer = setTimeout\(processTodayQuickAdd, 120\)/);
});

test('accessibility & progress bar: track maintains aria-valuenow and role=progressbar', () => {
  assert.match(tasksCode, /track\.setAttribute\('aria-valuenow', String\(pct\)\)/);
  assert.match(todayCode, /track\?\.setAttribute\('aria-valuenow', String\(pct\)\)/);
});

