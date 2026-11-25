/* ═══ دفتَرچه — Express + SQLite Sync & Auth API Server ═══
   Self-hosted, zero-vendor-lock-in backend for guest-first OTP auth and
   selective cloud sync (tasks + book reading progress).

   Environment variables (production):
     PORT             default 3200
     NODE_ENV         'production' | 'development' | 'test'
     DB_PATH          default ./daftarche.sqlite
     ALLOWED_ORIGIN   required in production (e.g. https://app.example)
     ENABLE_REQUEST_LOG  default 'true' unless NODE_ENV=test */

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { openDatabase } = require('./db');
const { createRequireAuth, resolveOptionalUserId, createAuthRouter } = require('./auth');
const { createSyncRouter } = require('./sync');

const DEFAULT_RATE_RULES = {
  'auth-request-otp-ip': { windowMs: 60_000, max: 15 },
  'auth-request-otp-id': { windowMs: 60_000, max: 5 },
  'auth-verify-otp-ip':  { windowMs: 60_000, max: 30 },
  'sync-push':           { windowMs: 60_000, max: 60 },
  'sync-pull':           { windowMs: 60_000, max: 60 },
  'push-subscribe':      { windowMs: 60_000, max: 30 },
  'push-unsubscribe':    { windowMs: 60_000, max: 30 },
};

const ENDPOINT_MAX = 2048;

function isHttpsUrl(s) {
  if (typeof s !== 'string' || s.length > ENDPOINT_MAX) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && Boolean(u.host);
  } catch {
    return false;
  }
}

function isBase64Token(s, min, max) {
  return typeof s === 'string' && s.length >= min && s.length <= max && /^[A-Za-z0-9\-_=+/]+$/.test(s);
}

function validPushSubscription(sub) {
  return Boolean(sub) && typeof sub === 'object' && !Array.isArray(sub)
    && isHttpsUrl(sub.endpoint)
    && Boolean(sub.keys) && typeof sub.keys === 'object' && !Array.isArray(sub.keys)
    && isBase64Token(sub.keys.p256dh, 40, 256)
    && isBase64Token(sub.keys.auth, 8, 64);
}

function hashEndpoint(endpoint) {
  return crypto.createHash('sha256').update(endpoint).digest('hex');
}

/**
 * Creates a fixed-window in-memory rate limiter scoped to an app instance.
 * @param {Record<string, { windowMs: number, max: number }>} [customRules]
 */
function createRateLimiter(customRules = {}) {
  const rules = { ...DEFAULT_RATE_RULES, ...customRules };
  const buckets = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }, 120_000);
  if (typeof cleanup.unref === 'function') cleanup.unref();

  return function checkRateLimit(rule, key, res) {
    const cfg = rules[rule];
    if (!cfg) return true;
    const now = Date.now();
    const bucketKey = `${rule}|${key}`;
    let b = buckets.get(bucketKey);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + cfg.windowMs };
      buckets.set(bucketKey, b);
    }
    b.count += 1;
    res.setHeader('X-RateLimit-Limit', cfg.max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, cfg.max - b.count));
    if (b.count > cfg.max) {
      res.setHeader('Retry-After', Math.ceil((b.resetAt - now) / 1000));
      return false;
    }
    return true;
  };
}

/**
 * Express app factory for clean testing and standalone deployment.
 * @param {Object} [options]
 * @param {import('node:sqlite').DatabaseSync} [options.db]
 * @param {(identifier: string, code: string) => Promise<any>} [options.sendOtp]
 * @param {string} [options.allowedOrigin]
 * @param {string} [options.nodeEnv]
 * @param {number} [options.otpTtlMs]
 * @param {number} [options.sessionTtlMs]
 * @param {Record<string, { windowMs: number, max: number }>} [options.rateRules]
 * @param {boolean} [options.enableRequestLog]
 * @returns {import('express').Express}
 */
