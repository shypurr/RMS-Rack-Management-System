import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_NAME || 'rms';

const COLORS = ['Red', 'Blue', 'Green', 'Black', 'White', 'Maroon', 'Navy', 'Beige'];
const SIZES = ['S', 'M', 'L', 'XL', 'Free Size'];
const ITEMS = ['Saree', 'Kurti', 'Salwar Kameez', 'Lehenga', 'Dupatta', 'Shirt', 'Trousers', 'Kids Wear'];
const MODULES = ['Purchase Inward', 'Job Slip', 'Pack Design', 'Sales Return'];

const pad = (n) => String(n).padStart(2, '0');
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const rndInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

async function main() {
  // Connect without a database so we can create it; allow multi-statement schema.
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4`);
  await conn.query(`USE \`${DB}\``);

  const schema = await readFile(path.join(__dirname, 'migrations', 'schema.sql'), 'utf8');
  await conn.query(schema);
  console.log('Schema applied.');

  // ── Empty racks: R{1-5}-S{1-4}-B{1-5} = 100 bins, capacity 100 each ──
  const rackRows = [];
  for (let r = 1; r <= 5; r++)
    for (let s = 1; s <= 4; s++)
      for (let b = 1; b <= 5; b++)
        rackRows.push([`R${pad(r)}-S${pad(s)}-B${pad(b)}`, 100]);
  await conn.query('INSERT INTO rack_master (rack_id, capacity) VALUES ?', [rackRows]);
  console.log(`Seeded ${rackRows.length} racks (all Vacant).`);

  // ── Fake source transactions feeding Flow A ──
  const srcRows = [];
  let n = 1;
  for (const mod of MODULES) {
    for (let i = 0; i < 8; i++) {
      const prefix = mod.split(' ').map((w) => w[0]).join('');
      srcRows.push([`${prefix}-${pad(n++)}`, mod, rnd(ITEMS), rnd(COLORS), rnd(SIZES), rndInt(5, 60)]);
    }
  }
  await conn.query(
    'INSERT INTO source_transaction (id, module_type, item, color, size, qty) VALUES ?',
    [srcRows]
  );
  console.log(`Seeded ${srcRows.length} source transactions.`);

  await conn.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
