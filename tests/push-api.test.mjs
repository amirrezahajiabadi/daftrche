/* ═══ Web Push API & Post-Sync Tombstone GC Tests ═══
   Covers Sprint 2.4 deliverables:
     · Unified /api/push/* routes on server/api-server.js (VAPID key, subscribe, unsubscribe)
     · Graceful degradation and Bearer auth attachment in js/push-service.js
     · Post-sync tombstone GC in js/sync-client.js (30-day cutoff, 24h throttle, backup exclusion) */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import { state } from '../js/state.js';
import { resetPending } from '../js/store.js';
import { setSyncEnabled, clearOutbox } from '../js/outbox.js';
import { isBackupKey, collectBackup } from '../js/backup.js';
import { configureAuth, requestOtp, verifyOtp } from '../js/auth-client.js';
import { configureSync, syncNow, LAST_GC_AT_KEY } from '../js/sync-client.js';
import {
  WEB_PUSH_ENABLED,
  pushSupported,
  enablePush,
  disablePush,
  syncExistingSubscription,
} from '../js/push-service.js';

const require = createRequire(import.meta.url);
const { openDatabase } = require('../server/db.js');
const { createApp } = require('../server/api-server.js');

class FakeStorage {
  constructor(init = {}) { this.map = new Map(Object.entries(init)); }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

function resetDevice(init = {}) {
  resetPending();
  const storage = new FakeStorage(init);
  globalThis.localStorage = storage;
  clearOutbox();
  setSyncEnabled(false);
  state.tasks = [];
  return storage;
}

function startApiServer(opts = {}) {
  const sentOtps = [];
  const db = openDatabase(':memory:');
  const app = createApp({
    db,
    nodeEnv: 'test',
    enableRequestLog: false,
    vapidPublicKey: opts.vapidPublicKey,
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
      resolve({
        db,
        sentOtps,
        baseUrl: `http://127.0.0.1:${port}`,
        async close() {
          await new Promise(res => server.close(res));
          try { db.close(); } catch (_) {}
        },
      });
    });
  });
}

test('Push API: GET /api/push/vapid-public-key returns enabled=false when unset and enabled=true when configured', async () => {
  const unsetCtx = await startApiServer({ vapidPublicKey: '' });
  try {
    const r1 = await fetch(`${unsetCtx.baseUrl}/api/push/vapid-public-key`);
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.deepEqual(j1, { ok: true, enabled: false, publicKey: null });
  } finally {
    await unsetCtx.close();
  }

  const testPubKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
  const setCtx = await startApiServer({ vapidPublicKey: testPubKey });
  try {
    const r2 = await fetch(`${setCtx.baseUrl}/api/push/vapid-public-key`);
    assert.equal(r2.status, 200);
    const j2 = await r2.json();
    assert.deepEqual(j2, { ok: true, enabled: true, publicKey: testPubKey });
  } finally {
    await setCtx.close();
  }
});

