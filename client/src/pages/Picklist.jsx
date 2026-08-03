import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';

// Outbound counterpart of Add Item: pick a Delivery Challan, see every line it
// asks for, then find out which rack each item sits in.
//
// Two deliberate steps. "Generate Picklist" only READS — a picker can generate
// the same challan all day without touching stock. "Update Rack" is the one
// that deducts, and only what is in the qty boxes.
export default function Picklist() {
  const toast = useToast();
  const [dc, setDc] = useState(null);          // { id, date, party, lines, qty }
  const [detail, setDetail] = useState(null);  // { dcNo, party, date, rows: [...] }
  const [alloc, setAlloc] = useState({});      // { [placementId]: qty } — the editable boxes
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dcResetKey, setDcResetKey] = useState(0);

  const clearPicklist = () => { setDetail(null); setAlloc({}); };

  const generate = async (dcNo = dc?.id) => {
    if (!dcNo) return;
    setLoading(true);
    try {
      const res = await api.picklist(dcNo);
      setDetail(res);
      // Seed the boxes from the server's largest-rack-first suggestion.
      const next = {};
      for (const r of res.rows) for (const p of r.placements) next[p.id] = p.suggested;
      setAlloc(next);
    } catch (e) {
      toast(e.message, 'error');
      clearPicklist();
    } finally {
      setLoading(false);
    }
  };

  const pickedFor = (row) => row.placements.reduce((s, p) => s + (Number(alloc[p.id]) || 0), 0);
  const totalPicked = detail ? detail.rows.reduce((s, r) => s + pickedFor(r), 0) : 0;
  const overAllocated = detail
    ? detail.rows.some((r) => r.placements.some((p) => (Number(alloc[p.id]) || 0) > p.qty) || pickedFor(r) > r.qty)
    : false;

  const updateRack = async () => {
    const picks = Object.entries(alloc)
      .map(([id, qty]) => ({ itemLocationId: Number(id), qty: Number(qty) || 0 }))
      .filter((p) => p.qty > 0);
    if (!picks.length) return toast('Nothing allocated to pick', 'warning');

    setSaving(true);
    try {
      const res = await api.pickItems(detail.dcNo, picks);
      toast(`${res.pickedQty} units picked for ${detail.dcNo} across ${res.racks.length} rack(s)`, 'success');
      const short = detail.rows.filter((r) => r.shortage > 0);
      if (short.length) {
        toast(`${short.length} line(s) still short: ${short.map((r) => r.item).join(', ')}`, 'warning');
      }
      await generate(detail.dcNo); // re-read so the rack quantities on screen are live
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const totals = detail
    ? detail.rows.reduce(
        (a, r) => ({ qty: a.qty + r.qty, available: a.available + r.available, short: a.short + r.shortage }),
        { qty: 0, available: 0, short: 0 }
      )
    : null;

  return (
    <>
      <div className="breadcrumb-bar"><span>Picklist</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Picklist</h1>
          <p className="page-subtitle">Pick stock against a Delivery Challan — find the racks, then update them</p>
        </div>
      </div>

      <div className="grid gap-col-6" style={{ gridTemplateColumns: '1fr 340px', alignItems: 'start' }}>
        <div>
          {/* Step 1 — challan (overflow:visible so the dropdown isn't clipped by the card) */}
          <div className="card mb-4" style={{ overflow: 'visible' }}>
            <div className="card-header"><span className="card-title"><i className="fa-solid fa-file-invoice text-primary-color" />&nbsp; Step 1 — Delivery Challan</span></div>
            <div className="card-body">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Challan No <span className="required">*</span></label>
                <DcCombobox
                  key={dcResetKey}
                  onSelect={(d) => { setDc(d); clearPicklist(); }}
                  onClear={() => { setDc(null); clearPicklist(); }}
                />
                <p className="text-xs text-muted mt-1">Latest challans are listed on focus — type a challan no. to search all of them.</p>
              </div>
            </div>
          </div>

          {/* Step 2 — the challan's lines, auto-filled */}
          <div className="card">
            <div className="card-header">
              <span className="card-title"><i className="fa-solid fa-list text-primary-color" />&nbsp; Step 2 — Challan Details</span>
              {dc && <span className="badge badge-ghost">{dc.lines} line{dc.lines > 1 ? 's' : ''}</span>}
            </div>
            <div className="card-body">
              {!dc && <p className="text-muted">Select a delivery challan above to load its items.</p>}
              {dc && (
                <>
                  <div className="data-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr><th>Challan No</th><th>Party</th><th>Date</th><th>Lines</th><th>Total Qty</th></tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="font-700 text-primary-color">{dc.id}</td>
                          <td>{dc.party || '—'}</td>
                          <td>{fmtDate(dc.date)}</td>
                          <td>{dc.lines}</td>
                          <td>{dc.qty}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <button className="btn btn-primary mt-4" onClick={() => generate()} disabled={loading}>
                    <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-clipboard-list'}`} />
                    &nbsp; {loading ? 'Generating…' : 'Generate Picklist'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right summary */}
        <div>
          <div className="card">
            <div className="card-header"><span className="card-title">Summary</span></div>
            <div className="card-body">
              <SummaryRow label="Challan No" value={dc?.id || '—'} />
              <SummaryRow label="Party" value={dc?.party || '—'} />
              <SummaryRow label="Date" value={fmtDate(dc?.date)} />
              <hr className="divider" />
              <SummaryRow label="Lines" value={detail ? detail.rows.length : dc?.lines ?? '—'} />
              <SummaryRow label="Total qty" value={totals ? totals.qty : '—'} />
              <SummaryRow label="In racks" value={totals ? totals.available : '—'} />
              <SummaryRow label="Short" value={totals ? totals.short : '—'} />
              <hr className="divider" />
              <SummaryRow label="Allocated" value={detail ? totalPicked : '—'} />
            </div>
          </div>
        </div>

        {/* Picklist — full width below both columns; the rack column needs the room */}
        {detail && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <span className="card-title"><i className="fa-solid fa-clipboard-list text-primary-color" />&nbsp; Picklist — {detail.dcNo}</span>
              <span className="badge badge-primary">{totalPicked} of {totals.qty} allocated</span>
            </div>
            <div className="card-body">
              <div className="data-table-wrap">
                <table className="data-table picklist-table">
                  <thead>
                    <tr>
                      <th>Item / Design</th><th>Color</th><th>Size</th><th>Qty</th><th style={{ minWidth: 280 }}>Rack</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.rows.map((r, i) => {
                      const picked = pickedFor(r);
                      return (
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
                                <input
                                  className="form-control pick-qty"
                                  type="number" min="0" max={p.qty}
                                  value={alloc[p.id] ?? 0}
                                  onChange={(e) => setAlloc({ ...alloc, [p.id]: clamp(e.target.value, p.qty) })}
                                />
                                <span className="text-xs text-muted">of {p.qty} in stock</span>
                              </div>
                            ))}
                            {r.placements.length > 0 && (
                              <div className={`text-xs mt-1 ${picked === r.qty ? 'text-muted' : 'text-danger'}`}>
                                picked {picked} / {r.qty}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-3 mt-4">
                <button className="btn btn-primary" onClick={updateRack} disabled={saving || !totalPicked || overAllocated}>
                  <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-boxes-packing'}`} />
                  &nbsp; {saving ? 'Updating…' : 'Update Rack'}
                </button>
                <span className="text-sm text-muted">
                  {overAllocated
                    ? 'A quantity exceeds what that rack holds.'
                    : 'Generating changed nothing — this button deducts the quantities above from the racks.'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// Keep a box within [0, that rack's stock]; a cleared box reads as 0, not NaN.
function clamp(v, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');

// Searchable challan picker: open (empty) shows the latest 10; typing a challan
// no. searches all of them server-side. Same UX as AddItem's TxnCombobox.
function DcCombobox({ onSelect, onClear }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(false);
  const blurTimer = useRef(null);

  // Debounced fetch: latest 10 when empty, matches when typing. Skip while a
  // selection is showing (query holds the picked id, not a search term).
  useEffect(() => {
    if (picked) return;
    const t = setTimeout(() => {
      api.challans(query.trim(), 10).then(setResults).catch(() => setResults([]));
    }, query.trim() ? 200 : 0);
    return () => clearTimeout(t);
  }, [query, picked]);

  const choose = (d) => {
    setPicked(true);
    setQuery(d.id);
    setOpen(false);
    onSelect(d);
  };

  const onType = (v) => {
    if (picked) { setPicked(false); onClear(); } // editing clears the prior pick
    setQuery(v);
    setOpen(true);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="form-control"
        placeholder="Search challan no (e.g. DC-2026-0007)…"
        value={query}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => { clearTimeout(blurTimer.current); setOpen(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
      />
      {open && results.length > 0 && (
        <div className="txn-dropdown">
          {results.map((d) => (
            <div key={d.id} className="txn-option" onMouseDown={() => choose(d)}>
              <span className="font-600 text-primary-color">{d.id}</span>
              <span className="text-sm text-muted">
                &nbsp; {d.party || 'No party'} · {d.lines} item{d.lines > 1 ? 's' : ''} · {fmtDate(d.date)}
              </span>
            </div>
          ))}
        </div>
      )}
      {open && results.length === 0 && (
        <div className="txn-dropdown"><div className="txn-option text-muted">No matching challans</div></div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
      <span className="text-sm text-muted">{label}</span>
      <span className="font-600 text-sm truncate" style={{ maxWidth: 180 }}>{value}</span>
    </div>
  );
}
