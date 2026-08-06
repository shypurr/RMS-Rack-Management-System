import { Router } from 'express';
import { pool } from '../db.js';
import { findPlacements, pickItems, HttpError } from '../services/rackService.js';
import { fetchTransactions } from '../services/sourceModules.js';
import { PICK_MODULE_TYPE } from '../vastraClient.js';

const router = Router();

// Outbound picking (Flow C). A Delivery Challan says WHAT leaves the warehouse;
// RMS answers WHERE it is, then deducts it once the picker confirms.
//
// Two deliberate steps: GET /:dcNo only reads (generating a picklist must never
// touch stock), POST /:dcNo/pick is the one that writes.

// A stub challan spreads its lines over `DC-2026-0007#1`, `#2`… because
// source_transaction.id is the primary key. Vastra rows already share one
// masterNo per document, so this is a no-op there.
const docNo = (id) => String(id).split('#')[0];

// Largest-rack-first: fill from the rack holding the most until the line is
// covered. Mutates nothing — returns a `suggested` per placement.
function allocate(placements, needed) {
  let left = needed;
  return placements.map((p) => {
    const take = Math.min(left, p.qty);
    left -= take;
    return { ...p, suggested: take };
  });
}

// GET /api/picklist/challans?q=&limit= — dropdown feed, one entry per DOCUMENT.
// The underlying feed is one row per line, so a raw limit of 10 could be a
// single 10-line challan; over-fetch, group, then cap on documents.
router.get('/challans', async (req, res, next) => {
  try {
    const { q } = req.query;
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    const rows = await fetchTransactions(req.org, {
      moduleType: PICK_MODULE_TYPE, q, limit: limit * 20,
    });

    const docs = new Map();
    for (const r of rows) {
      const id = docNo(r.id);
      if (!id) continue;
      const doc = docs.get(id) || { id, date: r.date ?? null, party: r.party ?? '', lines: 0, qty: 0 };
      doc.lines += 1;
      doc.qty += Number(r.qty) || 0;
      docs.set(id, doc);
    }
    res.json([...docs.values()].slice(0, limit));
  } catch (err) { next(err); }
});

// GET /api/picklist/:dcNo — the picklist. Read-only by design.
// Turn challan lines into picklist rows: merge duplicates, order them the way
// the challan reads, then resolve each to the racks holding it.
// Shared by both entry paths — typed by hand today, read off the Vastra module
// once that API exists — so the two can never drift apart.
async function resolveLines(rawLines) {
  // One row per item: a challan may list the same item/color/size twice.
  const merged = new Map();
  for (const r of rawLines) {
    const item = String(r.item || '').trim();
    if (!item) continue;
    const color = String(r.color || '').trim();
    const size = String(r.size || '').trim();
    const qty = Number(r.qty) || 0;
    if (qty <= 0) continue;
    const key = `${item}|${color}|${size}`;
    const line = merged.get(key) || { item, color, size, qty: 0 };
    line.qty += qty;
    merged.set(key, line);
  }

  // A challan lists one design across a run of sizes, so keep those lines
  // adjacent — the picklist should read the way the challan does. Numeric
  // sizes (36, 38, 42) sort numerically, lettered ones alphabetically.
  const sizeKey = (s) => (/^\d+$/.test(s) ? Number(s) : Infinity);
  const lines = [...merged.values()].sort((a, b) =>
    a.item.localeCompare(b.item) ||
    a.color.localeCompare(b.color) ||
    sizeKey(a.size) - sizeKey(b.size) ||
    a.size.localeCompare(b.size)
  );

  const placed = await Promise.all(
    // findPlacements already orders qty DESC — exactly the largest-first
    // order the allocation wants, so no re-sort here.
    lines.map((l) => findPlacements(pool, { item: l.item, color: l.color, size: l.size }))
  );

  return lines.map((l, i) => {
    const placements = placed[i].map((p) => ({ id: p.id, rack_id: p.rack_id, qty: Number(p.qty) }));
    const available = placements.reduce((s, p) => s + p.qty, 0);
    return {
      ...l,
      available,
      shortage: Math.max(0, l.qty - available),
      placements: allocate(placements, l.qty),
    };
  });
}

// POST /api/picklist/resolve — the manual path, and today's only one.
// The user reads a challan off the Vastra app and types its number and lines in
// here; RMS answers where each line is stored. Nothing is persisted: the
// durable record is the audit trail written when the racks are updated.
router.post('/resolve', async (req, res, next) => {
  try {
    const { dcNo, party = '', date = null, lines = [] } = req.body;
    if (!String(dcNo || '').trim()) throw new HttpError(400, 'A challan number is required');
    const rows = await resolveLines(lines);
    if (!rows.length) throw new HttpError(400, 'Add at least one item with a positive quantity');
    res.json({ dcNo: String(dcNo).trim(), party, date, rows, source: 'manual' });
  } catch (err) { next(err); }
});

// GET /api/picklist/:dcNo — the module path. Wired and tested, but Vastra does
// not serve the Delivery Challan module yet, so nothing calls it in anger.
// Left in place so switching over is a UI toggle, not a rewrite.
router.get('/:dcNo', async (req, res, next) => {
  try {
    const dcNo = req.params.dcNo;
    const raw = (await fetchTransactions(req.org, { moduleType: PICK_MODULE_TYPE, q: dcNo }))
      .filter((r) => docNo(r.id) === dcNo);
    if (!raw.length) throw new HttpError(404, `Delivery Challan ${dcNo} not found`);
    res.json({
      dcNo,
      date: raw[0].date ?? null,
      party: raw[0].party ?? '',
      rows: await resolveLines(raw),
      source: 'module',
    });
  } catch (err) { next(err); }
});

// POST /api/picklist/:dcNo/pick — deduct the picked quantities. All-or-nothing.
router.post('/:dcNo/pick', async (req, res, next) => {
  try {
    const picks = (req.body.picks || []).filter((p) => Number(p.qty) > 0);
    if (!picks.length) throw new HttpError(400, 'Nothing to pick');
    const result = await pickItems({
      picks, dcNo: req.params.dcNo, userId: req.org.vastra_org_id,
    });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
