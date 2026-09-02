import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { matches } from '../lib/items.js';

// What has actually moved through the racks: stock put away, and picklists
// generated. Each half reads from where that flow records itself — putaway from
// the audit trail, picklists from their own table, which is the only thing that
// knows about a picklist that was generated and then never acted on.
//
// The Audit Log tab stays as the raw everything-view; this is the operational
// read of the same history.
export default function History() {
  const toast = useToast();
  const [tab, setTab] = useState('putaway');
  const [putaway, setPutaway] = useState([]);
  const [picklists, setPicklists] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [printingId, setPrintingId] = useState(null);
  const [updating, setUpdating] = useState(null);   // the picklist row being applied

  const reload = () =>
    api.historyPicklists(200).then(setPicklists).catch((e) => toast(e.message, 'error'));

  useEffect(() => {
    setLoading(true);
    Promise.all([api.historyPutaway(200), api.historyPicklists(200)])
      .then(([p, l]) => { setPutaway(p); setPicklists(l); })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, []);

  const shownPutaway = useMemo(
    () => putaway.filter((r) => matches(`${r.item} ${r.color} ${r.size} ${r.rack_id} ${r.module_id || ''} ${r.module_type || ''} ${r.user_id}`, query)),
    [putaway, query]
  );
  // The item names are in the haystack because the challan no is optional: a
  // picklist entered without one has no other handle on it, so searching by
  // what was picked is the only way back to it. `#id` matches too, since that
  // is what the table shows in place of a missing challan number.
  const shownPicklists = useMemo(
    () => picklists.filter((r) => matches(
      `${r.dc_no || ''} #${r.id} ${r.party || ''} ${(r.items || []).join(' ')} ${r.user_id} ${r.rack_updated ? 'updated' : 'not updated pending'}`,
      query
    )),
    [picklists, query]
  );

  const openPdf = async (row) => {
    const tab = window.open('', '_blank');
    setPrintingId(row.id);
    try {
      const url = await api.picklistPdf(row.id, row.dc_no ? `picklist-${row.dc_no}` : `picklist-${row.id}`);
      if (tab) tab.location = url; else window.open(url, '_blank');
    } catch (e) {
      tab?.close();
      toast(e.message, 'error');
    } finally {
      setPrintingId(null);
    }
  };

  const rows = tab === 'putaway' ? shownPutaway : shownPicklists;
  const notUpdated = picklists.filter((p) => !p.rack_updated).length;

  return (
    <>
      <div className="breadcrumb-bar"><span>History</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">History</h1>
          <p className="page-subtitle">Stock put away and picklists generated</p>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="tab-bar">
            <div className={`tab-btn ${tab === 'putaway' ? 'active' : ''}`} onClick={() => setTab('putaway')}>
              Putaway <span className="text-muted">({putaway.length})</span>
            </div>
            <div className={`tab-btn ${tab === 'picklist' ? 'active' : ''}`} onClick={() => setTab('picklist')}>
              Picklist <span className="text-muted">({picklists.length})</span>
            </div>
          </div>

          <div className="input-group mb-3">
            <span className="input-icon"><i className="fa-solid fa-search" /></span>
            <input className="form-control" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'putaway'
                ? 'Search item, colour, size, rack or module code…'
                : 'Search challan no, #id, party, item name, or "not updated"…'} />
          </div>

          {tab === 'picklist' && notUpdated > 0 && !query && (
            <p className="text-xs text-muted mb-3">
              <i className="fa-solid fa-circle-info" />&nbsp;
              {notUpdated} picklist{notUpdated > 1 ? 's were' : ' was'} generated without the racks being
              updated. Search <span className="font-600">not updated</span> to see just those.
            </p>
          )}

          {loading && <p className="text-muted">Loading…</p>}

          {!loading && !rows.length && (
            <div className="empty-state">
              <i className="fa-solid fa-clock-rotate-left" />
              <h3>Nothing here yet</h3>
              <p>{query ? 'No records match that search.' : tab === 'putaway'
                ? 'Stock added through Putaway will show up here.'
                : 'Picklists appear here as soon as one is generated.'}</p>
            </div>
          )}

          {!loading && rows.length > 0 && tab === 'putaway' && (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>When</th><th>Item</th><th>Color</th><th>Size</th><th>Added</th><th>Rack</th><th>Source</th><th>By</th></tr>
                </thead>
                <tbody>
                  {shownPutaway.map((r) => (
                    <tr key={r.id}>
                      <td className="text-muted text-xs">{fmt(r.created_at)}</td>
                      <td className="font-600">{r.item}</td>
                      <td>{r.color || '—'}</td>
                      <td>{r.size || '—'}</td>
                      <td>
                        <span className="text-success font-700">+{r.qty}</span>
                        {r.merged && <span className="text-xs text-muted">&nbsp; (rack held {r.rack_qty} after)</span>}
                      </td>
                      <td className="font-600 text-primary-color">{r.rack_id}</td>
                      <td className="text-xs">{r.module_id
                        ? <>{r.module_id}<span className="text-muted"> · {r.module_type}</span></>
                        : <span className="text-muted">Manual</span>}</td>
                      <td className="text-xs text-muted">{r.user_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && rows.length > 0 && tab === 'picklist' && (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>When</th><th>Challan No</th><th>Items</th><th>Party</th><th>Lines</th><th>Qty</th><th>Rack updated</th><th>By</th><th /></tr>
                </thead>
                <tbody>
                  {shownPicklists.map((r) => (
                    <tr key={r.id}>
                      <td className="text-muted text-xs">{fmt(r.created_at)}</td>
                      <td className="font-600">{r.dc_no || <span className="text-muted">#{r.id}</span>}</td>
                      {/* Without a challan number this column is what identifies
                          the picklist, so it is shown, not just searchable. */}
                      <td className="text-xs">
                        {r.items?.length
                          ? <span title={r.items.join(', ')}>
                              {r.items.slice(0, 3).join(', ')}
                              {r.items.length > 3 && <span className="text-muted"> +{r.items.length - 3} more</span>}
                            </span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td>{r.party || '—'}</td>
                      <td>{r.lines}</td>
                      <td>
                        {r.total_qty}
                        {r.short_qty > 0 && <>&nbsp; <span className="badge badge-danger">short {r.short_qty}</span></>}
                      </td>
                      <td>
                        {/* The point of this column: a picklist generated and
                            never acted on is where a stock discrepancy hides. */}
                        {r.rack_updated
                          ? <span className="badge badge-success">true · {r.picked_qty} picked</span>
                          : <span className="badge badge-warning">false</span>}
                      </td>
                      <td className="text-xs text-muted">{r.user_id}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {/* Only an un-actioned picklist can still be applied. */}
                        {!r.rack_updated && (
                          <button className="btn btn-outline btn-sm" onClick={() => setUpdating(r)}>
                            <i className="fa-solid fa-boxes-packing" /> Update
                          </button>
                        )}
                        &nbsp;
                        <button className="btn btn-ghost btn-sm" title="Open the printable PDF"
                          disabled={printingId === r.id} onClick={() => openPdf(r)}>
                          <i className={`fa-solid ${printingId === r.id ? 'fa-spinner fa-spin' : 'fa-file-pdf'}`} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {updating && (
        <UpdateRackModal
          row={updating}
          onClose={() => setUpdating(null)}
          onDone={() => { setUpdating(null); reload(); }}
        />
      )}
    </>
  );
}

// Applies a picklist that was generated but never acted on. The saved rack
// allocation is a snapshot from generation time, so it is recomputed against
// stock as it is now — and any line whose racks have shifted since the sheet
// was printed is called out, because the picker is holding that paper.
function UpdateRackModal({ row, onClose, onDone }) {
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [alloc, setAlloc] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.reresolvePicklist(row.id)
      .then((res) => {
        setDetail(res);
        const next = {};
        for (const r of res.rows) for (const p of r.placements) next[p.id] = p.suggested;
        setAlloc(next);
      })
      .catch((e) => setError(e.message));
  }, [row.id]);

  const pickedFor = (r) => r.placements.reduce((s, p) => s + (Number(alloc[p.id]) || 0), 0);
  const total = detail ? detail.rows.reduce((s, r) => s + pickedFor(r), 0) : 0;
  const moved = detail ? detail.rows.filter((r) => r.moved).length : 0;
  const over = detail
    ? detail.rows.some((r) => r.placements.some((p) => (Number(alloc[p.id]) || 0) > p.qty) || pickedFor(r) > r.qty)
    : false;

  const confirm = async () => {
    const picks = Object.entries(alloc)
      .map(([id, qty]) => ({ itemLocationId: Number(id), qty: Number(qty) || 0 }))
      .filter((p) => p.qty > 0);
    if (!picks.length) return toast('Nothing allocated to pick', 'warning');
    setSaving(true);
    try {
      const res = await api.pickItems(detail.dcNo, picks, detail.id);
      toast(`${res.pickedQty} units picked across ${res.racks.length} rack(s)`, 'success');
      const short = detail.rows.filter((r) => r.shortage > 0);
      if (short.length) toast(`${short.length} line(s) short: ${short.map((r) => r.item).join(', ')}`, 'warning');
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 820 }}>
        <div className="modal-header">
          <h2 className="modal-title">
            Update racks — {row.dc_no || `picklist #${row.id}`}
            <span className="text-xs text-muted font-600">&nbsp; generated {fmt(row.created_at)}</span>
          </h2>
          <div className="modal-close" onClick={onClose}><i className="fa-solid fa-xmark" /></div>
        </div>

        <div className="modal-body">
          {error && <p className="text-danger">{error}</p>}
          {!detail && !error && <p className="text-muted">Checking current stock…</p>}

          {detail && (
            <>
              {moved > 0 && (
                <p className="text-xs mb-3" style={{ color: 'var(--warning)' }}>
                  <i className="fa-solid fa-triangle-exclamation" />&nbsp;
                  Stock has moved since this was printed — {moved} line{moved > 1 ? 's' : ''} now
                  {moved > 1 ? ' resolve' : ' resolves'} to different racks. Check against the sheet before picking.
                </p>
              )}
              <div className="data-table-wrap">
                <table className="data-table picklist-table">
                  <thead>
                    <tr><th>Item / Design</th><th>Color</th><th>Size</th><th>Qty</th><th style={{ minWidth: 240 }}>Rack</th></tr>
                  </thead>
                  <tbody>
                    {detail.rows.map((r, i) => (
                      <tr key={`${r.item}|${r.color}|${r.size}|${i}`}>
                        <td className="font-600">{r.item}</td>
                        <td>{r.color || '—'}</td>
                        <td>{r.size || '—'}</td>
                        <td>
                          {r.qty}
                          {r.shortage > 0 && <>&nbsp; <span className="badge badge-danger">short by {r.shortage}</span></>}
                        </td>
                        <td>
                          {!r.placements.length && <span className="text-muted">Not in any rack</span>}
                          {r.placements.map((p) => (
                            <div key={p.id} className="pick-rack">
                              <span className="font-600 text-primary-color">{p.rack_id}</span>
                              <input className="form-control pick-qty" type="number" min="0" max={p.qty}
                                value={alloc[p.id] ?? 0}
                                onChange={(e) => setAlloc({ ...alloc, [p.id]: clamp(e.target.value, p.qty) })} />
                              <span className="text-xs text-muted">of {p.qty}</span>
                            </div>
                          ))}
                          {r.moved && r.printedRacks && (
                            <div className="text-xs mt-1" style={{ color: 'var(--warning)' }}>
                              sheet said: {r.printedRacks || 'nothing'}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <span className="text-sm text-muted" style={{ marginRight: 'auto' }}>
            {over ? 'A quantity exceeds what that rack holds.' : `${total} unit${total === 1 ? '' : 's'} will be deducted.`}
          </span>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={confirm} disabled={!detail || saving || !total || over}>
            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-check'}`} />
            &nbsp; {saving ? 'Updating…' : 'Confirm — update racks'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Keep a box within [0, that rack's stock]; a cleared box reads as 0, not NaN.
function clamp(v, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

const fmt = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
