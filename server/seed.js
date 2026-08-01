import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { sslConfig } from './src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_NAME || 'rms';

// `npm run seed -- --empty` = old behaviour (racks + source txns only, no stock).
const EMPTY = process.argv.includes('--empty');

// ── catalogue ──────────────────────────────────────────────────────────────
// Colours/sizes are per-item so the generated stock reads like real textile
// inventory (a Saree has no size, Kids Wear has its own size run).
const CATALOG = [
  { item: 'Banarasi Saree',   colors: ['Maroon', 'Red', 'Gold', 'Emerald', 'Navy'],       sizes: ['Free Size'] },
  { item: 'Cotton Saree',     colors: ['White', 'Beige', 'Sky Blue', 'Mustard'],          sizes: ['Free Size'] },
  { item: 'Anarkali Kurti',   colors: ['Red', 'Black', 'Teal', 'Peach', 'Olive'],         sizes: ['S', 'M', 'L', 'XL', 'XXL'] },
  { item: 'Rayon Kurti',      colors: ['Blue', 'Green', 'Pink', 'Grey'],                  sizes: ['S', 'M', 'L', 'XL'] },
  { item: 'Salwar Kameez',    colors: ['Cream', 'Maroon', 'Navy', 'Lavender'],            sizes: ['S', 'M', 'L', 'XL'] },
  { item: 'Bridal Lehenga',   colors: ['Red', 'Magenta', 'Gold', 'Wine'],                 sizes: ['S', 'M', 'L'] },
  { item: 'Chiffon Dupatta',  colors: ['White', 'Yellow', 'Turquoise', 'Rose'],           sizes: ['Free Size'] },
  { item: 'Formal Shirt',     colors: ['White', 'Sky Blue', 'Black', 'Lilac'],            sizes: ['38', '40', '42', '44'] },
  { item: 'Casual Shirt',     colors: ['Denim', 'Olive', 'Checked Red', 'Grey'],          sizes: ['S', 'M', 'L', 'XL'] },
  { item: 'Formal Trousers',  colors: ['Black', 'Navy', 'Charcoal', 'Beige'],             sizes: ['30', '32', '34', '36', '38'] },
  { item: 'Palazzo Pants',    colors: ['Black', 'White', 'Mustard', 'Maroon'],            sizes: ['S', 'M', 'L', 'XL'] },
  { item: 'Kids Frock',       colors: ['Pink', 'Yellow', 'Sky Blue', 'Mint'],             sizes: ['2-3Y', '4-5Y', '6-7Y', '8-9Y'] },
  { item: 'Kids Kurta Set',   colors: ['White', 'Orange', 'Green'],                       sizes: ['2-3Y', '4-5Y', '6-7Y'] },
  { item: 'Nehru Jacket',     colors: ['Black', 'Beige', 'Maroon', 'Bottle Green'],       sizes: ['38', '40', '42', '44'] },
  { item: 'Silk Stole',       colors: ['Gold', 'Silver', 'Rust', 'Indigo'],               sizes: ['Free Size'] },
  { item: 'Nightwear Set',    colors: ['Pink', 'Grey', 'Navy', 'Printed'],                sizes: ['S', 'M', 'L', 'XL'] },
];

const MODULES = ['Purchase Inward', 'Job Slip', 'Pack Design', 'Sales Return'];
const MODULE_PREFIX = { 'Purchase Inward': 'PI', 'Job Slip': 'JS', 'Pack Design': 'PD', 'Sales Return': 'SR' };
// Stub names for the demo history only. Real rows written through the API carry
// the logged-in org's vastra_org_id; these just make the "By" column in the
// audit/movement reports meaningful before anyone has used the app.
const USERS = ['system', 'anita.k', 'rahul.m', 'priya.s', 'vikram.j'];

