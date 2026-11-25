/* ═══ Client Auth & Two-Way Sync End-to-End Integration Tests ═══
   Spins up the real Express + SQLite backend (server/api-server.js) and drives
   js/auth-client.js, js/sync-client.js, js/outbox.js, js/taskrepo.js, and
   js/backup.js against it. */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

import { state } from '../js/state.js';
import { flushPending, resetPending } from '../js/store.js';
import { createTask, updateTask, softDeleteTask, getActiveTasks } from '../js/taskrepo.js';
import { isSyncEnabled, setSyncEnabled, appendChange, getPendingCount, clearOutbox, OUTBOX_STORAGE_KEY } from '../js/outbox.js';
import { projectBookProgressForSync, createSyncEnvelope } from '../js/sync-projection.js';
import { collectBackup, isBackupKey } from '../js/backup.js';
import {
  AUTH_STORAGE_KEY,
  SYNC_CURSOR_KEY,
  LAST_SYNC_AT_KEY,
  configureAuth,
  getAuthState,
  getSyncCursor,
  requestOtp,
  verifyOtp,
  fetchMe,
  logout,
} from '../js/auth-client.js';
import {
  configureSync,
  syncNow,
  initSyncTriggers,
} from '../js/sync-client.js';

const require = createRequire(import.meta.url);
const { openDatabase } = require('../server/db.js');
const { createApp } = require('../server/api-server.js');

class FakeStorage {
  constructor(init = {}) {
    this.map = new Map(Object.entries(init));
  }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

function resetDeviceEnvironment(storageInit = {}) {
  resetPending();
  const storage = new FakeStorage(storageInit);
  globalThis.localStorage = storage;
  clearOutbox();
  setSyncEnabled(false);
  state.tasks = [];
  return storage;
}

function startBackend() {
  const sentOtps = [];
  const db = openDatabase(':memory:');
  const app = createApp({
    db,
    nodeEnv: 'test',
    enableRequestLog: false,
    sendOtp: async (identifier, code) => {
      sentOtps.push({ identifier, code });
      return { ok: true };
    },
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        db,
        baseUrl,
        sentOtps,
        async close() {
          await new Promise(res => server.close(res));
          try { db.close(); } catch (_) {}
        },
      });
    });
  });
}

test('Guest mode: zero HTTP calls and zero outbox overhead', async () => {
  resetDeviceEnvironment();
  let networkCalls = 0;
  const spyFetch = async () => {
    networkCalls++;
    throw new Error('Guest mode must never hit the network');
  };

  configureAuth({ apiBaseUrl: 'http://127.0.0.1:9999', fetchImpl: spyFetch });
  configureSync({ apiBaseUrl: 'http://127.0.0.1:9999', fetchImpl: spyFetch });

  const t1 = createTask({ id: 'guest-task-1', text: 'تسک مهمان' });
  assert.equal(t1.ok, true);
  assert.equal(getAuthState().isLoggedIn, false);
  assert.equal(isSyncEnabled(), false);
  assert.equal(getPendingCount(), 0);

  initSyncTriggers({ fetchImpl: spyFetch });
  const syncRes = await syncNow({ fetchImpl: spyFetch });
  assert.equal(syncRes.ok, true);
  assert.equal(syncRes.skipped, true);
  assert.equal(syncRes.reason, 'guest');
  assert.equal(networkCalls, 0);
  assert.equal(getActiveTasks().length, 1);
});

