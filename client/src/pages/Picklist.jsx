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

// One draft = one line on the challan: a design, in one colour, across a run of
// sizes. Same design in another colour is a second line, exactly as the challan
// prints it. `sizeQty` holds quantities against sizes that are in stock;
// `extra` is for sizes that aren't (they'll report as short).
const EMPTY_DRAFT = { item: '', color: '', sizeQty: {}, extra: [] };

export default function Picklist() {
  const toast = useToast();
  const [mode, setMode] = useState('manual'); // 'manual' | 'module'

  // The challan is not recreated here — it already exists in the Vastra app.
  // Manual entry is only its item details, transcribed to find the racks. The
  // challan header (no / party / date) is therefore module-tab only, where it
  // comes back from Vastra for free.
  const [dcNo, setDcNo] = useState('');
  const [party, setParty] = useState('');
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
  const itemStats = useMemo(() => {
    const m = new Map();
    for (const r of stock) m.set(r.item, (m.get(r.item) || 0) + Number(r.qty || 0));
    return m;
  }, [stock]);
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
    const item = draft.item.trim();
    if (!item) return toast('Pick an item first', 'warning');

    // The size run plus any off-catalogue sizes typed underneath it.
    const fromRun = draftSizes.map(([size]) => ({ size, qty: Number(draft.sizeQty[size]) || 0 }));
    const fromExtra = draft.extra.map((e) => ({ size: e.size.trim(), qty: Number(e.qty) || 0 }));
    const added = [...fromRun, ...fromExtra]
      .filter((s) => s.qty > 0)
      .map((s) => ({ item, color: draft.color.trim(), size: s.size, qty: s.qty }));

    if (!added.length) return toast('Enter a quantity against at least one size', 'warning');
    editLines([...lines, ...added]);
    setDraft(EMPTY_DRAFT);
  };

  const setExtra = (i, patch) =>
    setDraft({ ...draft, extra: draft.extra.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  const generate = async (dc = dcNo) => {
    setLoading(true);
    try {
      const res = mode === 'manual'
        ? await api.resolvePicklist({ lines })
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
      toast(`${res.pickedQty} units picked${detail.dcNo ? ` for ${detail.dcNo}` : ''} across ${res.racks.length} rack(s)`, 'success');
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

  // The flat `lines` are what the API takes, but a challan reads as one entry
  // per design+colour with its sizes beside it — so group for display.
  const blocks = useMemo(() => {
    const m = new Map();
    for (const l of lines) {
      const key = `${l.item}|${l.color}`;
      const b = m.get(key) || { key, item: l.item, color: l.color, sizes: [], total: 0 };
      b.sizes.push({ size: l.size, qty: l.qty });
      b.total += l.qty;
      m.set(key, b);
    }
    for (const b of m.values()) {
      b.sizes.sort((a, z) => sizeKey(a.size) - sizeKey(z.size) || a.size.localeCompare(z.size));
    }
    return [...m.values()];
  }, [lines]);

  const lineTotal = lines.reduce((s, l) => s + l.qty, 0);
  const totals = detail
    ? detail.rows.reduce(
        (a, r) => ({ qty: a.qty + r.qty, available: a.available + r.available, short: a.short + r.shortage }),
        { qty: 0, available: 0, short: 0 }
      )
    : null;
  const canGenerate = mode === 'manual' ? lines.length > 0 : !!dcNo.trim();

  const switchMode = (m) => {
    setMode(m);
    setDcNo(''); setParty('');
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

              {mode === 'manual' && <p className="text-muted text-sm">Enter item details directly below.</p>}

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
              <div className="card-body" style={{ overflow: 'visible' }}>
                {/* Items already on the challan — one block per design+colour,
                    numbered like the challan's Sr column. */}
                {blocks.length > 0 && (
                  <div className="data-table-wrap mb-4">
                    <table className="data-table">
                      <thead>
                        <tr><th style={{ width: 40 }}>Sr</th><th>Item / Design</th><th>Color</th><th>Sizes</th><th>Qty</th><th /></tr>
                      </thead>
                      <tbody>
                        {blocks.map((b, i) => (
                          <tr key={b.key}>
                            <td className="text-muted">{i + 1}</td>
                            <td className="font-600">{b.item}</td>
                            <td>{b.color || '—'}</td>
                            <td>
                              {b.sizes.map((s) => (
                                <span key={s.size} className="badge badge-ghost size-chip">
                                  {s.size || 'no size'} ×{s.qty}
                                </span>
                              ))}
                            </td>
                            <td className="font-600">{b.total}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button className="btn btn-ghost btn-sm" title="Remove this item"
                                onClick={() => editLines(lines.filter((l) => `${l.item}|${l.color}` !== b.key))}>
                                <i className="fa-solid fa-xmark" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={4} className="font-700">Total</td>
                          <td className="font-700">{lineTotal}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="add-item-panel">
                  <div className="text-sm font-700 mb-3">
                    Item {blocks.length + 1}
                    {blocks.length > 0 && <span className="text-muted font-600">&nbsp;— same design in another colour goes in as its own item</span>}
                  </div>

                  <div className="grid cols-2 gap-col-4">
                    <div className="form-group">
                      <label className="form-label">Item / Design <span className="required">*</span></label>
                      <ItemCombobox
                        value={draft.item}
                        items={itemNames}
                        stats={itemStats}
                        onChange={(v) => setDraft({ ...EMPTY_DRAFT, item: v })}
                      />
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

                  {/* The size run — one design across a row of sizes, the shape
                      the challan itself uses. */}
                  {draftSizes.length > 0 && (
                    <div className="form-group">
                      <label className="form-label">Quantity per size</label>
                      <div className="size-run">
                        {draftSizes.map(([size, have]) => (
                          <div key={size} className="size-cell">
                            <div className="size-cell-label">{size || 'no size'}</div>
                            <input className="form-control" type="number" min="0" placeholder="0"
                              value={draft.sizeQty[size] ?? ''}
                              onChange={(e) => setDraft({ ...draft, sizeQty: { ...draft.sizeQty, [size]: e.target.value } })} />
                            <div className="size-cell-stock">{have} in stock</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {draft.item && !draft.color && draftColors.length > 0 && (
                    <p className="text-xs text-muted mb-3">Pick a colour to see its size run.</p>
                  )}

                  {/* Sizes the warehouse doesn't stock — allowed, they report short */}
                  {draft.extra.map((e, i) => (
                    <div key={i} className="grid cols-2 gap-col-4">
                      <Field label={i === 0 ? 'Size (not in stock)' : ''} value={e.size}
                        onChange={(v) => setExtra(i, { size: v })} />
                      <div className="flex gap-2 items-center">
                        <div style={{ flex: 1 }}>
                          <Field label={i === 0 ? 'Quantity' : ''} type="number" value={e.qty}
                            onChange={(v) => setExtra(i, { qty: v })} />
                        </div>
                        <button className="btn btn-ghost btn-sm" title="Remove size"
                          style={{ marginTop: i === 0 ? 18 : 0 }}
                          onClick={() => setDraft({ ...draft, extra: draft.extra.filter((_, j) => j !== i) })}>
                          <i className="fa-solid fa-xmark" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {draft.item && !catalog.has(draft.item) && (
                    <p className="text-xs text-danger mb-3">
                      <i className="fa-solid fa-triangle-exclamation" />&nbsp;
                      &ldquo;{draft.item}&rdquo; isn&apos;t in any rack. It can still go on the challan, but it will show as short.
                    </p>
                  )}

                  <div className="flex gap-3 items-center">
                    <button className="btn btn-primary" onClick={addDraft} disabled={!draft.item}>
                      <i className="fa-solid fa-plus" /> Add item
                    </button>
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setDraft({ ...draft, extra: [...draft.extra, { size: '', qty: '' }] })}>
                      <i className="fa-solid fa-plus" /> Add a size not in stock
                    </button>
                  </div>
                </div>
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
              {/* Only the module tab knows a challan number — manual entry is
                  item details only, so there is nothing to show here. */}
              {mode === 'module' && (
                <>
                  <SummaryRow label="Challan No" value={dcNo || '—'} />
                  <SummaryRow label="Party" value={party || '—'} />
                  <hr className="divider" />
                </>
              )}
              <SummaryRow label="Items" value={blocks.length || '—'} />
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
              <span className="card-title"><i className="fa-solid fa-clipboard-list text-primary-color" />&nbsp; Picklist{detail.dcNo ? ` — ${detail.dcNo}` : ''}</span>
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

// Item picker over what is actually in the racks. A plain <datalist> wasn't
// enough: it only resolves on an exact full-string match, so typing "Dupatta"
// left "Chiffon Dupatta" unreachable and the size run never appeared. This
// matches on any substring and fills in the stored name when you pick one.
// Free text is still allowed — the caller warns and lets it through.
function ItemCombobox({ value, items, stats, onChange }) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);

  const q = value.trim().toLowerCase();
  const matches = items.filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
  const exact = items.some((n) => n === value);

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="form-control"
        placeholder="Start typing an item name…"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { clearTimeout(blurTimer.current); setOpen(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
      />
      {open && matches.length > 0 && !exact && (
        <div className="txn-dropdown">
          {matches.map((n) => (
            <div key={n} className="txn-option" onMouseDown={() => { onChange(n); setOpen(false); }}>
              <span className="font-600 text-primary-color">{n}</span>
              <span className="text-sm text-muted">&nbsp; {stats.get(n) ?? 0} in stock</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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

// An empty label is meaningful here: repeated rows drop the heading rather than
// reserving blank space for it.
function Field({ label, value, onChange, type = 'text', required, placeholder }) {
  return (
    <div className="form-group">
      {label && <label className="form-label">{label} {required && <span className="required">*</span>}</label>}
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