// ── helpers ────────────────────────────────────────────────────────────────
const pad = (n, w = 2) => String(n).padStart(w, '0');
// Stand-in for Vastra's itemTypeID: derived from the name so the demo has stable,
// unique, readable codes ('Banarasi Saree' → 'BAN-SAR') with nothing to maintain.
const codeFor = (item) => item.split(' ').map((w) => w.slice(0, 3).toUpperCase()).join('-');
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const rndInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const chance = (p) => Math.random() < p;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Split `total` into `parts` strictly-positive integers (item_location.qty > 0).
function partition(total, parts) {
  const out = new Array(parts).fill(1);
  let left = total - parts;
  const step = Math.max(1, Math.ceil(total / parts));
  while (left > 0) {
    const i = rndInt(0, parts - 1);
    const take = Math.min(left, rndInt(1, step));
    out[i] += take;
    left -= take;
  }
  return out;
}

// A timestamp `d` days back at a plausible warehouse hour. Never in the future,
// so "added today" tiles and the 7-day trend line up with CURDATE().
const NOW = new Date();
function ago(days, hour = rndInt(9, 19), minute = rndInt(0, 59)) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, rndInt(0, 59), 0);
  if (d > NOW) d.setTime(NOW.getTime() - rndInt(60, 3600) * 1000);
  return d;
}

const HISTORY_DAYS = 21; // how far back the audit trail reaches

// ── generators ─────────────────────────────────────────────────────────────

// 100 bins: R{1-5}-S{1-4}-B{1-5}. Capacity varies by shelf (bulk goods live on
// the lower shelves) so the utilisation report isn't a flat 100 everywhere.
function buildRacks() {
  const CAPACITY_BY_SHELF = { 1: 150, 2: 120, 3: 100, 4: 60 };
  const racks = [];
  for (let r = 1; r <= 5; r++)
    for (let s = 1; s <= 4; s++)
      for (let b = 1; b <= 5; b++)
        racks.push({ rack_id: `R${pad(r)}-S${pad(s)}-B${pad(b)}`, capacity: CAPACITY_BY_SHELF[s] });
  return racks;
}

// Spread racks across the three dashboard buckets: Vacant / Partial / ≥85% Full.
function planOccupancy(racks) {
  const shuffled = shuffle(racks);
  const vacantCount = 24;
  const fullCount = 18;
  shuffled.forEach((rack, i) => {
    if (i < vacantCount) rack.fillRatio = 0;
    else if (i < vacantCount + fullCount) rack.fillRatio = rndInt(85, 100) / 100;
    else rack.fillRatio = rndInt(8, 82) / 100;
  });
  return racks;
}

// Stock rows. Within one rack (item, color, size) must be unique — the API
// merges duplicates on add, so the seed must not create any.
function buildStock(racks) {
  const rows = [];
  for (const rack of racks) {
    if (!rack.fillRatio) continue;
    const target = Math.max(1, Math.round(rack.capacity * rack.fillRatio));
    const lines = Math.min(rndInt(1, 5), target);
    const qtys = partition(target, lines);

    const seen = new Set();
    for (let i = 0; i < lines; i++) {
      let combo, key, guard = 0;
      do {
        const c = rnd(CATALOG);
        combo = { item: c.item, color: rnd(c.colors), size: rnd(c.sizes) };
        key = `${combo.item}|${combo.color}|${combo.size}`;
      } while (seen.has(key) && ++guard < 25);
      if (seen.has(key)) continue; // couldn't find a fresh combo; drop the line
      seen.add(key);

      // ~70% of stock arrives via a source module (Flow A), the rest is manual.
      const moduleType = chance(0.7) ? rnd(MODULES) : null;
      rows.push({
        ...combo,
        qty: qtys[i],
        fk_rack_id: rack.rack_id,
        module_type: moduleType,
        module_id: moduleType ? `${MODULE_PREFIX[moduleType]}-2026-${pad(rndInt(1, 400), 4)}` : null,
        created_at: ago(rndInt(0, HISTORY_DAYS)),
      });
    }
  }
  return rows;
}

