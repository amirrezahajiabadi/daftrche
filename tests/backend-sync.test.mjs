/* ═══ Backend Express + SQLite Auth & Sync Integration Tests ═══
   Tests server/db.js, server/auth.js, server/sync.js, and server/api-server.js
   against an isolated in-memory SQLite DB (:memory:) plus a WAL file smoke test. */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import {
  projectTaskForSync,
  projectBookProgressForSync,
  createSyncEnvelope,
} from '../js/sync-projection.js';

const require = createRequire(import.meta.url);
const { openDatabase } = require('../server/db.js');
const { normalizeIdentifier } = require('../server/auth.js');
const { createApp } = require('../server/api-server.js');

function startTestServer(options = {}) {
  const sentOtps = [];
  const db = options.db || openDatabase(':memory:');
  const app = createApp({
    db,
    nodeEnv: options.nodeEnv || 'test',
    allowedOrigin: options.allowedOrigin,
    otpTtlMs: options.otpTtlMs,
    rateRules: options.rateRules,
    enableRequestLog: false,
    sendOtp: options.sendOtp || (async (identifier, code) => {
      sentOtps.push({ identifier, code });
      return { ok: true, provider: 'test-spy' };
    }),
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        db,
        app,
        server,
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

async function apiJson(baseUrl, route, { method = 'POST', body, token, headers = {} } = {}) {
  const reqHeaders = { ...headers };
  if (body !== undefined) reqHeaders['Content-Type'] = 'application/json';
  if (token) reqHeaders.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: reqHeaders,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, headers: res.headers, json, text };
}

async function authenticateUser(ctx, identifier, deviceName = 'test-device') {
  const reqRes = await apiJson(ctx.baseUrl, '/api/auth/request-otp', {
    body: { identifier },
  });
  assert.equal(reqRes.status, 200);
  const last = ctx.sentOtps[ctx.sentOtps.length - 1];
  assert.ok(last);

  const verRes = await apiJson(ctx.baseUrl, '/api/auth/verify-otp', {
    body: { identifier, code: last.code, deviceName },
  });
  assert.equal(verRes.status, 200);
  return verRes.json;
}

test('SQLite DB: file-backed DB enables WAL mode and initializes schema', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daftarche-db-'));
  const dbFile = path.join(tmpDir, 'test.sqlite');
  const db = openDatabase(dbFile);
  try {
    const modeRow = db.prepare('PRAGMA journal_mode;').get();
    assert.equal(modeRow.journal_mode.toLowerCase(), 'wal');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map(r => r.name);
    for (const expected of ['users', 'otp_codes', 'sessions', 'sync_entities', 'sync_ops']) {
      assert.ok(tables.includes(expected), `Missing table ${expected}`);
    }
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Auth: identifier normalization handles email, Iranian mobile formats, and rejects garbage', () => {
  assert.equal(normalizeIdentifier('  User@Example.COM '), 'user@example.com');
  assert.equal(normalizeIdentifier('09123456789'), '+989123456789');
  assert.equal(normalizeIdentifier('۰۹۱۲-۳۴۵-۶۷۸۹'), '+989123456789');
  assert.equal(normalizeIdentifier('9123456789'), '+989123456789');
  assert.equal(normalizeIdentifier('00989123456789'), '+989123456789');
  assert.equal(normalizeIdentifier('+989123456789'), '+989123456789');

  assert.equal(normalizeIdentifier(''), null);
  assert.equal(normalizeIdentifier('not-an-email'), null);
  assert.equal(normalizeIdentifier('02188776655'), null);
  assert.equal(normalizeIdentifier(12345), null);
});

test('Auth flow: request OTP -> reject wrong OTP -> verify valid OTP -> /me -> /logout -> reject revoked', async () => {
  const ctx = await startTestServer();
  try {
    const health = await apiJson(ctx.baseUrl, '/api/health', { method: 'GET' });
    assert.equal(health.status, 200);
    assert.equal(health.json.ok, true);

    // 1. Request OTP
    const reqOtp = await apiJson(ctx.baseUrl, '/api/auth/request-otp', {
      body: { identifier: '۰۹۱۲۱۱۱۲۲۳۳' },
    });
    assert.equal(reqOtp.status, 200);
    assert.equal(reqOtp.json.ok, true);
    assert.equal(reqOtp.json.identifier, '+989121112233');
    assert.equal(ctx.sentOtps.length, 1);
    const otpCode = ctx.sentOtps[0].code;
    assert.match(otpCode, /^\d{6}$/);

    // Verify OTP is stored salted+hashed, NEVER plaintext
    const otpRow = ctx.db.prepare('SELECT code_hash FROM otp_codes WHERE identifier = ?').get('+989121112233');
    assert.ok(otpRow);
    assert.equal(otpRow.code_hash.includes(otpCode), false);
    assert.match(otpRow.code_hash, /^[0-9a-f]{32}:[0-9a-f]{64}$/);

    // 2. Reject wrong OTP
    const wrongCode = otpCode === '000000' ? '111111' : '000000';
    const badVerify = await apiJson(ctx.baseUrl, '/api/auth/verify-otp', {
      body: { identifier: '+989121112233', code: wrongCode },
    });
    assert.equal(badVerify.status, 401);

    // 3. Verify valid OTP (supports Persian digits too)
    const goodVerify = await apiJson(ctx.baseUrl, '/api/auth/verify-otp', {
      body: { identifier: '+989121112233', code: otpCode, deviceName: 'Pixel-8' },
    });
    assert.equal(goodVerify.status, 200);
    assert.equal(goodVerify.json.ok, true);
    assert.ok(typeof goodVerify.json.token === 'string' && goodVerify.json.token.length >= 32);
    assert.equal(goodVerify.json.user.identifier, '+989121112233');
    const token = goodVerify.json.token;

    // Session token stored hashed, not plaintext
    const expectedHash = crypto.createHash('sha256').update(token).digest('hex');
    const sessRow = ctx.db.prepare('SELECT token_hash, device_name FROM sessions WHERE token_hash = ?').get(expectedHash);
    assert.ok(sessRow);
    assert.equal(sessRow.device_name, 'Pixel-8');

    // 4. GET /api/auth/me succeeds
    const me = await apiJson(ctx.baseUrl, '/api/auth/me', { method: 'GET', token });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.id, goodVerify.json.user.id);
    assert.equal(me.json.user.identifier, '+989121112233');

    // Unauthenticated /me fails
    const noAuth = await apiJson(ctx.baseUrl, '/api/auth/me', { method: 'GET' });
    assert.equal(noAuth.status, 401);

    // 5. POST /api/auth/logout revokes session
    const logout = await apiJson(ctx.baseUrl, '/api/auth/logout', { method: 'POST', token });
    assert.equal(logout.status, 200);
    assert.equal(logout.json.ok, true);

    // 6. Revoked token is rejected
    const afterLogout = await apiJson(ctx.baseUrl, '/api/auth/me', { method: 'GET', token });
    assert.equal(afterLogout.status, 401);
  } finally {
    await ctx.close();
  }
});

test('Auth security: enforces max 5 OTP attempts, expiry, and rate limits', async () => {
  const ctx = await startTestServer({
    rateRules: {
      'auth-request-otp-id': { windowMs: 60_000, max: 2 },
    },
  });
  try {
    await apiJson(ctx.baseUrl, '/api/auth/request-otp', {
      body: { identifier: 'dev@daftarche.ir' },
    });
    const validCode = ctx.sentOtps[0].code;
    const wrongCode = validCode === '999999' ? '888888' : '999999';

    // 5 wrong attempts
    for (let i = 0; i < 5; i++) {
      const r = await apiJson(ctx.baseUrl, '/api/auth/verify-otp', {
        body: { identifier: 'dev@daftarche.ir', code: wrongCode },
      });
      assert.equal(r.status, 401);
    }

    // 6th attempt even with VALID code is rejected
    const locked = await apiJson(ctx.baseUrl, '/api/auth/verify-otp', {
      body: { identifier: 'dev@daftarche.ir', code: validCode },
    });
    assert.equal(locked.status, 429);

    // Second request-otp succeeds (count=2), third hits per-identifier rate limit (429)
    const r2 = await apiJson(ctx.baseUrl, '/api/auth/request-otp', {
      body: { identifier: 'dev@daftarche.ir' },
    });
    assert.equal(r2.status, 200);

    const r3 = await apiJson(ctx.baseUrl, '/api/auth/request-otp', {
      body: { identifier: 'dev@daftarche.ir' },
    });
    assert.equal(r3.status, 429);
  } finally {
    await ctx.close();
  }
});

test('Auth security: expired OTP is rejected', async () => {
  const ctx = await startTestServer({ otpTtlMs: 1 });
  try {
    await apiJson(ctx.baseUrl, '/api/auth/request-otp', {
      body: { identifier: 'expire@daftarche.ir' },
    });
    const code = ctx.sentOtps[0].code;
    await new Promise(r => setTimeout(r, 15));

    const res = await apiJson(ctx.baseUrl, '/api/auth/verify-otp', {
      body: { identifier: 'expire@daftarche.ir', code },
    });
    assert.equal(res.status, 401);
  } finally {
    await ctx.close();
  }
});

test('Sync Push: task & book envelopes succeed, enforce idempotency and revision guard', async () => {
  const ctx = await startTestServer();
  try {
    const auth = await authenticateUser(ctx, 'syncer@daftarche.ir');
    const token = auth.token;

    const taskPayload = projectTaskForSync({
      id: 'task-1',
      text: 'خرید نان و شیر',
      done: false,
      p: 'high',
      cat: 'home',
      notifiedStatus: 'due',
      version: 2,
    });
    const bookPayload = projectBookProgressForSync({
      id: 'book-1',
      title: 'بوف کور',
      currentPage: 45,
      totalPages: 140,
      dailyGoal: 10,
      pdfBlob: new Uint8Array([1, 2, 3]),
    });

    const env1 = createSyncEnvelope({
      kind: 'task',
      entityId: 'task-1',
      action: 'upsert',
      rev: 2,
      payload: taskPayload,
      opId: 'op-task-1-r2',
      ts: 1710000001000,
    });
    const env2 = createSyncEnvelope({
      kind: 'book',
      entityId: 'book-1',
      action: 'upsert',
      rev: 1,
      payload: bookPayload,
      opId: 'op-book-1-r1',
      ts: 1710000002000,
    });

    const push1 = await apiJson(ctx.baseUrl, '/api/sync/push', {
      token,
      body: { changes: [env1, env2] },
    });
    assert.equal(push1.status, 200);
    assert.equal(push1.json.ok, true);
    assert.deepEqual(push1.json.ackedOpIds, ['op-task-1-r2', 'op-book-1-r1']);
    assert.ok(Number.isInteger(push1.json.serverCursor) && push1.json.serverCursor > 0);

    // Idempotency: re-sending exact same opIds returns ackedOpIds and does not advance serverCursor
    const pushReplay = await apiJson(ctx.baseUrl, '/api/sync/push', {
      token,
      body: { changes: [env1, env2] },
    });
    assert.equal(pushReplay.status, 200);
    assert.deepEqual(pushReplay.json.ackedOpIds, ['op-task-1-r2', 'op-book-1-r1']);
    assert.equal(pushReplay.json.serverCursor, push1.json.serverCursor);

    // Revision guard: pushing stale rev=1 with new opId acks opId but preserves rev=2
    const staleEnv = createSyncEnvelope({
      kind: 'task',
      entityId: 'task-1',
      action: 'upsert',
      rev: 1,
      payload: { ...taskPayload, text: 'عنوان قدیمی' },
      opId: 'op-task-1-stale',
      ts: 1710000000500,
    });
    const pushStale = await apiJson(ctx.baseUrl, '/api/sync/push', {
      token,
      body: { changes: [staleEnv] },
    });
    assert.equal(pushStale.status, 200);
    assert.deepEqual(pushStale.json.ackedOpIds, ['op-task-1-stale']);

    const pull = await apiJson(ctx.baseUrl, '/api/sync/pull', {
      token,
      body: { sinceCursor: 0, limit: 10 },
    });
    assert.equal(pull.status, 200);
    assert.equal(pull.json.changes.length, 2);
    assert.equal(pull.json.changes[0].payload.text, 'خرید نان و شیر');
    assert.equal(pull.json.changes[0].rev, 2);
    assert.equal('notifiedStatus' in pull.json.changes[0].payload, false);
    assert.equal('pdfBlob' in pull.json.changes[1].payload, false);
  } finally {
    await ctx.close();
  }
});

test('Sync Push Validation: rejects missing auth, malformed envelopes, batch > 100, and oversized payload', async () => {
  const ctx = await startTestServer();
  try {
    const noAuth = await apiJson(ctx.baseUrl, '/api/sync/push', {
      body: { changes: [] },
    });
    assert.equal(noAuth.status, 401);

    const auth = await authenticateUser(ctx, 'validator@daftarche.ir');
    const token = auth.token;

    const badBody = await apiJson(ctx.baseUrl, '/api/sync/push', {
      token,
      body: { changes: 'not-an-array' },
    });
    assert.equal(badBody.status, 400);

    const malformedCases = [
      { opId: '', kind: 'task', entityId: 't1', action: 'upsert', rev: 1, ts: 1000, payload: { id: 't1' } },
      { opId: 'op1', kind: 'note', entityId: 't1', action: 'upsert', rev: 1, ts: 1000, payload: { id: 't1' } },
      { opId: 'op2', kind: 'task', entityId: 't1', action: 'patch', rev: 1, ts: 1000, payload: { id: 't1' } },
      { opId: 'op3', kind: 'task', entityId: 't1', action: 'upsert', rev: 0, ts: 1000, payload: { id: 't1' } },
      { opId: 'op4', kind: 'task', entityId: 't1', action: 'upsert', rev: 1, ts: 1000, payload: { id: 'other' } },
      { opId: 'op5', kind: 'task', entityId: 't1', action: 'upsert', rev: 1, ts: 1000, payload: {} },
    ];
    for (const env of malformedCases) {
      const r = await apiJson(ctx.baseUrl, '/api/sync/push', {
        token,
        body: { changes: [env] },
      });
      assert.equal(r.status, 400);
    }

    // Batch cap (> 100)
    const tooMany = Array.from({ length: 101 }, (_, i) =>
      createSyncEnvelope({
        kind: 'task',
        entityId: `t-${i}`,
        action: 'upsert',
        rev: 1,
        payload: { id: `t-${i}`, text: 'x' },
        opId: `op-many-${i}`,
      })
    );
    const batchOver = await apiJson(ctx.baseUrl, '/api/sync/push', {
      token,
      body: { changes: tooMany },
    });
    assert.equal(batchOver.status, 400);

    // Body size limit (> 256kb)
    const huge = JSON.stringify({
      changes: [
        createSyncEnvelope({
          kind: 'task',
          entityId: 't-big',
          action: 'upsert',
          rev: 1,
          payload: { id: 't-big', text: 'آ'.repeat(200_000) },
          opId: 'op-big',
        }),
      ],
    });
    const overLimit = await apiJson(ctx.baseUrl, '/api/sync/push', {
      token,
      body: huge,
    });
    assert.equal(overLimit.status, 413);
  } finally {
    await ctx.close();
  }
});

test('Sync Pull: pagination (sinceCursor, hasMore, nextCursor) & strict User A / User B isolation', async () => {
  const ctx = await startTestServer();
  try {
    const userA = await authenticateUser(ctx, '+989120000001');
    const userB = await authenticateUser(ctx, '+989120000002');

    // User A pushes 5 tasks
    const changesA = Array.from({ length: 5 }, (_, i) =>
      createSyncEnvelope({
        kind: 'task',
        entityId: `a-task-${i + 1}`,
        action: 'upsert',
        rev: 1,
        payload: projectTaskForSync({ id: `a-task-${i + 1}`, text: `کار ${i + 1}` }),
        opId: `op-a-${i + 1}`,
        ts: 1710000000000 + i * 1000,
      })
    );
    const pushA = await apiJson(ctx.baseUrl, '/api/sync/push', {
      token: userA.token,
      body: { changes: changesA },
    });
    assert.equal(pushA.status, 200);

    // User B pushes 1 task
    const pushB = await apiJson(ctx.baseUrl, '/api/sync/push', {
      token: userB.token,
      body: {
        changes: [
          createSyncEnvelope({
            kind: 'task',
            entityId: 'b-task-1',
            action: 'upsert',
            rev: 1,
            payload: projectTaskForSync({ id: 'b-task-1', text: 'محرمانه کاربر ب' }),
            opId: 'op-b-1',
          }),
        ],
      },
    });
    assert.equal(pushB.status, 200);

    // User A paginates with limit: 2 -> pages of 2, 2, 1
    const p1 = await apiJson(ctx.baseUrl, '/api/sync/pull', {
      token: userA.token,
      body: { sinceCursor: 0, limit: 2 },
    });
    assert.equal(p1.status, 200);
    assert.equal(p1.json.changes.length, 2);
    assert.equal(p1.json.hasMore, true);

    const p2 = await apiJson(ctx.baseUrl, '/api/sync/pull', {
      token: userA.token,
      body: { sinceCursor: p1.json.nextCursor, limit: 2 },
    });
    assert.equal(p2.status, 200);
    assert.equal(p2.json.changes.length, 2);
    assert.equal(p2.json.hasMore, true);

    const p3 = await apiJson(ctx.baseUrl, '/api/sync/pull', {
      token: userA.token,
      body: { sinceCursor: p2.json.nextCursor, limit: 2 },
    });
    assert.equal(p3.status, 200);
    assert.equal(p3.json.changes.length, 1);
    assert.equal(p3.json.hasMore, false);

    const collectedIds = [...p1.json.changes, ...p2.json.changes, ...p3.json.changes].map(c => c.entityId);
    assert.deepEqual(collectedIds, ['a-task-1', 'a-task-2', 'a-task-3', 'a-task-4', 'a-task-5']);

    // Caught up pull returns empty
    const p4 = await apiJson(ctx.baseUrl, '/api/sync/pull', {
      token: userA.token,
      body: { sinceCursor: p3.json.nextCursor, limit: 2 },
    });
    assert.equal(p4.status, 200);
    assert.deepEqual(p4.json.changes, []);
    assert.equal(p4.json.hasMore, false);
    assert.equal(p4.json.nextCursor, p3.json.nextCursor);

    // User B pull only returns User B's task
    const pullB = await apiJson(ctx.baseUrl, '/api/sync/pull', {
      token: userB.token,
      body: { sinceCursor: 0, limit: 50 },
    });
    assert.equal(pullB.status, 200);
    assert.equal(pullB.json.changes.length, 1);
    assert.equal(pullB.json.changes[0].entityId, 'b-task-1');
  } finally {
    await ctx.close();
  }
});

test('Sync Tombstone round-trip: delete action overwrites upsert and is returned on pull', async () => {
  const ctx = await startTestServer();
  try {
    const auth = await authenticateUser(ctx, 'tomb@daftarche.ir');

    const upsertEnv = createSyncEnvelope({
      kind: 'task',
      entityId: 't-del-1',
      action: 'upsert',
      rev: 1,
      payload: projectTaskForSync({ id: 't-del-1', text: 'تسک موقت', version: 1 }),
      opId: 'op-tomb-1',
      ts: 1710000001000,
    });
    const p1 = await apiJson(ctx.baseUrl, '/api/sync/push', {
      token: auth.token,
      body: { changes: [upsertEnv] },
    });
    assert.equal(p1.status, 200);

    const deletedAt = 1710000009000;
    const deleteEnv = createSyncEnvelope({
      kind: 'task',
      entityId: 't-del-1',
      action: 'delete',
      rev: 2,
      payload: projectTaskForSync({ id: 't-del-1', text: 'تسک موقت', version: 2, deletedAt }),
      opId: 'op-tomb-2',
      ts: deletedAt,
    });
    const p2 = await apiJson(ctx.baseUrl, '/api/sync/push', {
      token: auth.token,
      body: { changes: [deleteEnv] },
    });
    assert.equal(p2.status, 200);

    const pull = await apiJson(ctx.baseUrl, '/api/sync/pull', {
      token: auth.token,
      body: { sinceCursor: p1.json.serverCursor, limit: 10 },
    });
    assert.equal(pull.status, 200);
    assert.equal(pull.json.changes.length, 1);
    assert.equal(pull.json.changes[0].entityId, 't-del-1');
    assert.equal(pull.json.changes[0].action, 'delete');
    assert.equal(pull.json.changes[0].rev, 2);
    assert.equal(pull.json.changes[0].payload.deletedAt, deletedAt);
  } finally {
    await ctx.close();
  }
});

test('Server Hardening: production CORS requires explicit origin and rejects unknown origins', async () => {
  assert.throws(() => createApp({ nodeEnv: 'production' }), /ALLOWED_ORIGIN/);

  const ctx = await startTestServer({
    nodeEnv: 'production',
    allowedOrigin: 'https://daftarche.app',
  });
  try {
    const rejected = await apiJson(ctx.baseUrl, '/api/health', {
      method: 'GET',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(rejected.status, 403);

    const allowed = await apiJson(ctx.baseUrl, '/api/health', {
      method: 'GET',
      headers: { Origin: 'https://daftarche.app' },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://daftarche.app');
    assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(allowed.headers.get('cache-control'), 'no-store');
  } finally {
    await ctx.close();
  }
});