test('Push API: subscribe & unsubscribe store hashed endpoints and associate optional user_id', async () => {
  const ctx = await startApiServer({ vapidPublicKey: 'TestVapidKey1234567890' });
  try {
    const subPayload = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/sample-device-endpoint-xyz',
      keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8REfWRI',
        auth: 'tBHItJI5svbpez7KI4CCXg',
      },
    };
    const expectedHash = crypto.createHash('sha256').update(subPayload.endpoint).digest('hex');

    // Invalid subscription rejected
    const badSub = await fetch(`${ctx.baseUrl}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'http://insecure.example/sub' }),
    });
    assert.equal(badSub.status, 400);

    // 1. Guest subscribe (no Authorization header)
    const guestSub = await fetch(`${ctx.baseUrl}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subPayload),
    });
    assert.equal(guestSub.status, 200);

    const guestRow = ctx.db.prepare('SELECT endpoint_hash, user_id FROM push_subscriptions WHERE endpoint_hash = ?').get(expectedHash);
    assert.ok(guestRow);
    assert.equal(guestRow.user_id, null);

    // 2. Authenticated subscribe upgrades association to user_id
    resetDevice();
    configureAuth({ apiBaseUrl: ctx.baseUrl, fetchImpl: fetch });
    await requestOtp('pushuser@daftarche.ir');
    const otp = ctx.sentOtps[ctx.sentOtps.length - 1].code;
    const authRes = await verifyOtp('pushuser@daftarche.ir', otp, 'Web-Push');
    assert.equal(authRes.ok, true);

    const authSub = await fetch(`${ctx.baseUrl}/api/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authRes.token}`,
      },
      body: JSON.stringify(subPayload),
    });
    assert.equal(authSub.status, 200);

    const authRow = ctx.db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint_hash = ?').get(expectedHash);
    assert.equal(authRow.user_id, authRes.user.id);

    // 3. Unsubscribe deletes row by hashed endpoint
    const unsub = await fetch(`${ctx.baseUrl}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subPayload.endpoint }),
    });
    assert.equal(unsub.status, 200);

    const gone = ctx.db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint_hash = ?').get(expectedHash);
    assert.equal(gone, undefined);
  } finally {
    await ctx.close();
  }
});

test('Client Push Service: WEB_PUSH_ENABLED is true and degrades gracefully when unsupported', async () => {
  assert.equal(WEB_PUSH_ENABLED, true);
  assert.equal(pushSupported(), false);
  assert.equal(await enablePush(), null);
  assert.equal(await disablePush(), undefined);
  assert.equal(await syncExistingSubscription(), undefined);
});

test('Post-Sync Tombstone GC: purges >30d tombstones once per 24h after successful syncNow and excludes GC key from backup', async () => {
  const ctx = await startApiServer();
  try {
    const storage = resetDevice();
    configureAuth({ apiBaseUrl: ctx.baseUrl, fetchImpl: fetch });
    configureSync({ apiBaseUrl: ctx.baseUrl, fetchImpl: fetch });

    await requestOtp('gc-user@daftarche.ir');
    const otp = ctx.sentOtps[ctx.sentOtps.length - 1].code;
    await verifyOtp('gc-user@daftarche.ir', otp, 'Device-GC');

    const now = Date.now();
    const thirtyOneDaysMs = 31 * 24 * 60 * 60 * 1000;
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

    state.tasks = [
      { id: 't-active', text: 'کار فعال', done: false, updatedAt: now, version: 1, deletedAt: null },
      { id: 't-recent-del', text: 'حذف جدید', done: false, updatedAt: now - fiveDaysMs, version: 2, deletedAt: now - fiveDaysMs },
      { id: 't-old-del', text: 'حذف قدیمی', done: false, updatedAt: now - thirtyOneDaysMs, version: 2, deletedAt: now - thirtyOneDaysMs },
    ];

    // 1. First sync runs GC -> purges only t-old-del
    const res1 = await syncNow({ ignoreOnlineCheck: true, now });
    assert.equal(res1.ok, true);
    assert.equal(res1.gcPurged, 1);
    assert.deepEqual(state.tasks.map(t => t.id), ['t-active', 't-recent-del']);
    assert.equal(storage.getItem(LAST_GC_AT_KEY), String(now));

    // Backup excludes LAST_GC_AT_KEY
    assert.equal(isBackupKey(LAST_GC_AT_KEY), false);
    const backup = collectBackup(storage);
    assert.equal(LAST_GC_AT_KEY in backup.data, false);

    // 2. Inject another >30d tombstone and sync 1 hour later -> throttled (gcPurged === 0)
    state.tasks.push({
      id: 't-old-del-2',
      text: 'حذف قدیمی ۲',
      done: false,
      updatedAt: now - thirtyOneDaysMs,
      version: 2,
      deletedAt: now - thirtyOneDaysMs,
    });
    const res2 = await syncNow({ ignoreOnlineCheck: true, now: now + (60 * 60 * 1000) });
    assert.equal(res2.ok, true);
    assert.equal(res2.gcPurged, 0);
    assert.equal(state.tasks.some(t => t.id === 't-old-del-2'), true);

    // 3. Sync 25 hours later -> GC runs again and purges t-old-del-2
    const res3 = await syncNow({ ignoreOnlineCheck: true, now: now + (25 * 60 * 60 * 1000) });
    assert.equal(res3.ok, true);
    assert.equal(res3.gcPurged, 1);
    assert.equal(state.tasks.some(t => t.id === 't-old-del-2'), false);
  } finally {
    await ctx.close();
  }
});
