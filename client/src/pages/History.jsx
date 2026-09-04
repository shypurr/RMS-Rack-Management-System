import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { PAGE_SIZE, usePaged } from '../lib/paging.js';
import LoadMore from '../components/LoadMore.jsx';

// What has actually moved through the racks: stock put away, and picklists
// generated. Each half reads from where that flow records itself — putaway from
// the audit trail, picklists from their own table, which is the only thing that
// knows about a picklist that was generated and then never acted on.
//
// Searching, date filtering and paging all happen on the SERVER. This screen
// used to pull the latest 200 records and filter them in the browser, so a
// picklist from two months ago could not be found however precisely you
// searched — and the empty result said "no records match", which reads as "it
// never happened" rather than "I only looked at the newest 200".
//
// The Audit Log tab stays as the raw everything-view; this is the operational
// read of the same history.

// Ten per request, the same as every other list in the portal — and here it is
// ten fetched from the database, not ten drawn out of a larger fetch. See
// lib/paging.js for the rule.
const PAGE = PAGE_SIZE;

// Presets cover the question people actually ask — "what did I pick this week"
// — without making them operate two date pickers to ask it.
const RANGES = [
  { key: '', label: 'All time' },
  { key: '0', label: 'Today' },
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: 'custom', label: 'Custom range…' },
];

const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pad = (n) => String(n).padStart(2, '0');

// A preset resolves to the same {from,to} the custom pickers produce, so the
// server only ever deals in one shape.
function rangeToDates(key, customFrom, customTo) {
  if (key === 'custom') return { from: customFrom || null, to: customTo || null };
  if (!key) return { from: null, to: null };
  const days = Number(key);
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: iso(from), to: iso(to) };
}

