import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

// Shared connection pool. Routes/services borrow connections for transactions.
export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'rms',
  waitForConnections: true,
  connectionLimit: 10,
  // Managed hosts (Aiven etc.) require TLS. Set DB_SSL=true; paste the provider's
  // CA cert into DB_CA for full verification, otherwise it connects without it.
  ssl: sslConfig(),
});

export function sslConfig() {
  if (process.env.DB_SSL !== 'true') return undefined;
  return process.env.DB_CA ? { ca: process.env.DB_CA } : { rejectUnauthorized: false };
}

// Driver-level failures that mean "the database is unreachable/misconfigured"
// rather than "this query was bad". These must never be echoed to the browser:
// the message embeds the DB hostname, port and user.
const CONNECTION_ERRORS = new Set([
  'ENOTFOUND',            // hostname does not resolve — server deleted or DB_HOST typo
  'ECONNREFUSED',         // resolves, nothing listening on that port
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  'EAI_AGAIN',            // transient DNS failure
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_CON_COUNT_ERROR',
  'ER_NOT_SUPPORTED_AUTH_MODE',
  'HANDSHAKE_SSL_ERROR',
]);

export const isConnectionError = (err) =>
  CONNECTION_ERRORS.has(err?.code) || CONNECTION_ERRORS.has(err?.errno);

// Where we're pointed, with no secrets — safe for logs.
export const dbTarget = () =>
  `${process.env.DB_USER || 'root'}@${process.env.DB_HOST || '127.0.0.1'}:` +
  `${Number(process.env.DB_PORT) || 3306}/${process.env.DB_NAME || 'rms'}`;

// One-shot connectivity probe. Returns null on success, else the error — so the
// caller decides whether to warn or exit.
export async function pingDb() {
  try {
    const conn = await pool.getConnection();
    try { await conn.ping(); } finally { conn.release(); }
    return null;
  } catch (err) {
    return err;
  }
}

// Apply the migrations that live OUTSIDE schema.sql, which seed.js drops and
// recreates: auth (a demo reseed must never delete a login), picklist
// history (operational record) and layout (an organization's real rack config).
// All CREATE TABLE IF NOT EXISTS, so this is safe on every boot and brings an
// existing database up to date without a reseed. The pool is not
// multipleStatements, so split on ';'.
const STANDING_MIGRATIONS = ['auth.sql', 'picklist.sql', 'layout.sql'];

// Strip `--` line comments before splitting on ';'. A semicolon inside a
// comment would otherwise cut a CREATE TABLE in half and the fragment would be
// sent to MySQL as its own statement — which is exactly what happened the first
// time a migration comment contained one.
const stripComments = (sql) => sql.replace(/--.*/g, '');

// Columns added to a standing-migration table AFTER it first shipped. Those
// tables deliberately survive a reseed, so CREATE TABLE IF NOT EXISTS silently
// skips them on an existing database and the new column never appears. MySQL 8
// has no ADD COLUMN IF NOT EXISTS, so check information_schema first.
//
// The ALTER is deliberately allowed to fail loudly on a table that already has
// rows: a NOT NULL org column cannot be invented for existing picklists, and
// guessing an owner is worse than stopping.
const BACKFILL_COLUMNS = [
  {
    table: 'picklist',
    column: 'fk_org_id',
    ddl: `ADD COLUMN fk_org_id INT NOT NULL,
          ADD CONSTRAINT fk_picklist_org FOREIGN KEY (fk_org_id)
            REFERENCES organization(id) ON DELETE CASCADE`,
  },
];

async function applyBackfillColumns() {
  for (const { table, column, ddl } of BACKFILL_COLUMNS) {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column]
    );
    if (!rows.length) await pool.query(`ALTER TABLE \`${table}\` ${ddl}`);
  }
}

export async function applyAuthSchema() {
  for (const file of STANDING_MIGRATIONS) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    for (const stmt of stripComments(sql).split(';')) {
      if (stmt.trim()) await pool.query(stmt);
    }
  }
  await applyBackfillColumns();
}

// Run a function inside a transaction; commit on success, rollback on throw.
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