function createApp(options = {}) {
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';
  const allowedOrigin = options.allowedOrigin !== undefined
    ? options.allowedOrigin
    : (process.env.ALLOWED_ORIGIN || (nodeEnv === 'production' ? null : '*'));

  if (nodeEnv === 'production' && !allowedOrigin) {
    throw new Error('ALLOWED_ORIGIN must be explicitly set in production');
  }

  const db = options.db || openDatabase(':memory:');
  const checkRateLimit = createRateLimiter(options.rateRules);
  const requireAuth = createRequireAuth(db);
  const enableRequestLog = options.enableRequestLog !== undefined
    ? Boolean(options.enableRequestLog)
    : (process.env.ENABLE_REQUEST_LOG ? process.env.ENABLE_REQUEST_LOG !== 'false' : nodeEnv !== 'test');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  /* Security headers on every response */
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  /* CORS enforcement */
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigin === '*') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (!origin) {
      // Same-origin or non-browser client
    } else if (origin === allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
    } else {
      return res.status(403).json({ ok: false, error: 'مبدأ درخواست مجاز نیست' });
    }

    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Build');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  /* Strict JSON payload cap */
  app.use(express.json({ limit: '256kb' }));

  /* Privacy-safe request logging: method, path, status, latency only */
  if (enableRequestLog) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const ms = Date.now() - start;
        console.log(`[api-server] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
      });
      next();
    });
  }

  /* Health probe */
  const healthStmt = db.prepare('SELECT 1 AS ok');
  app.get('/api/health', (_req, res) => {
    try {
      healthStmt.get();
      return res.json({
        ok: true,
        service: 'daftarche-api',
        status: 'healthy',
        timestamp: Date.now(),
      });
    } catch (_err) {
      return res.status(503).json({ ok: false, status: 'unhealthy' });
    }
  });

  app.use('/api/auth', createAuthRouter({
    db,
    sendOtp: options.sendOtp,
    checkRateLimit,
    requireAuth,
    otpTtlMs: options.otpTtlMs,
    sessionTtlMs: options.sessionTtlMs,
  }));

  app.use('/api/sync', createSyncRouter({
    db,
    requireAuth,
    checkRateLimit,
  }));

  /* ── Unified Web Push Routes ── */
  const rawVapidPublic = options.vapidPublicKey !== undefined
    ? options.vapidPublicKey
    : process.env.VAPID_PUBLIC_KEY;
  const vapidPublicKey = typeof rawVapidPublic === 'string' && rawVapidPublic.trim()
    ? rawVapidPublic.trim()
    : null;

  const upsertPushSub = db.prepare(`
    INSERT INTO push_subscriptions (endpoint_hash, user_id, subscription_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint_hash) DO UPDATE SET
      user_id = COALESCE(excluded.user_id, push_subscriptions.user_id),
      subscription_json = excluded.subscription_json,
      updated_at = excluded.updated_at
  `);
  const deletePushSub = db.prepare(`
    DELETE FROM push_subscriptions WHERE endpoint_hash = ?
  `);

  app.get('/api/push/vapid-public-key', (_req, res) => {
    return res.json({
      ok: true,
      enabled: Boolean(vapidPublicKey),
      publicKey: vapidPublicKey,
    });
  });

  app.post('/api/push/subscribe', (req, res) => {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    if (!checkRateLimit('push-subscribe', ip, res)) {
      return res.status(429).json({ ok: false, error: 'درخواست‌های زیاد؛ کمی بعد دوباره تلاش کنید' });
    }

    const body = req.body;
    if (!validPushSubscription(body)) {
      return res.status(400).json({ ok: false, error: 'اطلاعات اشتراک پوش نامعتبر است' });
    }

    const cleanSub = {
      endpoint: body.endpoint,
      keys: {
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    };
    const endpointHash = hashEndpoint(cleanSub.endpoint);
    const userId = resolveOptionalUserId(db, req);
    const now = Date.now();

    upsertPushSub.run(endpointHash, userId, JSON.stringify(cleanSub), now, now);
    return res.json({ ok: true });
  });

  app.post('/api/push/unsubscribe', (req, res) => {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    if (!checkRateLimit('push-unsubscribe', ip, res)) {
      return res.status(429).json({ ok: false, error: 'درخواست‌های زیاد؛ کمی بعد دوباره تلاش کنید' });
    }

    const endpoint = req.body && req.body.endpoint;
    if (!isHttpsUrl(endpoint)) {
      return res.status(400).json({ ok: false, error: 'endpoint نامعتبر است' });
    }

    const endpointHash = hashEndpoint(endpoint);
    deletePushSub.run(endpointHash);
    return res.json({ ok: true });
  });

  /* Structured error handler — never leaks stack traces or request payloads */
  app.use((err, _req, res, _next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: 'JSON نامعتبر است' });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ ok: false, error: 'حجم درخواست بیش از حد مجاز است' });
    }
    console.error('[api-server] خطای پردازش:', (err && err.name) || 'Error');
    return res.status(500).json({ ok: false, error: 'خطای داخلی' });
  });

  app.locals.db = db;
  return app;
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3200;
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'daftarche.sqlite');

  const db = openDatabase(DB_PATH);
  const app = createApp({ db, nodeEnv: NODE_ENV });

  const server = app.listen(PORT, () => {
    console.log(`[api-server] روی پورت ${PORT} گوش می‌دهد — env=${NODE_ENV}`);
  });

  function shutdown() {
    server.close(() => {
      try { db.close(); } catch (_) {}
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = {
  createApp,
  createRateLimiter,
};