export default function History() {
  const toast = useToast();
  const [tab, setTab] = useState('putaway');

  const [query, setQuery] = useState('');
  const [range, setRange] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [status, setStatus] = useState('');       // picklist tab only

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [printingId, setPrintingId] = useState(null);
  const [updating, setUpdating] = useState(null);   // the picklist row being applied

  const { from, to } = rangeToDates(range, customFrom, customTo);

  const fetchPage = useCallback(async (offset) => {
    const params = { q: query, from, to, limit: PAGE, offset };
    if (tab === 'picklist') params.status = status;
    return tab === 'putaway' ? api.historyPutaway(params) : api.historyPicklists(params);
  }, [tab, query, from, to, status]);

  // Debounced so typing does not fire a query per keystroke. Every filter is in
  // the dependency list, so changing any of them starts again from offset 0.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      fetchPage(0)
        .then((res) => { if (alive) { setRows(res.rows); setTotal(res.total); } })
        .catch((e) => { if (alive) { setRows([]); setTotal(0); toast(e.message, 'error'); } })
        .finally(() => { if (alive) setLoading(false); });
    }, query ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [fetchPage]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetchPage(rows.length);
      setRows((rs) => [...rs, ...res.rows]);
      setTotal(res.total);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  // After applying a picklist from here, re-read the page that is on screen so
  // the row flips to "updated" without losing the user's place.
  const reload = async () => {
    try {
      const res = await fetchPage(0);
      setRows(res.rows);
      setTotal(res.total);
    } catch (e) { toast(e.message, 'error'); }
  };

  const openPdf = async (row) => {
    const tabRef = window.open('', '_blank');
    setPrintingId(row.id);
    try {
      const url = await api.picklistPdf(row.id, row.dc_no ? `picklist-${row.dc_no}` : `picklist-${row.id}`);
      if (tabRef) tabRef.location = url; else window.open(url, '_blank');
    } catch (e) {
      tabRef?.close();
      toast(e.message, 'error');
    } finally {
      setPrintingId(null);
    }
  };

  const switchTab = (t) => {
    setTab(t);
    setRows([]); setTotal(0);
    setStatus('');
  };

  const filtered = !!(query || from || to || status);
  const clearFilters = () => {
    setQuery(''); setRange(''); setCustomFrom(''); setCustomTo(''); setStatus('');
  };

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
            <div className={`tab-btn ${tab === 'putaway' ? 'active' : ''}`} onClick={() => switchTab('putaway')}>
              Putaway
            </div>
            <div className={`tab-btn ${tab === 'picklist' ? 'active' : ''}`} onClick={() => switchTab('picklist')}>
              Picklist
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-3 flex-wrap mb-3">
            <div className="input-group" style={{ flex: 1, minWidth: 220 }}>
              <span className="input-icon"><i className="fa-solid fa-search" /></span>
              <input className="form-control" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === 'putaway'
                  ? 'Search item, colour, size, rack or module code…'
                  : 'Search challan no, #id, item, colour or size…'} />
            </div>

            <select className="form-control" style={{ width: 'auto' }}
              value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>

            {range === 'custom' && (
              <>
                <input type="date" className="form-control" style={{ width: 'auto' }}
                  value={customFrom} max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)} title="From" />
                <input type="date" className="form-control" style={{ width: 'auto' }}
                  value={customTo} min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)} title="To" />
              </>
            )}

            {tab === 'picklist' && (
              <select className="form-control" style={{ width: 'auto' }}
                value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Taken out or not</option>
                <option value="pending">Not taken out yet</option>
                <option value="updated">Already taken out</option>
              </select>
            )}

            {filtered && (
              <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
                <i className="fa-solid fa-xmark" />&nbsp; Clear
              </button>
            )}
          </div>

          {/* Saying what is on screen out of what matched is the whole point of
              paging server-side — the old screen could not tell you. */}
          {!loading && (
            <p className="text-xs text-muted mb-3">
              {total === 0
                ? 'Nothing matches these filters.'
                : `Showing ${rows.length} of ${total.toLocaleString()}${filtered ? ' matching' : ''} record${total === 1 ? '' : 's'}.`}
            </p>
          )}

          {loading && <p className="text-muted">Loading…</p>}

          {!loading && !rows.length && (
            <div className="empty-state">
              <i className="fa-solid fa-clock-rotate-left" />
              <h3>Nothing here yet</h3>
              <p>{filtered ? 'No records match these filters.' : tab === 'putaway'
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
                  {rows.map((r) => (
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
                  <tr>
                    <th style={{ width: 30 }} />
                    <th>When</th><th>Challan No</th><th>What was picked</th><th>Different items</th>
                    <th>Total quantity</th><th>Racks updated</th><th>By</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <PicklistRow
                      key={r.id} row={r}
                      printing={printingId === r.id}
                      onPdf={() => openPdf(r)}
                      onUpdate={() => setUpdating(r)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && rows.length < total && (
            <button className="btn btn-outline mt-4" onClick={loadMore} disabled={loadingMore}>
              <i className={`fa-solid ${loadingMore ? 'fa-spinner fa-spin' : 'fa-chevron-down'}`} />
              &nbsp; {loadingMore ? 'Loading…' : `Load ${Math.min(PAGE, total - rows.length)} more`}
            </button>
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

// One picklist, expandable to the lines it was generated with. The lines are
// fetched on demand rather than with the list: most rows are never opened, and
// a page of 50 picklists would otherwise drag several hundred lines with it.
function PicklistRow({ row, printing, onPdf, onUpdate }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const linePage = usePaged(detail?.lines, { resetKey: row.id });

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (detail) return;                     // already fetched once
    setLoading(true);
    try {
      setDetail(await api.historyPicklist(row.id));
    } catch (e) {
      toast(e.message, 'error');
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <tr className={open ? 'row-open' : undefined}>
        <td>
          <button className="btn btn-ghost btn-sm" onClick={toggle}
            title={open ? 'Hide items' : 'Show items'} aria-expanded={open}>
            <i className={`fa-solid ${open ? 'fa-chevron-down' : 'fa-chevron-right'}`} />
          </button>
        </td>
        <td className="text-muted text-xs">{fmt(row.created_at)}</td>
        <td className="font-600">{row.dc_no || <span className="text-muted">#{row.id}</span>}</td>
        {/* Without a challan number this column is what identifies the
            picklist, so it is shown, not just searchable. */}
        <td className="text-xs">
          {row.items?.length
            ? <span title={row.items.join(', ')}>
                {row.items.slice(0, 3).join(', ')}
                {row.items.length > 3 && <span className="text-muted"> +{row.items.length - 3} more</span>}
              </span>
            : <span className="text-muted">—</span>}
        </td>
        <td>{row.lines}</td>
        <td>
          {row.total_qty}
          {row.short_qty > 0 && <>&nbsp; <span className="badge badge-danger">{row.short_qty} not in stock</span></>}
        </td>
        <td>
          {/* The point of this column: a picklist generated and never acted on
              is where a stock discrepancy hides. */}
          {row.rack_updated
            ? <span className="badge badge-success">Yes · {row.picked_qty} taken</span>
            : <span className="badge badge-warning">Not yet</span>}
        </td>
        <td className="text-xs text-muted">{row.user_id}</td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          {/* Only an un-actioned picklist can still be applied. */}
          {!row.rack_updated && (
            <button className="btn btn-outline btn-sm" onClick={onUpdate}>
              <i className="fa-solid fa-boxes-packing" /> Update
            </button>
          )}
          &nbsp;
          <button className="btn btn-ghost btn-sm" title="Open the printable PDF"
            disabled={printing} onClick={onPdf}>
            <i className={`fa-solid ${printing ? 'fa-spinner fa-spin' : 'fa-file-pdf'}`} />
          </button>
        </td>
      </tr>

      {open && (
        <tr className="row-detail">
          <td colSpan={9}>
            {loading && <p className="text-muted text-sm">Loading items…</p>}
            {detail && (
              <>
                <table className="data-table nested-table">
                  <thead>
                    <tr><th>Item</th><th>Color</th><th>Size</th><th>Quantity</th><th>Racks it came from</th></tr>
                  </thead>
                  <tbody>
                    {linePage.visible.map((l, i) => (
                      <tr key={i}>
                        <td className="font-600">{l.item}</td>
                        <td>{l.color || '—'}</td>
                        <td>{l.size || '—'}</td>
                        <td>
                          {l.qty}
                          {l.shortage > 0 && <>&nbsp; <span className="badge badge-danger">{l.shortage} not in stock</span></>}
                        </td>
                        <td className="text-xs">
                          {l.racks || <span className="text-muted">not in any rack at the time</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <LoadMore {...linePage} noun="items" onMore={linePage.loadMore} quiet />
                <p className="text-xs text-muted mt-2">
                  These are the items as recorded when the picklist was made
                  {detail.rack_updated && detail.picked_at ? `, picked ${fmt(detail.picked_at)}` : ''}.
                  {' '}Stock may have moved racks since.
                </p>
              </>
            )}
          </td>
        </tr>
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
      if (short.length) toast(`Not enough stock for ${short.length} item(s): ${short.map((r) => r.item).join(', ')}`, 'warning');
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
                          {r.shortage > 0 && <>&nbsp; <span className="badge badge-danger">{r.shortage} not in stock</span></>}
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
            {over ? 'One of the quantities is more than that rack actually holds.' : `${total} item${total === 1 ? '' : 's'} will be taken out of the racks.`}
          </span>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={confirm} disabled={!detail || saving || !total || over}>
            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-check'}`} />
            &nbsp; {saving ? 'Taking out…' : 'Confirm — take out of racks'}
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
