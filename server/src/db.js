import 'dotenv/config';
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
