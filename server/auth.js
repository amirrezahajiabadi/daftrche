/* ═══ دفتَرچه — Guest-First Passwordless OTP Auth Module ═══
   Supports normalized email or Iranian mobile number identifiers, salted SHA-256
   OTP storage with timing-safe verification, rate limiting, pluggable delivery,
   and hashed Bearer session tokens. */

const crypto = require('node:crypto');
const express = require('express');
const { runInTransaction } = require('./db');

const OTP_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_OTP_ATTEMPTS = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const IR_MOBILE_RE = /^(?:\+98|0098|98|0)?(9\d{9})$/;

/**
 * Converts Persian and Arabic-Indic digits to ASCII 0-9.
 * @param {string} input
 * @returns {string}
 */
function toAsciiDigits(input) {
  return String(input)
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Normalizes and validates an email address or Iranian mobile number.
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeIdentifier(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = toAsciiDigits(raw).trim();
  if (!trimmed || trimmed.length > 254) return null;

  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    return EMAIL_RE.test(email) ? email : null;
  }

  const compact = trimmed.replace(/[\s\-().]/g, '');
  const m = IR_MOBILE_RE.exec(compact);
  if (!m) return null;
  return `+98${m[1]}`;
}

/**
 * Generates a cryptographically secure 6-digit OTP code.
 * @returns {string}
 */
function generateOtpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Hashes an OTP code with a random 16-byte salt using SHA-256.
 * @param {string} code
 * @param {string} [saltHex]
 * @returns {string}
 */
function hashOtp(code, saltHex = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.createHash('sha256').update(`${saltHex}:${code}`).digest('hex');
  return `${saltHex}:${digest}`;
}

/**
 * Compares a candidate OTP code against a stored salted SHA-256 hash in constant time.
 * @param {string} code
 * @param {string} storedHash
 * @returns {boolean}
 */
function verifyOtpHash(code, storedHash) {
  if (typeof code !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [saltHex, expectedHex] = parts;
  if (!saltHex || !/^[0-9a-f]{64}$/i.test(expectedHex)) return false;

  const actualBuf = crypto.createHash('sha256').update(`${saltHex}:${code}`).digest();
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  return actualBuf.length === expectedBuf.length && crypto.timingSafeEqual(actualBuf, expectedBuf);
}

/**
 * Hashes a Bearer session token using SHA-256.
 * @param {string} token
 * @returns {string}
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Default pluggable OTP delivery stub (safe for dev/tests, never logs raw codes).
 * @param {string} _identifier
 * @param {string} _code
 * @returns {Promise<{ ok: boolean, provider: string }>}
 */
async function defaultSendOtp(_identifier, _code) {
  return { ok: true, provider: 'stub' };
}

/**
 * Builds the `requireAuth` middleware backed by the SQLite sessions table.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {import('express').RequestHandler}
 */
function createRequireAuth(db) {
  const selectSession = db.prepare(`
    SELECT s.token_hash, s.user_id, s.device_name, s.expires_at, s.revoked_at, u.identifier
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `);

  return function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const m = /^Bearer\s+(\S+)$/.exec(authHeader);
    if (!m) {
      return res.status(401).json({ ok: false, error: 'احراز هویت لازم است' });
    }

    const tokenHash = hashToken(m[1]);
    const session = selectSession.get(tokenHash);
    if (!session || session.revoked_at !== null || session.expires_at <= Date.now()) {
      return res.status(401).json({ ok: false, error: 'نشست کاربری معتبر نیست یا منقضی شده است' });
    }

    req.auth = {
      userId: session.user_id,
      identifier: session.identifier,
      tokenHash: session.token_hash,
      deviceName: session.device_name || null,
    };
    return next();
  };
}

/**
 * Resolves an optional authenticated user ID from Bearer token without failing guests.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function resolveOptionalUserId(db, req) {
  const authHeader = req.headers.authorization || '';
  const m = /^Bearer\s+(\S+)$/.exec(authHeader);
  if (!m) return null;

  const tokenHash = hashToken(m[1]);
  const session = db.prepare(`
    SELECT user_id, expires_at, revoked_at
    FROM sessions
    WHERE token_hash = ?
  `).get(tokenHash);

  if (!session || session.revoked_at !== null || session.expires_at <= Date.now()) {
    return null;
  }
  return session.user_id;
}

/**
 * Creates the Express router for passwordless OTP auth and session management.
 * @param {Object} options
 * @param {import('node:sqlite').DatabaseSync} options.db
 * @param {(identifier: string, code: string) => Promise<any>} [options.sendOtp]
 * @param {(rule: string, key: string, res: import('express').Response) => boolean} options.checkRateLimit
 * @param {import('express').RequestHandler} options.requireAuth
 * @param {number} [options.otpTtlMs]
 * @param {number} [options.sessionTtlMs]
 * @returns {import('express').Router}
 */