test('E2E Auth + Push + Logout: OTP login, taskRepo push empties outbox, logout preserves local data', async () => {
  const backend = await startBackend();
  try {
    const storage = resetDeviceEnvironment();
    configureAuth({ apiBaseUrl: backend.baseUrl, fetchImpl: fetch });
    configureSync({ apiBaseUrl: backend.baseUrl, fetchImpl: fetch });

    const req = await requestOtp('۰۹۱۲۷۷۷۸۸۹۹');
    assert.equal(req.ok, true);
    assert.equal(req.identifier, '+989127778899');
    const otp = backend.sentOtps[backend.sentOtps.length - 1].code;

    const ver = await verifyOtp('+989127778899', otp, 'Pixel-Test');
    assert.equal(ver.ok, true);
    assert.equal(getAuthState().isLoggedIn, true);
    assert.equal(isSyncEnabled(), true);

    const me = await fetchMe();
    assert.equal(me.ok, true);
    assert.equal(me.user.identifier, '+989127778899');

    // Create, update, and soft-delete via taskrepo.js
    const c1 = createTask({ id: 'sync-t1', text: 'تسک اول', p: 'high' });
    assert.equal(c1.ok, true);
    updateTask('sync-t1', { text: 'تسک اول ویرایش‌شده', done: true });

    const c2 = createTask({ id: 'sync-t2', text: 'تسک برای حذف' });
    assert.equal(c2.ok, true);
    softDeleteTask('sync-t2');

    assert.equal(getPendingCount(), 2);

    const syncRes = await syncNow({ ignoreOnlineCheck: true });
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.pushed, 2);
    assert.equal(getPendingCount(), 0);
    assert.ok(getSyncCursor() > 0);

    // Logout preserves local tasks and books while clearing auth & cursor
    await logout();
    assert.equal(getAuthState().isLoggedIn, false);
    assert.equal(isSyncEnabled(), false);
    assert.equal(storage.getItem(AUTH_STORAGE_KEY), null);
    assert.equal(storage.getItem(SYNC_CURSOR_KEY), null);
    assert.equal(state.tasks.length, 2);
    assert.equal(getActiveTasks().length, 1);
    assert.equal(getActiveTasks()[0].text, 'تسک اول ویرایش‌شده');
  } finally {
    await backend.close();
  }
});

test('E2E Two-Device Sync: Device A pushes task, tombstone & book progress -> Device B pulls with zero echo loop', async () => {
  const backend = await startBackend();
  try {
    configureAuth({ apiBaseUrl: backend.baseUrl, fetchImpl: fetch });
    configureSync({ apiBaseUrl: backend.baseUrl, fetchImpl: fetch });

    // ── Device A ──
    const deviceAStorage = resetDeviceEnvironment({
      'daftarche-books-meta': JSON.stringify([
        {
          id: 'book-42',
          title: 'هزارتوی تنهایی',
          numPages: 240,
          lastPage: 68,
          goal: { type: 'daily', pagesPerDay: 15 },
          updatedAt: 1710000010000,
          stats: {},
          highlights: [],
          notes: [],
          completedPages: [1, 2],
        },
      ]),
    });

    await requestOtp('two-device@daftarche.ir');
    const otpA = backend.sentOtps[backend.sentOtps.length - 1].code;
    await verifyOtp('two-device@daftarche.ir', otpA, 'Device-A');

    createTask({ id: 't-shared-1', text: 'مطالعه فصل ۳' });
    updateTask('t-shared-1', { done: true, text: 'مطالعه فصل ۳ (کامل)' });
    createTask({ id: 't-shared-del', text: 'موقت' });
    softDeleteTask('t-shared-del');

    const bookMeta = JSON.parse(deviceAStorage.getItem('daftarche-books-meta'))[0];
    appendChange(createSyncEnvelope({
      kind: 'book',
      entityId: bookMeta.id,
      action: 'upsert',
      rev: 1,
      payload: projectBookProgressForSync(bookMeta),
      ts: bookMeta.updatedAt,
    }));

    const pushA = await syncNow({ ignoreOnlineCheck: true });
    assert.equal(pushA.ok, true);
    assert.equal(pushA.pushed, 3);
    assert.equal(getPendingCount(), 0);
    flushPending();

    // ── Device B (separate localStorage, existing local book at page 10) ──
    const deviceBStorage = resetDeviceEnvironment({
      'daftarche-books-meta': JSON.stringify([
        {
          id: 'book-42',
          title: 'هزارتوی تنهایی',
          numPages: 240,
          lastPage: 10,
          goal: null,
          updatedAt: 1710000001000,
          stats: {},
          highlights: [{ id: 'h1', page: 5, text: 'نکته محلی' }],
          notes: [],
          completedPages: [1],
        },
      ]),
    });

    await requestOtp('two-device@daftarche.ir');
    const otpB = backend.sentOtps[backend.sentOtps.length - 1].code;
    await verifyOtp('two-device@daftarche.ir', otpB, 'Device-B');

    const pullB = await syncNow({ ignoreOnlineCheck: true });
    assert.equal(pullB.ok, true);
    assert.equal(pullB.pulled, 3);

    // Zero echo loop: Device B's outbox MUST remain empty after pulling remote changes
    assert.equal(getPendingCount(), 0);
    assert.equal(deviceBStorage.getItem(OUTBOX_STORAGE_KEY), null);

    // Verify merged tasks on Device B
    const activeB = getActiveTasks();
    assert.equal(activeB.length, 1);
    assert.equal(activeB[0].id, 't-shared-1');
    assert.equal(activeB[0].text, 'مطالعه فصل ۳ (کامل)');
    assert.equal(activeB[0].done, true);

    const tombstoneB = state.tasks.find(t => t.id === 't-shared-del');
    assert.ok(tombstoneB && tombstoneB.deletedAt > 0);

    // Verify merged book progress on Device B without losing local highlights
    const booksB = JSON.parse(deviceBStorage.getItem('daftarche-books-meta'));
    assert.equal(booksB[0].lastPage, 68);
    assert.equal(booksB[0].goal.pagesPerDay, 15);
    assert.equal(booksB[0].highlights.length, 1);

    // Device A edits open task (rev bumps) -> Device B pulls update
    globalThis.localStorage = deviceAStorage;
    state.tasks = JSON.parse(deviceAStorage.getItem('daftarche-v1'));
    updateTask('t-shared-1', { text: 'مطالعه فصل ۳ (نسخه ۳)', done: false });
    await syncNow({ ignoreOnlineCheck: true });
    flushPending();

    globalThis.localStorage = deviceBStorage;
    state.tasks = JSON.parse(deviceBStorage.getItem('daftarche-v1'));
    const pullB2 = await syncNow({ ignoreOnlineCheck: true });
    assert.equal(pullB2.ok, true);
    assert.equal(pullB2.pulled, 1);
    assert.equal(getActiveTasks()[0].text, 'مطالعه فصل ۳ (نسخه ۳)');
    assert.equal(getPendingCount(), 0);
  } finally {
    await backend.close();
  }
});

