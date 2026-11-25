/* ═══ دفتَرچه — Selective Sync API (Push & Pull) ═══
   Implements the exact wire contract defined in Sprint 2.1:
     · POST /api/sync/push — idempotent batch ingest with revision guard
     · POST /api/sync/pull — monotonic server_cursor delta pagination
   Strictly scoped per authenticated user_id. */

const express = require('express');
const { runInTransaction } = require('./db');

const SYNC_KINDS = new Set(['task', 'book']);
const SYNC_ACTIONS = new Set(['upsert', 'delete']);
const MAX_PUSH_BATCH = 100;
const DEFAULT_PULL_LIMIT = 100;
const MAX_PULL_LIMIT = 200;

/**
 * Validates a single incoming sync change envelope against the wire contract.
 * @param {unknown} envelope
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSyncEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { valid: false, error: 'Envelope must be an object' };
  }

  if (typeof envelope.opId !== 'string' || !envelope.opId.trim() || envelope.opId.length > 128) {
    return { valid: false, error: 'Invalid or missing opId' };
  }

  if (!SYNC_KINDS.has(envelope.kind)) {
    return { valid: false, error: `Invalid kind: ${String(envelope.kind)}` };
  }

  if (typeof envelope.entityId !== 'string' || !envelope.entityId.trim() || envelope.entityId.length > 128) {
    return { valid: false, error: 'Invalid or missing entityId' };
  }

  if (!SYNC_ACTIONS.has(envelope.action)) {
    return { valid: false, error: `Invalid action: ${String(envelope.action)}` };
  }

  const rev = Number(envelope.rev);
  if (!Number.isInteger(rev) || rev < 1) {
    return { valid: false, error: 'rev must be an integer >= 1' };
  }

  const ts = Number(envelope.ts);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { valid: false, error: 'ts must be a positive timestamp' };
  }

  if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
    return { valid: false, error: 'payload must be an object' };
  }

  if (typeof envelope.payload.id !== 'string' || envelope.payload.id !== envelope.entityId) {
    return { valid: false, error: 'payload.id must equal entityId' };
  }

  return { valid: true };
}

/**
 * Creates the Express router for selective sync push/pull endpoints.
 * @param {Object} options
 * @param {import('node:sqlite').DatabaseSync} options.db
 * @param {import('express').RequestHandler} options.requireAuth
 * @param {(rule: string, key: string, res: import('express').Response) => boolean} options.checkRateLimit
 * @returns {import('express').Router}
 */
function createSyncRouter({ db, requireAuth, checkRateLimit }) {
  const router = express.Router();

  const getMaxCursor = db.prepare(`
    SELECT COALESCE(MAX(server_cursor), 0) AS max_cursor
    FROM sync_entities
    WHERE user_id = ?
  `);
  const hasSyncOp = db.prepare(`
    SELECT 1 AS found FROM sync_ops WHERE user_id = ? AND op_id = ?
  `);
  const insertSyncOp = db.prepare(`
    INSERT INTO sync_ops (user_id, op_id, processed_at) VALUES (?, ?, ?)
  `);
  const getExistingEntity = db.prepare(`
    SELECT rev, server_cursor FROM sync_entities
    WHERE user_id = ? AND kind = ? AND entity_id = ?
  `);
  const upsertSyncEntity = db.prepare(`
    INSERT INTO sync_entities (
      user_id, kind, entity_id, action, rev, server_cursor, payload_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, kind, entity_id) DO UPDATE SET
      action = excluded.action,
      rev = excluded.rev,
      server_cursor = excluded.server_cursor,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);

  const selectPullChanges = db.prepare(`
    SELECT kind, entity_id, action, rev, server_cursor, payload_json, updated_at
    FROM sync_entities
    WHERE user_id = ? AND server_cursor > ?
    ORDER BY server_cursor ASC
    LIMIT ?
  `);

  router.use(requireAuth);

  router.post('/push', (req, res) => {
    const userId = req.auth.userId;
    if (!checkRateLimit('sync-push', userId, res)) {
      return res.status(429).json({ ok: false, error: 'تعداد درخواست‌های همگام‌سازی بیش از حد مجاز است' });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.changes)) {
      return res.status(400).json({ ok: false, error: 'فیلد changes باید یک آرایه باشد' });
    }

    if (body.changes.length > MAX_PUSH_BATCH) {
      return res.status(400).json({ ok: false, error: `حداکثر ${MAX_PUSH_BATCH} تغییر در هر درخواست مجاز است` });
    }

    for (let i = 0; i < body.changes.length; i++) {
      const check = validateSyncEnvelope(body.changes[i]);
      if (!check.valid) {
        return res.status(400).json({
          ok: false,
          error: `پاکت تغییر نامعتبر در اندیس ${i}: ${check.error}`,
        });
      }
    }

    const result = runInTransaction(db, () => {
      const now = Date.now();
      const row = getMaxCursor.get(userId);
      let latestCursor = Number(row && row.max_cursor) || 0;
      const ackedOpIds = [];

      for (const env of body.changes) {
        const opId = env.opId.trim();
        const alreadyProcessed = hasSyncOp.get(userId, opId);
        if (alreadyProcessed) {
          ackedOpIds.push(opId);
          continue;
        }

        insertSyncOp.run(userId, opId, now);

        const entityId = env.entityId.trim();
        const rev = Number(env.rev);
        const ts = Number(env.ts);
        const existing = getExistingEntity.get(userId, env.kind, entityId);

        if (!existing || rev >= Number(existing.rev)) {
          latestCursor = Math.max(Date.now(), latestCursor + 1);
          upsertSyncEntity.run(
            userId,
            env.kind,
            entityId,
            env.action,
            rev,
            latestCursor,
            JSON.stringify(env.payload),
            ts
          );
        }

        ackedOpIds.push(opId);
      }

      return {
        ackedOpIds,
        serverCursor: latestCursor,
      };
    });

    return res.json({
      ok: true,
      ackedOpIds: result.ackedOpIds,
      serverCursor: result.serverCursor,
    });
  });

  router.post('/pull', (req, res) => {
    const userId = req.auth.userId;
    if (!checkRateLimit('sync-pull', userId, res)) {
      return res.status(429).json({ ok: false, error: 'تعداد درخواست‌های دریافت بیش از حد مجاز است' });
    }

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const rawSince = body.sinceCursor === undefined ? 0 : Number(body.sinceCursor);
    if (!Number.isInteger(rawSince) || rawSince < 0) {
      return res.status(400).json({ ok: false, error: 'sinceCursor باید یک عدد صحیح نامنفی باشد' });
    }

    const rawLimit = body.limit === undefined ? DEFAULT_PULL_LIMIT : Number(body.limit);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(MAX_PULL_LIMIT, Math.max(1, Math.floor(rawLimit)))
      : DEFAULT_PULL_LIMIT;

    const rows = selectPullChanges.all(userId, rawSince, limit + 1);
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;

    const changes = slice.map(r => ({
      kind: r.kind,
      entityId: r.entity_id,
      action: r.action,
      rev: Number(r.rev),
      ts: Number(r.updated_at),
      payload: JSON.parse(r.payload_json),
    }));

    const nextCursor = slice.length > 0
      ? Number(slice[slice.length - 1].server_cursor)
      : rawSince;

    return res.json({
      ok: true,
      changes,
      nextCursor,
      hasMore,
    });
  });

  return router;
}

module.exports = {
  MAX_PUSH_BATCH,
  DEFAULT_PULL_LIMIT,
  MAX_PULL_LIMIT,
  validateSyncEnvelope,
  createSyncRouter,
};
