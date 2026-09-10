import { pool } from '../db.js';

const num = (v) => Number(v) || 0;

// One aggregation call powering the whole dashboard, scoped to one
// organization. Every subquery carries fk_org_id: this file is where the
// "every login shows identical stats" bug lived, because none of them did.
export async function getDashboard(orgId) {
  if (!orgId) throw new Error('getDashboard requires an orgId');

  const [[totals]] = await pool.query(`
    SELECT
      (SELECT COALESCE(SUM(qty),0) FROM item_location WHERE fk_org_id = ?)         AS total_items,
      (SELECT COUNT(*) FROM rack_master WHERE fk_org_id = ?)                       AS total_racks,
      (SELECT COUNT(*) FROM rack_master WHERE fk_org_id = ? AND status='Occupied') AS occupied_racks,
      (SELECT COUNT(*) FROM rack_master WHERE fk_org_id = ? AND status='Vacant')   AS vacant_racks,
      (SELECT COALESCE(SUM(capacity),0) FROM rack_master WHERE fk_org_id = ?)      AS total_capacity,
      (SELECT COALESCE(SUM(used),0) FROM rack_master WHERE fk_org_id = ?)          AS total_used
  `, [orgId, orgId, orgId, orgId, orgId, orgId]);

  // Occupancy buckets (display buckets, same thresholds as the UI).
  const [[buckets]] = await pool.query(`
    SELECT
      COALESCE(SUM(used=0),0)                              AS vacant,
      COALESCE(SUM(used>0 AND used < 0.85*capacity),0)     AS partial,
      COALESCE(SUM(used>0 AND used >= 0.85*capacity),0)    AS full
    FROM rack_master WHERE fk_org_id = ?
  `, [orgId]);

  // `action` alone does not mean "stock arrived": creating racks in Rack Setup
  // writes one action='add' row per batch against entity_type='rack'. Without
  // the entity filter a warehouse laid out in two batches reported two items
  // added before a single delivery existed, and the tile disagreed with Item
  // Management for the rest of the day. Same predicate the History page uses.
  const [[today]] = await pool.query(`
    SELECT
      COALESCE(SUM(action='add'  AND DATE(created_at)=CURDATE()),0) AS added_today,
      COALESCE(SUM(action='move' AND DATE(created_at)=CURDATE()),0) AS moved_today
    FROM audit_log WHERE fk_org_id = ? AND entity_type = 'item_location'
  `, [orgId]);

  // Last 7 days of activity (added vs moved), sparse — client fills gaps.
  // Scoped to stock for the same reason as the counters above: a chart that
  // spikes on the day the racks were built is describing furniture, not trade.
  const [trend] = await pool.query(`
    SELECT DATE(created_at) AS day,
           COALESCE(SUM(action='add'),0)  AS added,
           COALESCE(SUM(action='move'),0) AS moved
    FROM audit_log
    WHERE fk_org_id = ? AND entity_type = 'item_location'
      AND created_at >= CURDATE() - INTERVAL 6 DAY
    GROUP BY DATE(created_at) ORDER BY day
  `, [orgId]);

  // Items stored per source module type (NULL = manual entry).
  const [moduleRows] = await pool.query(`
    SELECT COALESCE(module_type, 'Manual') AS module_type, SUM(qty) AS qty
    FROM item_location WHERE fk_org_id = ?
    GROUP BY COALESCE(module_type, 'Manual')
  `, [orgId]);

  // Biggest items by quantity in stock — the Reports "Stock by Item" pie.
  // Capped at 8 to match the chart's colour palette.
  const [topItems] = await pool.query(`
    SELECT item, SUM(qty) AS qty
    FROM item_location WHERE fk_org_id = ?
    GROUP BY item ORDER BY qty DESC LIMIT 8
  `, [orgId]);

  const [recent] = await pool.query(`
    SELECT id, entity_type, entity_id, action, before_json, after_json, user_id, created_at
    FROM audit_log WHERE fk_org_id = ? ORDER BY id DESC LIMIT 8
  `, [orgId]);

  const overallPct = totals.total_capacity > 0
    ? Math.round((num(totals.total_used) / num(totals.total_capacity)) * 100) : 0;

  return {
    stats: {
      totalItems: num(totals.total_items),
      totalRacks: num(totals.total_racks),
      occupiedRacks: num(totals.occupied_racks),
      vacantRacks: num(totals.vacant_racks),
      totalCapacity: num(totals.total_capacity),
      totalUsed: num(totals.total_used),
      overallPct,
      addedToday: num(today.added_today),
      movedToday: num(today.moved_today),
    },
    buckets: { vacant: num(buckets.vacant), partial: num(buckets.partial), full: num(buckets.full) },
    trend: trend.map((r) => ({ day: r.day, added: num(r.added), moved: num(r.moved) })),
    moduleBreakdown: moduleRows.map((r) => ({ moduleType: r.module_type, qty: num(r.qty) })),
    topItems: topItems.map((r) => ({ item: r.item, qty: num(r.qty) })),
    recent,
  };
}