function createAuthRouter({
  db,
  sendOtp = defaultSendOtp,
  checkRateLimit,
  requireAuth,
  otpTtlMs = OTP_TTL_MS,
  sessionTtlMs = SESSION_TTL_MS,
}) {
  const router = express.Router();

  const upsertOtp = db.prepare(`
    INSERT INTO otp_codes (identifier, code_hash, expires_at, attempts, created_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(identifier) DO UPDATE SET
      code_hash = excluded.code_hash,
      expires_at = excluded.expires_at,
      attempts = 0,
      created_at = excluded.created_at
  `);
  const getOtp = db.prepare(`
    SELECT identifier, code_hash, expires_at, attempts, created_at
    FROM otp_codes
    WHERE identifier = ?
  `);
  const incrementOtpAttempts = db.prepare(`
    UPDATE otp_codes SET attempts = attempts + 1 WHERE identifier = ?
  `);
  const deleteOtp = db.prepare(`
    DELETE FROM otp_codes WHERE identifier = ?
  `);

  const getUserByIdentifier = db.prepare(`
    SELECT id, identifier, created_at, updated_at FROM users WHERE identifier = ?
  `);
  const insertUser = db.prepare(`
    INSERT INTO users (id, identifier, created_at, updated_at) VALUES (?, ?, ?, ?)
  `);
  const touchUser = db.prepare(`
    UPDATE users SET updated_at = ? WHERE id = ?
  `);

  const insertSession = db.prepare(`
    INSERT INTO sessions (token_hash, user_id, device_name, created_at, expires_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `);
  const revokeSession = db.prepare(`
    UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL
  `);

  router.post('/request-otp', async (req, res) => {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    if (!checkRateLimit('auth-request-otp-ip', ip, res)) {
      return res.status(429).json({ ok: false, error: 'درخواست‌های زیاد از این نشانی؛ کمی بعد دوباره تلاش کنید' });
    }

    const identifier = normalizeIdentifier(req.body && req.body.identifier);
    if (!identifier) {
      return res.status(400).json({ ok: false, error: 'ایمیل یا شماره موبایل معتبر نیست' });
    }

    const idKey = crypto.createHash('sha256').update(identifier).digest('hex').slice(0, 24);
    if (!checkRateLimit('auth-request-otp-id', idKey, res)) {
      return res.status(429).json({ ok: false, error: 'برای این شناسه درخواست‌های زیادی ثبت شده است؛ کمی بعد تلاش کنید' });
    }

    const code = generateOtpCode();
    const codeHash = hashOtp(code);
    const now = Date.now();
    const expiresAt = now + otpTtlMs;

    upsertOtp.run(identifier, codeHash, expiresAt, now);

    try {
      await sendOtp(identifier, code);
    } catch (_err) {
      deleteOtp.run(identifier);
      return res.status(502).json({ ok: false, error: 'ارسال کد تأیید ناموفق بود' });
    }

    return res.json({
      ok: true,
      identifier,
      expiresInSec: Math.floor(otpTtlMs / 1000),
    });
  });

  router.post('/verify-otp', (req, res) => {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    if (!checkRateLimit('auth-verify-otp-ip', ip, res)) {
      return res.status(429).json({ ok: false, error: 'درخواست‌های زیاد؛ کمی بعد دوباره تلاش کنید' });
    }

    const identifier = normalizeIdentifier(req.body && req.body.identifier);
    if (!identifier) {
      return res.status(400).json({ ok: false, error: 'ایمیل یا شماره موبایل معتبر نیست' });
    }

    const rawCode = req.body && req.body.code;
    const code = typeof rawCode === 'string' ? toAsciiDigits(rawCode).trim() : '';
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: 'کد تأیید باید ۶ رقم باشد' });
    }

    const rawDeviceName = req.body && req.body.deviceName;
    const deviceName = typeof rawDeviceName === 'string' && rawDeviceName.trim()
      ? rawDeviceName.trim().slice(0, 80)
      : 'unknown';

    const otpRow = getOtp.get(identifier);
    const now = Date.now();

    if (!otpRow) {
      return res.status(401).json({ ok: false, error: 'کد تأیید یافت نشد یا منقضی شده است' });
    }

    if (otpRow.expires_at <= now) {
      deleteOtp.run(identifier);
      return res.status(401).json({ ok: false, error: 'کد تأیید منقضی شده است' });
    }

    if (otpRow.attempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ ok: false, error: 'تعداد تلاش‌های ناموفق به سقف مجاز رسید؛ کد جدید درخواست کنید' });
    }

    if (!verifyOtpHash(code, otpRow.code_hash)) {
      incrementOtpAttempts.run(identifier);
      return res.status(401).json({ ok: false, error: 'کد تأیید نادرست است' });
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(rawToken);

    const user = runInTransaction(db, () => {
      deleteOtp.run(identifier);

      let existingUser = getUserByIdentifier.get(identifier);
      if (!existingUser) {
        const id = crypto.randomUUID();
        insertUser.run(id, identifier, now, now);
        existingUser = { id, identifier };
      } else {
        touchUser.run(now, existingUser.id);
      }

      insertSession.run(tokenHash, existingUser.id, deviceName, now, now + sessionTtlMs);
      return {
        id: existingUser.id,
        identifier: existingUser.identifier,
      };
    });

    return res.json({
      ok: true,
      token: rawToken,
      user,
    });
  });

  router.get('/me', requireAuth, (req, res) => {
    return res.json({
      ok: true,
      user: {
        id: req.auth.userId,
        identifier: req.auth.identifier,
      },
    });
  });

  router.post('/logout', requireAuth, (req, res) => {
    revokeSession.run(Date.now(), req.auth.tokenHash);
    return res.json({ ok: true });
  });

  return router;
}

module.exports = {
  OTP_TTL_MS,
  SESSION_TTL_MS,
  MAX_OTP_ATTEMPTS,
  normalizeIdentifier,
  generateOtpCode,
  hashOtp,
  verifyOtpHash,
  hashToken,
  defaultSendOtp,
  createRequireAuth,
  resolveOptionalUserId,
  createAuthRouter,
};
