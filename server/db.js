/* ═══ دفتَرچه — SQLite Data Layer (node:sqlite) ═══
   Zero-native-build SQLite persistence using Node's built-in node:sqlite
   (DatabaseSync). Supports file-backed WAL mode for production and :memory:
   for isolated automated tests. */

const { DatabaseSync } = require('node:sqlite');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
  identifier TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_name TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions(user_id);

CREATE TABLE IF NOT EXISTS sync_entities (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'book')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('upsert', 'delete')),
  rev INTEGER NOT NULL CHECK (rev >= 1),
  server_cursor INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, entity_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_entities_user_cursor
  ON sync_entities(user_id, server_cursor);

CREATE TABLE IF NOT EXISTS sync_ops (
  user_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, op_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint_hash TEXT PRIMARY KEY,
  user_id TEXT,
  subscription_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON push_subscriptions(user_id);
`;

/**
 * Opens a SQLite database connection, configures pragmas, and initializes tables.
 * @param {string} [dbPath=':memory:']
 * @returns {import('node:sqlite').DatabaseSync}
 */
function openDatabase(dbPath = ':memory:') {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');

  if (dbPath && dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
  }

  db.exec(SCHEMA_SQL);
  return db;
}

/**
 * Executes a callback inside an IMMEDIATE SQLite transaction.
 * @template T
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
function runInTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {
      // Ignore rollback failures if transaction already aborted
    }
    throw err;
  }
}

module.exports = {
  openDatabase,
  runInTransaction,
};
