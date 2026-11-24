/* ═══ Unit Tests for Privacy-First Local Diagnostics (js/diagnostics.js) ═══ */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIAGNOSTICS_STORAGE_KEY,
  MAX_DIAGNOSTIC_ENTRIES,
  redactSensitiveData,
  sanitizeError,
  getDiagnostics,
  pushDiagnosticEntry,
  clearDiagnostics,
  formatDiagnosticsReport,
} from '../js/diagnostics.js';

// Setup mock localStorage in Node.js global context
const storageStore = new Map();
globalThis.localStorage = {
  getItem: key => storageStore.get(key) || null,
  setItem: (key, val) => storageStore.set(key, String(val)),
  removeItem: key => storageStore.delete(key),
  clear: () => storageStore.clear(),
};

test('redactSensitiveData: sanitizes emails, query params, tokens and local paths', () => {
  // Email redaction
  const emailStr = 'Failed while syncing user user.name_12@example.com into storage';
  assert.equal(
    redactSensitiveData(emailStr),
    'Failed while syncing user [email_redacted] into storage'
  );

  // URL query parameters redaction
  const urlStr = 'Fetch error from https://api.daftrche.ir/sync?apiKey=super_secret_123&session=xyz';
  assert.equal(
    redactSensitiveData(urlStr),
    'Fetch error from https://api.daftrche.ir/sync?query_redacted'
  );

  // Absolute local file paths normalization (Windows and Unix)
  const winPath = 'Error at C:\\Users\\Administrator\\Projects\\NewDaftrche\\js\\tasks.js:42:15';
  assert.equal(
    redactSensitiveData(winPath),
    'Error at js/tasks.js:42:15'
  );

  // Long hex hash redaction
  const hashStr = 'Token 4a5b6c7d8e9f0123456789abcdef0123 invalid';
  assert.equal(
    redactSensitiveData(hashStr),
    'Token [hash_redacted] invalid'
  );
});

test('sanitizeError: truncates message to 160 chars and caps stack frames at 3', () => {
  const longMsg = 'This is a very long descriptive error message detailing an unexpected runtime failure that occurred while processing task lists and rendering items on screen ' + 'xyz '.repeat(40);
  const err = new Error(longMsg);
  err.stack = `Error: ${longMsg}\n    at fnA (C:\\Project\\js\\tasks.js:10:5)\n    at fnB (C:\\Project\\js\\app.js:20:5)\n    at fnC (C:\\Project\\js\\main.js:30:5)\n    at fnD (C:\\Project\\js\\extra.js:40:5)\n    at fnE (C:\\Project\\js\\more.js:50:5)`;

  const sanitized = sanitizeError(err, 'custom.source', 'v210', 1700000000000);

  assert.equal(sanitized.name, 'Error');
  assert.equal(sanitized.source, 'custom.source');
  assert.equal(sanitized.build, 'v210');
  assert.equal(sanitized.ts, new Date(1700000000000).toISOString());
  assert.equal(sanitized.message.length, 160, 'Message is truncated to 160 chars');
  assert.equal(sanitized.stack.length, 3, 'Stack frames capped at top 3');
  assert.ok(sanitized.stack[0].includes('js/tasks.js'));
});

test('sanitizeError: handles non-Error objects, strings, null and undefined gracefully', () => {
  // String error
  const strSanitized = sanitizeError('Simple string error');
  assert.equal(strSanitized.name, 'Error');
  assert.equal(strSanitized.message, 'Simple string error');
  assert.deepEqual(strSanitized.stack, []);

  // Object with status code
  const objSanitized = sanitizeError({ status: 404, statusText: 'Not Found' });
  assert.equal(objSanitized.message, 'HTTP 404');

  // Object with reason string
  const reasonSanitized = sanitizeError({ reason: 'Quota exceeded' });
  assert.equal(reasonSanitized.message, 'Quota exceeded');

  // null and undefined
  const nullSanitized = sanitizeError(null);
  assert.equal(nullSanitized.message, 'Unknown error');
  assert.equal(nullSanitized.name, 'Error');

  const undefSanitized = sanitizeError(undefined);
  assert.equal(undefSanitized.message, 'Unknown error');
});

test('Ring buffer storage: caps at MAX_DIAGNOSTIC_ENTRIES (30) and drops oldest', () => {
  clearDiagnostics();
  assert.deepEqual(getDiagnostics(), []);

  // Push 35 entries
  for (let i = 1; i <= 35; i++) {
    pushDiagnosticEntry(sanitizeError(`Error event ${i}`, 'test.loop', 'v210', 1000 + i));
  }

  const stored = getDiagnostics();
  assert.equal(stored.length, MAX_DIAGNOSTIC_ENTRIES, 'Buffer length never exceeds 30');
  // First stored entry should be event 6 (events 1-5 dropped)
  assert.equal(stored[0].message, 'Error event 6');
  // Last stored entry should be event 35
  assert.equal(stored[29].message, 'Error event 35');

  // Clear diagnostics empties log
  clearDiagnostics();
  assert.deepEqual(getDiagnostics(), []);
});

test('formatDiagnosticsReport: formats clean Markdown report with and without errors', async () => {
  clearDiagnostics();

  // Empty state
  const emptyReport = await formatDiagnosticsReport();
  assert.ok(emptyReport.includes('# گزارش عیب‌یابی دَفتَرچه'));
  assert.ok(emptyReport.includes('تعداد خطاهای ثبت‌شده: 0'));
  assert.ok(emptyReport.includes('هیچ خطایی ثبت نشده است'));

  // With logged error
  pushDiagnosticEntry(sanitizeError(new Error('Canvas render failed'), 'reader.canvas', 'v210'));
  const populatedReport = await formatDiagnosticsReport();
  assert.ok(populatedReport.includes('تعداد خطاهای ثبت‌شده: 1'));
  assert.ok(populatedReport.includes('منبع: reader.canvas'));
  assert.ok(populatedReport.includes('Canvas render failed'));
  assert.ok(populatedReport.includes('بیلد: v210'));
});
