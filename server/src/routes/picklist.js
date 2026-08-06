import { Router } from 'express';
import { pool } from '../db.js';
import { findPlacements, pickItems, HttpError } from '../services/rackService.js';
import { fetchTransactions } from '../services/sourceModules.js';
import { savePicklist, markRackUpdated, getPicklist } from '../services/picklistStore.js';
import { renderPicklistPdf } from '../services/picklistPdf.js';
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
// The challan itself is NOT recreated here: it already exists in the Vastra
// app. The user transcribes its item details and RMS answers where each line is
// stored. So there is no challan number to supply — `dcNo` stays optional for
// the module tab, which gets one from Vastra for free.
router.post('/resolve', async (req, res, next) => {
  try {
    const { dcNo = null, party = '', date = null, lines = [], picklistId = null } = req.body;
    const rows = await resolveLines(lines);
    if (!rows.length) throw new HttpError(400, 'Add at least one item with a positive quantity');
    // Generating still changes no stock, but it does leave a history entry —
    // that trace is what makes "generated and never acted on" visible later.
    // `picklistId` lets a regenerate update the same entry instead of piling up.
    const id = await savePicklist({
      id: picklistId, dcNo, party, source: 'manual', rows, userId: req.org.vastra_org_id,
    });
    res.json({ id, dcNo: dcNo ? String(dcNo).trim() : null, party, date, rows, source: 'manual' });
  } catch (err) { next(err); }
});

// GET /api/picklist/:id/resolve — re-resolve a STORED picklist against stock as
// it is right now. Powers "Update" from History: the saved `racks` text is a
// snapshot from generation time, and stock may well have moved since, so the
// allocation is recomputed rather than replayed. Read-only.
router.get('/:id/resolve', async (req, res, next) => {
  try {
    const stored = await getPicklist(Number(req.params.id));
    if (!stored) throw new HttpError(404, 'Picklist not found');
    if (stored.rack_updated) throw new HttpError(409, 'This picklist has already updated the racks');

    const rows = await resolveLines(stored.lines);
    // Flag lines whose racks no longer match what the printed sheet said, so
    // whoever is picking knows the paper is out of date.
    const wasRacks = new Map(stored.lines.map((l) => [`${l.item}|${l.color}|${l.size}`, l.racks]));
    const withDrift = rows.map((r) => {
      const now = r.placements.filter((p) => p.suggested > 0)
        .map((p) => `${p.rack_id} x${p.suggested}`).join(', ');
      const before = wasRacks.get(`${r.item}|${r.color}|${r.size}`) ?? '';
      return { ...r, printedRacks: before, moved: before !== now };
    });

    res.json({
      id: stored.id, dcNo: stored.dc_no, party: stored.party,
      created_at: stored.created_at, rows: withDrift, source: 'stored',
    });
  } catch (err) { next(err); }
});

// GET /api/picklist/:id/pdf — the printable sheet. Streams a real PDF so the
// browser's own viewer (and its download button) handles it.
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const picklist = await getPicklist(Number(req.params.id));
    if (!picklist) throw new HttpError(404, 'Picklist not found');
    const name = picklist.dc_no ? `picklist-${picklist.dc_no}` : `picklist-${picklist.id}`;
    res.setHeader('Content-Type', 'application/pdf');
    // `inline` so it opens in the tab rather than downloading straight away.
    res.setHeader('Content-Disposition', `inline; filename="${name.replace(/[^\w.-]/g, '_')}.pdf"`);
    renderPicklistPdf(picklist, req.org.name, res);
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

// POST /api/picklist/pick — deduct the picked quantities. All-or-nothing.
// `dcNo` rides in the body rather than the path because manual entry has no
// challan number to put there; when present it lands in the audit trail.
router.post('/pick', async (req, res, next) => {
  try {
    const picks = (req.body.picks || []).filter((p) => Number(p.qty) > 0);
    if (!picks.length) throw new HttpError(400, 'Nothing to pick');
    const result = await pickItems({
      picks, dcNo: req.body.dcNo || null, userId: req.org.vastra_org_id,
    });
    // Close the history entry. After the stock has moved, so a failed pick
    // never leaves a picklist marked as acted on.
    await markRackUpdated(req.body.picklistId, result.pickedQty);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