test('E2E 401 Recovery: revoked token disables sync gracefully while preserving local tasks', async () => {
  const backend = await startBackend();
  try {
    const storage = resetDeviceEnvironment();
    configureAuth({ apiBaseUrl: backend.baseUrl, fetchImpl: fetch });
    configureSync({ apiBaseUrl: backend.baseUrl, fetchImpl: fetch });

    await requestOtp('revoke@daftarche.ir');
    const otp = backend.sentOtps[backend.sentOtps.length - 1].code;
    await verifyOtp('revoke@daftarche.ir', otp, 'Device-X');

    createTask({ id: 'keep-me', text: 'این کار نباید پاک بشه' });
    flushPending();

    // Revoke all sessions on backend
    backend.db.exec('UPDATE sessions SET revoked_at = 1');

    const res = await syncNow({ ignoreOnlineCheck: true });
    assert.equal(res.ok, false);
    assert.equal(res.unauthorized, true);
    assert.equal(getAuthState().isLoggedIn, false);
    assert.equal(isSyncEnabled(), false);
    assert.equal(storage.getItem(AUTH_STORAGE_KEY), null);

    // Local tasks remain 100% intact
    assert.equal(getActiveTasks().length, 1);
    assert.equal(getActiveTasks()[0].text, 'این کار نباید پاک بشه');
  } finally {
    await backend.close();
  }
});

test('Backup safety: JSON backup excludes auth tokens, cursors, and outbox keys', () => {
  const storage = resetDeviceEnvironment({
    'daftarche-v1': JSON.stringify([{ id: 't1', text: 'محلی', done: false }]),
    [AUTH_STORAGE_KEY]: JSON.stringify({ token: 'secret-token', user: { id: 'u1', identifier: 'a@b.c' } }),
    [SYNC_CURSOR_KEY]: '1710000000000',
    [LAST_SYNC_AT_KEY]: '1710000005000',
    [OUTBOX_STORAGE_KEY]: '[{"opId":"1"}]',
    'daftarche_sync_enabled': 'true',
  });

  assert.equal(isBackupKey(AUTH_STORAGE_KEY), false);
  assert.equal(isBackupKey(SYNC_CURSOR_KEY), false);
  assert.equal(isBackupKey(LAST_SYNC_AT_KEY), false);
  assert.equal(isBackupKey(OUTBOX_STORAGE_KEY), false);
  assert.equal(isBackupKey('daftarche_sync_enabled'), false);

  const backup = collectBackup(storage, { release: '3.5.0' });
  assert.equal(backup.data['daftarche-v1'] !== undefined, true);
  assert.equal(AUTH_STORAGE_KEY in backup.data, false);
  assert.equal(SYNC_CURSOR_KEY in backup.data, false);
  assert.equal(LAST_SYNC_AT_KEY in backup.data, false);
  assert.equal(OUTBOX_STORAGE_KEY in backup.data, false);
  assert.equal('daftarche_sync_enabled' in backup.data, false);
});
