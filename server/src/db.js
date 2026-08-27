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

// Every table the app needs, in dependency order. All CREATE TABLE IF NOT
// EXISTS, so applying them on every boot is safe and does nothing once they
// exist — that is what lets a deploy migrate its own database just by starting.
//
// auth.sql first: every table in core.sql has a foreign key to `organization`.
// core.sql is also what `npm run seed` re-applies after dropping those four
// tables, so the definitions live in exactly one place.
//
// The pool is not multipleStatements, so these are split on ';'.
const STANDING_MIGRATIONS = ['auth.sql', 'picklist.sql', 'layout.sql', 'core.sql'];

// Strip `--` line comments before splitting on ';'. A semicolon inside a
// comment would otherwise cut a CREATE TABLE in half and the fragment would be
// sent to MySQL as its own statement — which is exactly what happened the first
// time a migration comment contained one.
const stripComments = (sql) => sql.replace(/--.*/g, '');

// Bring the database up to date. Two distinct passes, in this order:
//
//   1. One-time migrations — reshape tables that already exist. Guarded by the
//      `schema_migration` ledger so each runs at most once, ever. See
//      schemaMigrations.js.
//   2. Standing migrations — create anything missing. Idempotent by nature.
//
// The order matters: pass 1 may drop a stale table so that pass 2 can rebuild
// it with the current definition.
//
// Pass 2 runs even when pass 1 fails. A one-time migration that refuses (because
// it will not destroy rows) says nothing about the tables it does not touch, and
// letting its error skip pass 2 as well is how one refusal left a deployment
// with no `picklist`, `rack_layout` or `rack_group_override` table at all — three
// more broken screens than the refusal actually called for. The error is still
// raised afterwards, so the caller reports it exactly as before.
//
// Returns the list of one-time migrations actually performed, so the caller can
// log them. On an up-to-date database that list is empty and the whole call
// costs one SELECT.
export async function applySchema() {
  const { applyOneTimeMigrations } = await import('./schemaMigrations.js');

  let performed = [];
  let oneTimeError = null;
  try {
    performed = await applyOneTimeMigrations();
  } catch (err) {
    oneTimeError = err;
  }

  for (const file of STANDING_MIGRATIONS) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    for (const stmt of stripComments(sql).split(';')) {
      if (stmt.trim()) await pool.query(stmt);
    }
  }

  if (oneTimeError) throw oneTimeError;
  return performed;
}

// Old name, kept so existing check scripts and any external caller keep working.
export const applyAuthSchema = applySchema;

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
