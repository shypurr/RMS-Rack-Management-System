import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';

// Outbound counterpart of Add Item: work through a Delivery Challan and find
// out which rack each item on it is sitting in.
//
// Today the challan is typed in by hand — the user reads it off the Vastra app
// and enters the number and its lines here. Vastra does not serve a Delivery
// Challan module yet; when it does, the "From Vastra Module" tab takes over and
// nothing else about this page changes.
//
// Two deliberate steps either way. "Generate Picklist" only READS. "Update
// Rack" is the one that deducts, and only what is in the qty boxes.

const EMPTY_DRAFT = { item: '', color: '', sizeQty: {}, freeSize: '', freeQty: '' };

export default function Picklist() {
  const toast = useToast();
  const [mode, setMode] = useState('manual'); // 'manual' | 'module'

  // Challan header + the lines making it up.
  const [dcNo, setDcNo] = useState('');
  const [party, setParty] = useState('');
  const [date, setDate] = useState('');
  const [lines, setLines] = useState([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const [stock, setStock] = useState([]);
  const [detail, setDetail] = useState(null);
  const [alloc, setAlloc] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Typed item/colour/size text has to match the stored stock exactly for a
  // rack lookup to hit, so every field is backed by what is actually in the
  // racks rather than left as free text with no safety net.
  useEffect(() => { api.listItems().then(setStock).catch((e) => toast(e.message, 'error')); }, []);

  const catalog = useMemo(() => {
    const byItem = new Map();
    for (const r of stock) {
      const colors = byItem.get(r.item) || new Map();
      const sizes = colors.get(r.color || '') || new Map();
      sizes.set(r.size || '', (sizes.get(r.size || '') || 0) + Number(r.qty || 0));
      colors.set(r.color || '', sizes);
      byItem.set(r.item, colors);
    }
    return byItem;
  }, [stock]);

  const itemNames = useMemo(() => [...catalog.keys()].sort(), [catalog]);
  const draftColors = useMemo(
    () => [...(catalog.get(draft.item)?.keys() ?? [])].sort(),
    [catalog, draft.item]
  );
  const draftSizes = useMemo(() => {
    const sizes = catalog.get(draft.item)?.get(draft.color);
    return sizes ? [...sizes.entries()].sort((a, b) => sizeKey(a[0]) - sizeKey(b[0]) || a[0].localeCompare(b[0])) : [];
  }, [catalog, draft.item, draft.color]);

  // Any edit to the challan invalidates a picklist generated from the old one.
  const clearPicklist = () => { setDetail(null); setAlloc({}); };
  const editLines = (next) => { setLines(next); clearPicklist(); };

  const addDraft = () => {
    if (!draft.item.trim()) return toast('Pick an item first', 'warning');
    const added = draftSizes.length
      ? draftSizes
          .map(([size]) => ({ size, qty: Number(draft.sizeQty[size]) || 0 }))
          .filter((s) => s.qty > 0)
          .map((s) => ({ item: draft.item.trim(), color: draft.color, size: s.size, qty: s.qty }))
      : [{ item: draft.item.trim(), color: draft.color.trim(), size: draft.freeSize.trim(), qty: Number(draft.freeQty) || 0 }]
          .filter((l) => l.qty > 0);

    if (!added.length) return toast('Enter a quantity against at least one size', 'warning');
    editLines([...lines, ...added]);
    setDraft(EMPTY_DRAFT);
  };

  const generate = async (dc = dcNo) => {
    setLoading(true);
    try {
      const res = mode === 'manual'
        ? await api.resolvePicklist({ dcNo: dc, party, date: date || null, lines })
        : await api.picklist(dc);
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
      setStock(await api.listItems());   // the catalogue's availability just changed
      await generate(detail.dcNo);        // re-read so the rack quantities on screen are live
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const lineTotal = lines.reduce((s, l) => s + l.qty, 0);
  const totals = detail
    ? detail.rows.reduce(
        (a, r) => ({ qty: a.qty + r.qty, available: a.available + r.available, short: a.short + r.shortage }),
        { qty: 0, available: 0, short: 0 }
      )
    : null;
  const canGenerate = mode === 'manual' ? !!dcNo.trim() && lines.length > 0 : !!dcNo.trim();

  const switchMode = (m) => {
    setMode(m);
    setDcNo(''); setParty(''); setDate('');
    setLines([]); setDraft(EMPTY_DRAFT);
    clearPicklist();
  };

  return (
    <>
      <div className="breadcrumb-bar"><span>Picklist</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Picklist</h1>
          <p className="page-subtitle">Enter a Delivery Challan and find the racks to pick it from</p>
        </div>
      </div>

      <div className="grid gap-col-6" style={{ gridTemplateColumns: '1fr 340px', alignItems: 'start' }}>
        <div>
          {/* Step 1 — the challan itself (overflow:visible so the module dropdown isn't clipped) */}
          <div className="card mb-4" style={{ overflow: 'visible' }}>
            <div className="card-header"><span className="card-title"><i className="fa-solid fa-file-invoice text-primary-color" />&nbsp; Step 1 — Delivery Challan</span></div>
            <div className="card-body">
              <div className="tab-bar">
                <div className={`tab-btn ${mode === 'manual' ? 'active' : ''}`} onClick={() => switchMode('manual')}>Manual Entry</div>
                <div className={`tab-btn ${mode === 'module' ? 'active' : ''}`} onClick={() => switchMode('module')}>From Vastra Module</div>
              </div>

              {mode === 'manual' && (
                <>
                  <div className="grid cols-3 gap-col-4">
                    <Field label="Challan No" required value={dcNo} placeholder="e.g. DC-5044"
                      onChange={(v) => { setDcNo(v); clearPicklist(); }} />
                    <Field label="Party" value={party} placeholder="optional" onChange={setParty} />
                    <Field label="Date" type="date" value={date} onChange={setDate} />
                  </div>
                  <p className="text-xs text-muted">
                    Read these off the challan in the Vastra app. The Delivery Challan API isn&apos;t available
                    yet — once it is, the other tab fills this in automatically.
                  </p>
                </>
              )}

              {mode === 'module' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Challan No <span className="required">*</span></label>
                  <DcCombobox onSelect={(d) => { setDcNo(d.id); setParty(d.party || ''); clearPicklist(); }}
                    onClear={() => { setDcNo(''); clearPicklist(); }} />
                  <p className="text-xs text-muted mt-1">
                    Reads delivery challans straight from Vastra. Not serving this module yet — use Manual Entry.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Step 2 — the lines. A challan lists one design across a run of sizes,
              so a design is entered once and its sizes filled in together. */}
          {mode === 'manual' && (
            <div className="card mb-4">
              <div className="card-header"><span className="card-title"><i className="fa-solid fa-list text-primary-color" />&nbsp; Step 2 — Items on the Challan</span></div>
              <div className="card-body">
                <div className="grid cols-2 gap-col-4">
                  <div className="form-group">
                    <label className="form-label">Item / Design <span className="required">*</span></label>
                    <input className="form-control" list="pick-items" placeholder="Start typing an item name…"
                      value={draft.item}
                      onChange={(e) => setDraft({ ...EMPTY_DRAFT, item: e.target.value })} />
                    <datalist id="pick-items">
                      {itemNames.map((n) => <option key={n} value={n} />)}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Color</label>
                    {draftColors.length > 0 ? (
                      <select className="form-control" value={draft.color}
                        onChange={(e) => setDraft({ ...draft, color: e.target.value, sizeQty: {} })}>
                        <option value="">Select a color…</option>
                        {draftColors.map((c) => <option key={c} value={c}>{c || '(no color)'}</option>)}
                      </select>
                    ) : (
                      <input className="form-control" placeholder="Color" value={draft.color}
                        onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
                    )}
                  </div>
                </div>

                {/* The size run — the shape a challan actually takes */}
                {draftSizes.length > 0 && (
                  <>
                    <label className="form-label">Quantity per size</label>
                    <div className="size-run mb-3">
                      {draftSizes.map(([size, have]) => (
                        <div key={size} className="size-cell">
                          <div className="size-cell-label">{size || '(no size)'}</div>
                          <input className="form-control" type="number" min="0" placeholder="0"
                            value={draft.sizeQty[size] ?? ''}
                            onChange={(e) => setDraft({ ...draft, sizeQty: { ...draft.sizeQty, [size]: e.target.value } })} />
                          <div className="size-cell-stock">{have} in stock</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Nothing in stock matches — take it anyway, it'll flag as short */}
                {draft.item && draftSizes.length === 0 && (
                  <div className="grid cols-2 gap-col-4">
                    <Field label="Size" value={draft.freeSize} onChange={(v) => setDraft({ ...draft, freeSize: v })} />
                    <Field label="Quantity" type="number" value={draft.freeQty} onChange={(v) => setDraft({ ...draft, freeQty: v })} />
                  </div>
                )}
                {draft.item && draftSizes.length === 0 && !catalog.has(draft.item) && (
                  <p className="text-xs text-danger mb-3">
                    <i className="fa-solid fa-triangle-exclamation" />&nbsp;
                    &ldquo;{draft.item}&rdquo; isn&apos;t in any rack — it can go on the challan but will show as short.
                  </p>
                )}

                <button className="btn btn-outline" onClick={addDraft} disabled={!draft.item}>
                  <i className="fa-solid fa-plus" /> Add to challan
                </button>

                {lines.length > 0 && (
                  <div className="data-table-wrap mt-4">
                    <table className="data-table">
                      <thead>
                        <tr><th>Item / Design</th><th>Color</th><th>Size</th><th>Qty</th><th /></tr>
                      </thead>
                      <tbody>
                        {lines.map((l, i) => (
                          <tr key={`${l.item}|${l.color}|${l.size}|${i}`}>
                            <td className="font-600">{l.item}</td>
                            <td>{l.color || '—'}</td>
                            <td>{l.size || '—'}</td>
                            <td>{l.qty}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button className="btn btn-ghost btn-sm" title="Remove line"
                                onClick={() => editLines(lines.filter((_, j) => j !== i))}>
                                <i className="fa-solid fa-xmark" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td className="font-700" colSpan={3}>Total</td>
                          <td className="font-700">{lineTotal}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          <button className="btn btn-primary" onClick={() => generate()} disabled={loading || !canGenerate}>
            <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-clipboard-list'}`} />
            &nbsp; {loading ? 'Generating…' : 'Generate Picklist'}
          </button>
        </div>

        {/* Right summary */}
        <div>
          <div className="card">
            <div className="card-header"><span className="card-title">Summary</span></div>
            <div className="card-body">
              <SummaryRow label="Challan No" value={dcNo || '—'} />
              <SummaryRow label="Party" value={party || '—'} />
              <SummaryRow label="Date" value={date || '—'} />
              <hr className="divider" />
              <SummaryRow label="Lines" value={detail ? detail.rows.length : lines.length || '—'} />
              <SummaryRow label="Total qty" value={totals ? totals.qty : lineTotal || '—'} />
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

// Numeric sizes (36, 38, 42) before lettered ones, each in its own order.
const sizeKey = (s) => (/^\d+$/.test(s) ? Number(s) : Infinity);

// Keep a box within [0, that rack's stock]; a cleared box reads as 0, not NaN.
function clamp(v, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

// Searchable challan picker for the module tab: open (empty) shows the latest
// 10; typing searches all of them. Same UX as AddItem's TxnCombobox.
function DcCombobox({ onSelect, onClear }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(false);
  const [error, setError] = useState('');
  const blurTimer = useRef(null);

  // Debounced fetch: latest 10 when empty, matches when typing. Skip while a
  // selection is showing (query holds the picked id, not a search term).
  useEffect(() => {
    if (picked) return;
    const t = setTimeout(() => {
      api.challans(query.trim(), 10)
        .then((r) => { setResults(r); setError(''); })
        .catch((e) => { setResults([]); setError(e.message); });
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
        placeholder="Search challan no…"
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
                &nbsp; {d.party || 'No party'} · {d.lines} item{d.lines > 1 ? 's' : ''} · {d.date || '—'}
              </span>
            </div>
          ))}
        </div>
      )}
      {open && results.length === 0 && (
        <div className="txn-dropdown">
          <div className="txn-option text-muted">{error || 'No matching challans'}</div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required, placeholder }) {
  return (
    <div className="form-group">
      <label className="form-label">{label} {required && <span className="required">*</span>}</label>
      <input className="form-control" type={type} value={value} placeholder={placeholder}
        min={type === 'number' ? 0 : undefined}
        onChange={(e) => onChange(e.target.value)} />
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
