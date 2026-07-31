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

// Apply migrations/auth.sql. All CREATE TABLE IF NOT EXISTS, so it is safe to
// run on every boot — and it lives outside schema.sql, which seed.js drops and
// recreates. The pool is not multipleStatements, so split on ';'.
export async function applyAuthSchema() {
  const sql = await readFile(new URL('../migrations/auth.sql', import.meta.url), 'utf8');
  for (const stmt of sql.split(';')) {
    if (stmt.trim()) await pool.query(stmt);
  }
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