// Flow A feed. Ids are what the Add Item search box matches on (LIKE on id).
function buildSourceTransactions() {
  const rows = [];
  for (const mod of MODULES) {
    for (let i = 1; i <= 18; i++) {
      const c = rnd(CATALOG);
      rows.push([
        `${MODULE_PREFIX[mod]}-2026-${pad(i, 4)}`,
        mod,
        c.item,
        codeFor(c.item),
        rnd(c.colors),
        rnd(c.sizes),
        rndInt(5, 90),
      ]);
    }
  }
  return rows;
}

// Audit trail. Two sources:
//   1. one `add` per stock row that exists today (backdated to its created_at)
//   2. extra history — moves, qty corrections, removals — that explain how the
//      warehouse got here. before/after JSON matches what rackService writes,
//      so the Movement report and audit table render exactly like live rows.
function buildAudit(stock, racks) {
  const rows = [];
  const push = (at, action, entityId, before, after) =>
    rows.push([
      'item_location',
      String(entityId),
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      rnd(USERS),
      at,
    ]);

  for (const s of stock) {
    push(s.created_at, 'add', s.id, null, {
      id: s.id, item: s.item, color: s.color, size: s.size,
      qty: s.qty, fk_rack_id: s.fk_rack_id,
      module_type: s.module_type, module_id: s.module_id,
    });
  }

  const rackIds = racks.map((r) => r.rack_id);
  const pickItem = () => rnd(stock);

  // Historical movements/edits, weighted towards recent days.
  const extra = 170;
  for (let i = 0; i < extra; i++) {
    const day = Math.floor(Math.random() ** 1.6 * HISTORY_DAYS); // bias to recent
    const at = ago(day);
    const s = pickItem();
    const roll = Math.random();

    if (roll < 0.45) {
      const toRack = rnd(rackIds.filter((r) => r !== s.fk_rack_id));
      const movedQty = rndInt(1, Math.max(1, Math.floor(s.qty / 2) || 1));
      push(at, 'move', s.id,
        { rack: s.fk_rack_id, item: s.item, color: s.color, size: s.size, qty: s.qty + movedQty },
        { fromRack: s.fk_rack_id, toRack, movedQty });
    } else if (roll < 0.8) {
      const prevQty = Math.max(1, s.qty + rndInt(-8, 12));
      push(at, 'update', s.id,
        { id: s.id, item: s.item, color: s.color, size: s.size, qty: prevQty, fk_rack_id: s.fk_rack_id },
        { id: s.id, item: s.item, color: s.color, size: s.size, qty: s.qty, fk_rack_id: s.fk_rack_id });
    } else {
      // A line that was fully picked out — no longer in item_location.
      const c = rnd(CATALOG);
      push(at, 'remove', rndInt(10_000, 10_500),
        { id: 0, item: c.item, color: rnd(c.colors), size: rnd(c.sizes), qty: rndInt(1, 40), fk_rack_id: rnd(rackIds) },
        null);
    }
  }

  // Guarantee every one of the last 7 days has activity, and that today shows
  // both counters — the dashboard's trend chart and "today" tiles depend on it.
  for (let day = 0; day <= 6; day++) {
    for (let k = 0; k < rndInt(2, 4); k++) {
      const s = pickItem();
      push(ago(day), 'add', s.id, null, {
        id: s.id, item: s.item, color: s.color, size: s.size,
        qty: rndInt(1, 30), fk_rack_id: s.fk_rack_id,
        module_type: s.module_type, module_id: s.module_id,
      });
    }
    for (let k = 0; k < rndInt(1, 3); k++) {
      const s = pickItem();
      const toRack = rnd(rackIds.filter((r) => r !== s.fk_rack_id));
      const movedQty = rndInt(1, 20);
      push(ago(day), 'move', s.id,
        { rack: s.fk_rack_id, item: s.item, color: s.color, size: s.size, qty: s.qty + movedQty },
        { fromRack: s.fk_rack_id, toRack, movedQty });
    }
  }

  // Oldest first, so audit_log.id order matches chronological order (the API
  // sorts by id DESC for "newest first").
  rows.sort((a, b) => a[6] - b[6]);
  return rows;
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  // Connect without a database so we can create it; allow multi-statement schema.
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    ssl: sslConfig(),
  });

  // Managed hosts often pre-create the database (e.g. Aiven's "defaultdb") and
  // don't grant CREATE DATABASE — tolerate that and just USE it.
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4`);
  } catch (e) {
    console.warn(`Could not create database ${DB} (${e.code}); assuming it already exists.`);
  }
  await conn.query(`USE \`${DB}\``);

  const schema = await readFile(path.join(__dirname, 'migrations', 'schema.sql'), 'utf8');
  await conn.query(schema);
  console.log('Schema applied.');

  // ── racks ──
  const racks = buildRacks();
  await conn.query('INSERT INTO rack_master (rack_id, capacity) VALUES ?', [
    racks.map((r) => [r.rack_id, r.capacity]),
  ]);
  console.log(`Seeded ${racks.length} racks.`);

  // ── source transactions (Flow A feed) ──
  const srcRows = buildSourceTransactions();
  await conn.query(
    'INSERT INTO source_transaction (id, module_type, item, item_code, color, size, qty) VALUES ?',
    [srcRows]
  );
  console.log(`Seeded ${srcRows.length} source transactions.`);

  if (EMPTY) {
    console.log('--empty: skipping stock and audit history. All racks Vacant.');
    await conn.end();
    return;
  }

  // ── stock ──
  planOccupancy(racks);
  const stock = buildStock(racks);
  await conn.query(
    `INSERT INTO item_location
       (item, item_code, color, size, qty, fk_rack_id, module_id, module_type, created_at, updated_at)
     VALUES ?`,
    [stock.map((s) => [s.item, codeFor(s.item), s.color, s.size, s.qty, s.fk_rack_id, s.module_id, s.module_type, s.created_at, s.created_at])]
  );

  // Read the auto-increment ids back so audit rows point at real item_location rows.
  const [inserted] = await conn.query(
    'SELECT id, item, color, size, fk_rack_id FROM item_location ORDER BY id'
  );
  const idByKey = new Map(
    inserted.map((r) => [`${r.fk_rack_id}|${r.item}|${r.color}|${r.size}`, r.id])
  );
  for (const s of stock) s.id = idByKey.get(`${s.fk_rack_id}|${s.item}|${s.color}|${s.size}`);

  // rack_master.used = SUM(qty); status derived. Same rule as rackService.recalcRack.
  await conn.query(`
    UPDATE rack_master rm
    LEFT JOIN (SELECT fk_rack_id, SUM(qty) AS total FROM item_location GROUP BY fk_rack_id) t
      ON t.fk_rack_id = rm.rack_id
    SET rm.used = COALESCE(t.total, 0),
        rm.status = IF(COALESCE(t.total, 0) = 0, 'Vacant', 'Occupied')
  `);

  const [[occ]] = await conn.query(`
    SELECT COUNT(*) AS occupied, COALESCE(SUM(used),0) AS units,
           COALESCE(SUM(used >= 0.85*capacity),0) AS nearly_full
    FROM rack_master WHERE status = 'Occupied'
  `);
  console.log(
    `Seeded ${stock.length} stock lines — ${occ.units} units across ${occ.occupied} racks ` +
    `(${occ.nearly_full} at 85%+, ${racks.length - occ.occupied} vacant).`
  );

  // ── audit trail ──
  const auditRows = buildAudit(stock, racks);
  for (let i = 0; i < auditRows.length; i += 200) {
    await conn.query(
      `INSERT INTO audit_log
         (entity_type, entity_id, action, before_json, after_json, user_id, created_at)
       VALUES ?`,
      [auditRows.slice(i, i + 200)]
    );
  }
  const [[act]] = await conn.query(`
    SELECT COALESCE(SUM(action='add'  AND DATE(created_at)=CURDATE()),0) AS added_today,
           COALESCE(SUM(action='move' AND DATE(created_at)=CURDATE()),0) AS moved_today
    FROM audit_log
  `);
  console.log(
    `Seeded ${auditRows.length} audit entries over ${HISTORY_DAYS} days ` +
    `(today: ${act.added_today} added, ${act.moved_today} moved).`
  );

  await conn.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
