import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { MODULE_TYPES, sortByEmptiness } from '../lib/rack.js';
import { num, allocatedOn, remainingOn, allocCeiling, withQty,
         suggestRacks, indexPlacements } from '../lib/putaway.js';

// Putaway (Flow A): stock arriving from a source module, or entered by hand,
// placed into racks.
//
// This used to put away ONE line at a time. A real Purchase Inward is a document
// with many lines on it, so a ten-line inward meant picking the same document
// from the dropdown ten times and retyping the rack each time. Now choosing the
// document fills in every line it carries, and the whole document is put away in
// one pass.
//
// A line can also need more than one rack: 90 pieces do not fit in a 30-capacity
// bin. So each line holds a list of rack allocations, and the line is done when
// they add up to its quantity — at which point no further rack can be added,
// because there is nothing left to put anywhere.

// One Vastra document arrives as one row per line, so the document number
// repeats across them. The stub numbers its multi-line documents
// "DC-2026-0007#1, #2…" because source_transaction.id is its primary key — so
// the part before the "#" is the document either way.
const docNo = (id) => String(id ?? '').split('#')[0];

// The stub feed orders by id, and id is a STRING — so a ten-line document comes
// back #1, #10, #2, #3… and the table showed line 10 in third place. Sorting on
// the numeric suffix puts the document back in document order, which is the
// order the goods are physically stacked in. Live Vastra rows carry no "#" and
// all yield 0, leaving their existing order untouched.
const lineNo = (id) => Number(String(id ?? '').split('#')[1]) || 0;

let seq = 0;
const newRow = (patch = {}) => ({
  key: `row-${++seq}`,
  item: '', color: '', size: '', qty: '',
  docQty: null,
  moduleType: null, moduleId: null,
  // Where this line is going. One entry per rack; a line needing three bins has
  // three. Starts with one blank so there is always something to fill in.
  allocs: [{ key: `a-${++seq}`, rackId: null, qty: '' }],
  saved: false,
  error: null,
  ...patch,
});

const newAlloc = () => ({ key: `a-${++seq}`, rackId: null, qty: '' });


export default function AddItem() {
  const toast = useToast();
  const [mode, setMode] = useState('source'); // 'source' (Flow A) | 'manual' (Flow B)
  const [racks, setRacks] = useState([]);
  const [rows, setRows] = useState([newRow()]);
  const [saving, setSaving] = useState(false);

  // Flow A state
  const [moduleType, setModuleType] = useState(MODULE_TYPES[0]);
  const [docId, setDocId] = useState('');
  const [txnResetKey, setTxnResetKey] = useState(0); // bump to remount/clear the combobox
  const [loadingDoc, setLoadingDoc] = useState(false);

  // Racks for the pickers; stock so the suggester can put a product back where
  // that product already lives instead of scattering it a little further with
  // every delivery.
  const [stock, setStock] = useState([]);
  const loadRacks = () => Promise.all([api.listRacks(), api.listItems()])
    .then(([r, s]) => { setRacks(r); setStock(s); })
    .catch((e) => toast(e.message, 'error'));
  useEffect(() => { loadRacks(); }, []);

  const rackById = useMemo(() => new Map(racks.map((r) => [r.id, r])), [racks]);
  // Sorted once, not once per rack box: a warehouse can hold thousands of bins
  // and a ten-line inward renders a picker for every allocation on every row.
  const rackCandidates = useMemo(() => sortByEmptiness(racks), [racks]);
  const placements = useMemo(() => indexPlacements(stock), [stock]);

  // Fills in every line that still needs racks. A starting point, not a
  // decision — every box it touches stays editable, and anything already chosen
  // by hand is left exactly as it is.
  const suggest = () => {
    const next = suggestRacks(rows, racks, placements);
    setRows(next);
    const short = next.filter((r) => r.item.trim() && num(r.qty) > 0 && remainingOn(r) > 0).length;
    if (short) toast(`${short} line(s) could not be fully placed — not enough free space`, 'warning');
  };

  // ── row plumbing ────────────────────────────────────────────────────────
  const patchRow = (key, patch) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, saved: false, error: null } : r)));

  const patchAlloc = (rowKey, allocKey, patch) =>
    setRows((rs) => rs.map((r) => (r.key !== rowKey ? r : {
      ...r, saved: false, error: null,
      allocs: r.allocs.map((a) => (a.key === allocKey ? { ...a, ...patch } : a)),
    })));

  const addAlloc = (rowKey) =>
    setRows((rs) => rs.map((r) => (r.key === rowKey ? { ...r, allocs: [...r.allocs, newAlloc()] } : r)));

  const removeAlloc = (rowKey, allocKey) =>
    setRows((rs) => rs.map((r) => (r.key !== rowKey ? r : {
      // Never leave a line with no rack row at all — there would be nothing to
      // fill in and no way to get a row back.
      ...r, allocs: r.allocs.length > 1 ? r.allocs.filter((a) => a.key !== allocKey) : r.allocs,
    })));

  const addRow = () => setRows((rs) => [...rs, newRow()]);
  const removeRow = (key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  // Quantity stays editable even on a line that came from a document. The
  // inward says what was EXPECTED; the warehouse counts what actually turned
  // up, and short or over deliveries are normal. Forcing the document's number
  // through would record a quantity nobody ever received. Item, colour and size
  // stay locked — those identify the goods, and retyping them is how a line
  // silently stops matching the inward it came from.
  const setRowQty = (key, raw) =>
    setRows((rs) => rs.map((r) => (r.key === key ? withQty(r, raw) : r)));

  const setAllocQty = (row, alloc, raw) => {
    if (raw === '') return patchAlloc(row.key, alloc.key, { qty: '' });
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) return;
    patchAlloc(row.key, alloc.key, { qty: String(Math.min(n, allocCeiling(row, alloc))) });
  };

  // ── source documents ────────────────────────────────────────────────────
  // Picking a document replaces the table with its lines. Each line starts with
  // one empty rack row — where the goods go is the one thing the document
  // cannot tell us.
  const chooseDoc = async (id) => {
    setDocId(id);
    setLoadingDoc(true);
    try {
      // Search by document number: the feed returns every match when given a
      // query, so this gets all of the document's lines rather than whatever
      // fitted in the dropdown's page.
      const all = await api.sourceTransactions(moduleType, id, 100);
      const lines = all.filter((t) => docNo(t.id) === id).sort((a, b) => lineNo(a.id) - lineNo(b.id));
      if (!lines.length) throw new Error(`No lines found on ${id}`);
      setRows(lines.map((t) => newRow({
        item: t.item ?? '', color: t.color ?? '', size: t.size ?? '',
        qty: String(t.qty ?? ''),
        // What the inward claimed, kept so an edited count reads as a
        // deliberate correction rather than looking like the document's number.
        docQty: t.qty ?? null,
        moduleType: t.module_type ?? moduleType, moduleId: id,
      })));
      toast(`${id} — ${lines.length} item${lines.length > 1 ? 's' : ''} loaded`, 'success');
    } catch (e) {
      toast(e.message, 'error');
      setRows([newRow()]);
    } finally {
      setLoadingDoc(false);
    }
  };

  const clearDoc = () => { setDocId(''); setRows([newRow()]); };

  const switchMode = (m) => {
    setMode(m);
    setDocId('');
    setRows([newRow()]);
    setTxnResetKey((k) => k + 1);
  };

  // ── saving ──────────────────────────────────────────────────────────────
  // Every rack allocation is its own add. Rows are independent — one line whose
  // rack filled up must not stop the other nine from being put away — so a
  // failure is recorded against its row and the rest still go in.
  const ready = rows.filter((r) => r.item.trim() && num(r.qty) > 0 && !r.saved);
  const placeable = ready.filter((r) => r.allocs.some((a) => a.rackId && num(a.qty) > 0));
  const anyUnderAllocated = ready.some((r) => remainingOn(r) > 0);
  const needsRacks = ready.filter((r) => remainingOn(r) > 0).length;

  const saveAll = async () => {
    if (!placeable.length) return toast('Nothing to put away — fill in an item, a quantity and a rack', 'warning');
    setSaving(true);
    let placed = 0, failed = 0;
    for (const row of placeable) {
      try {
        for (const a of row.allocs) {
          if (!a.rackId || num(a.qty) <= 0) continue;
          await api.addItem({
            rackId: a.rackId,
            item: row.item.trim(), color: row.color.trim(), size: row.size.trim(),
            qty: num(a.qty),
            moduleType: row.moduleType, moduleId: row.moduleId,
          });
          placed += num(a.qty);
        }
        setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, saved: true, error: null } : r)));
      } catch (e) {
        failed += 1;
        setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, error: e.message } : r)));
      }
    }
    await loadRacks();
    setSaving(false);

    if (placed) toast(`${placed} unit${placed === 1 ? '' : 's'} put away`, 'success');
    if (failed) toast(`${failed} line${failed > 1 ? 's' : ''} could not be placed — see the table`, 'error');
  };

  // Once everything has landed, start clean rather than leaving a table of
  // ticks that invites putting the same document away twice.
  const allSaved = rows.length > 0 && rows.every((r) => r.saved || !r.item.trim());
  const startOver = () => { setDocId(''); setRows([newRow()]); setTxnResetKey((k) => k + 1); };

  const totalQty = rows.reduce((s, r) => s + num(r.qty), 0);
  const totalAllocated = rows.reduce((s, r) => s + allocatedOn(r), 0);

  return (
    <>
      <div className="breadcrumb-bar"><span>Putaway</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Putaway</h1>
          <p className="page-subtitle">Put a whole inward away at once — every line on it, into the racks you choose</p>
        </div>
      </div>

      <div className="grid gap-col-6" style={{ gridTemplateColumns: '1fr 320px', alignItems: 'start' }}>
        <div>
          {/* Step 1 — source (overflow:visible so the txn dropdown isn't clipped) */}
          <div className="card mb-4" style={{ overflow: 'visible' }}>
            <div className="card-header"><span className="card-title"><i className="fa-solid fa-file-import text-primary-color" />&nbsp; Step 1 — Item Source</span></div>
            <div className="card-body">
              <div className="tab-bar">
                <div className={`tab-btn ${mode === 'source' ? 'active' : ''}`} onClick={() => switchMode('source')}>From Source Module</div>
                <div className={`tab-btn ${mode === 'manual' ? 'active' : ''}`} onClick={() => switchMode('manual')}>Manual Entry</div>
              </div>

              {mode === 'source' && (
                <>
                  <div className="grid cols-2 gap-col-4">
                    <div className="form-group">
                      <label className="form-label">Module Type</label>
                      <select className="form-control" value={moduleType}
                        onChange={(e) => { setModuleType(e.target.value); clearDoc(); setTxnResetKey((k) => k + 1); }}>
                        {MODULE_TYPES.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Transaction</label>
                      <DocCombobox key={`${moduleType}-${txnResetKey}`} moduleType={moduleType}
                        onSelect={chooseDoc} onClear={clearDoc} />
                    </div>
                  </div>
                  <p className="text-xs text-muted" style={{ marginTop: -8 }}>
                    Pick the document once — every line on it fills in below.
                  </p>
                </>
              )}
              {mode === 'manual' && (
                <p className="text-muted text-sm">
                  Enter the items below. Use <strong>Add item</strong> for as many as you need.
                </p>
              )}
            </div>
          </div>

          {/* Step 2 — the lines */}
          <div className="card mb-4" style={{ overflow: 'visible' }}>
            <div className="card-header">
              <span className="card-title">
                <i className="fa-solid fa-list text-primary-color" />&nbsp; Step 2 — Items{docId ? ` on ${docId}` : ''}
              </span>
              {loadingDoc && <span className="text-sm text-muted ml-auto"><i className="fa-solid fa-spinner fa-spin" /> Loading…</span>}
            </div>
            <div className="card-body">
              <div className="data-table-wrap">
                <table className="data-table putaway-table">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>#</th>
                      <th style={{ minWidth: 150 }}>Item name</th>
                      <th style={{ width: 110 }}>Color</th>
                      <th style={{ width: 90 }}>Size</th>
                      <th style={{ width: 80 }}>Quantity</th>
                      <th style={{ minWidth: 300 }}>Add to rack</th>
                      <th style={{ width: 36 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <Row
                        key={row.key}
                        row={row} index={i} locked={!!row.moduleId}
                        racks={rackCandidates} rackById={rackById}
                        onPatch={(patch) => patchRow(row.key, patch)}
                        onSetQty={(v) => setRowQty(row.key, v)}
                        onPatchAlloc={(ak, patch) => patchAlloc(row.key, ak, patch)}
                        onSetAllocQty={(a, v) => setAllocQty(row, a, v)}
                        ceilingFor={(a) => allocCeiling(row, a)}
                        onAddAlloc={() => addAlloc(row.key)}
                        onRemoveAlloc={(ak) => removeAlloc(row.key, ak)}
                        onRemove={() => removeRow(row.key)}
                        canRemove={rows.length > 1}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-3 items-center mt-4">
                <button className="btn btn-ghost btn-sm" onClick={addRow}>
                  <i className="fa-solid fa-plus" />&nbsp; Add item
                </button>
                {needsRacks > 0 && (
                  <button className="btn btn-outline btn-sm" onClick={suggest}
                    title="Fill in racks for every line that still needs them">
                    <i className="fa-solid fa-wand-magic-sparkles" />
                    &nbsp; Suggest racks for {needsRacks} line{needsRacks > 1 ? 's' : ''}
                  </button>
                )}
                {anyUnderAllocated && (
                  <span className="text-xs text-muted">
                    A line is not put away until its whole quantity has a rack.
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-3 items-center">
            {allSaved && rows.some((r) => r.saved) ? (
              <button className="btn btn-primary" onClick={startOver}>
                <i className="fa-solid fa-rotate-right" />&nbsp; Put away another
              </button>
            ) : (
              <button className="btn btn-primary" onClick={saveAll} disabled={saving || !placeable.length}>
                <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-boxes-packing'}`} />
                &nbsp; {saving ? 'Putting away…' : `Put away ${placeable.length || ''} line${placeable.length === 1 ? '' : 's'}`.trim()}
              </button>
            )}
          </div>
        </div>

        {/* Right summary */}
        <div>
          <div className="card">
            <div className="card-header"><span className="card-title">Summary</span></div>
            <div className="card-body">
              <SummaryRow label="Mode" value={mode === 'source' ? 'Source Module' : 'Manual'} />
              <SummaryRow label="Document" value={docId || '—'} />
              <SummaryRow label="Module" value={mode === 'source' ? moduleType : '—'} />
              <hr className="divider" />
              <SummaryRow label="Lines" value={rows.filter((r) => r.item.trim()).length || '—'} />
              <SummaryRow label="Total qty" value={totalQty || '—'} />
              <SummaryRow label="Allocated" value={totalAllocated || '—'} />
              <SummaryRow label="Unallocated" value={Math.max(0, totalQty - totalAllocated) || '—'} />
              <hr className="divider" />
              <SummaryRow label="Put away" value={rows.filter((r) => r.saved).length || '—'} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// One line of the inward: what it is, how many, and which racks it goes into.
function Row({
  row, index, locked, racks, rackById,
  onPatch, onSetQty, onSetAllocQty, onPatchAlloc, ceilingFor,
  onAddAlloc, onRemoveAlloc, onRemove, canRemove,
}) {
  const allocated = allocatedOn(row);
  const remaining = remainingOn(row);
  const qty = num(row.qty);
  // The user's rule: once the whole line has a home, there is nothing left to
  // give another rack, so the option to add one goes away.
  const canAddRack = qty > 0 && remaining > 0;

  return (
    <tr className={row.saved ? 'row-saved' : row.error ? 'row-error' : undefined}>
      <td className="text-muted">{index + 1}</td>
      <td>
        <input className="form-control" placeholder="Item name" value={row.item} readOnly={locked}
          style={locked ? { background: 'var(--bg)' } : undefined}
          onChange={(e) => onPatch({ item: e.target.value })} />
      </td>
      <td>
        <input className="form-control" placeholder="—" value={row.color} readOnly={locked}
          style={locked ? { background: 'var(--bg)' } : undefined}
          onChange={(e) => onPatch({ color: e.target.value })} />
      </td>
      <td>
        <input className="form-control" placeholder="—" value={row.size} readOnly={locked}
          style={locked ? { background: 'var(--bg)' } : undefined}
          onChange={(e) => onPatch({ size: e.target.value })} />
      </td>
      <td>
        <input className="form-control" type="number" min="0" placeholder="0" value={row.qty}
          onChange={(e) => onSetQty(e.target.value.replace(/[^0-9]/g, ''))} />
        {row.docQty != null && num(row.qty) !== num(row.docQty) && (
          <div className="text-xs qty-corrected">inward said {row.docQty}</div>
        )}
      </td>
      <td>
        {row.allocs.map((a) => {
          const rack = a.rackId ? rackById.get(a.rackId) : null;
          // Soft warning only: another line in this same table may be filling
          // the rack too, so the authoritative check is the server's.
          const tooBig = rack && num(a.qty) > rack.available;
          return (
            <div key={a.key} className="putaway-alloc">
              <div style={{ flex: 1, minWidth: 150 }}>
                <RackCombobox
                  candidates={racks}
                  value={a.rackId}
                  onChange={(id) => onPatchAlloc(a.key, { rackId: id || null, consolidated: false })}
                />
              </div>
              <input className="form-control alloc-qty" type="number" min="0" placeholder="0"
                value={a.qty} onChange={(e) => onSetAllocQty(a, e.target.value)} />
              {row.allocs.length > 1 && (
                <button className="btn btn-ghost btn-sm" title="Remove this rack"
                  onClick={() => onRemoveAlloc(a.key)}>
                  <i className="fa-solid fa-xmark" />
                </button>
              )}
              {tooBig && (
                <span className="text-xs text-danger" style={{ whiteSpace: 'nowrap' }}>
                  only {rack.available} free
                </span>
              )}
              {/* Why the suggester chose this one — the same product is already
                  there, so this keeps it together rather than scattering it. */}
              {a.consolidated && !tooBig && (
                <span className="text-xs consolidated-hint" style={{ whiteSpace: 'nowrap' }}>
                  <i className="fa-solid fa-layer-group" />&nbsp; already here
                </span>
              )}
            </div>
          );
        })}

        {canAddRack && (
          <button className="btn btn-ghost btn-sm" onClick={onAddAlloc}>
            <i className="fa-solid fa-plus" />&nbsp; another rack
          </button>
        )}

        {qty > 0 && (
          <div className={`text-xs mt-1 ${remaining === 0 ? 'text-muted' : 'text-danger'}`}>
            {allocated} of {qty} placed{remaining > 0 ? ` · ${remaining} still needs a rack` : ' ✓'}
          </div>
        )}
        {row.error && <div className="text-xs text-danger mt-1">{row.error}</div>}
        {row.saved && <div className="text-xs mt-1" style={{ color: 'var(--success)' }}>Put away</div>}
      </td>
      <td>
        {canRemove && !row.saved && (
          <button className="btn btn-ghost btn-sm" title="Remove this line" onClick={onRemove}>
            <i className="fa-solid fa-trash" />
          </button>
        )}
      </td>
    </tr>
  );
}

// Searchable DOCUMENT picker. The feed is one row per line, so a raw page of 10
// could be a single 10-line inward — over-fetch, group by document number, then
// cap on documents. Same shape as the picklist's challan dropdown.
function DocCombobox({ moduleType, onSelect, onClear }) {
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState([]);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(false);
  const blurTimer = useRef(null);

  useEffect(() => {
    if (picked) return;
    const t = setTimeout(() => {
      api.sourceTransactions(moduleType, query.trim(), 200)
        .then((rows) => {
          const m = new Map();
          for (const r of rows) {
            const id = docNo(r.id);
            if (!id) continue;
            const d = m.get(id) || { id, lines: 0, qty: 0, first: r.item ?? '', date: r.date ?? null };
            d.lines += 1;
            d.qty += Number(r.qty) || 0;
            m.set(id, d);
          }
          setDocs([...m.values()].slice(0, 10));
          setError(null);
        })
        // "No transactions" and "Vastra is unreachable" used to look identical.
        .catch((e) => { setDocs([]); setError(e.message); });
    }, query.trim() ? 200 : 0);
    return () => clearTimeout(t);
  }, [query, moduleType, picked]);

  const choose = (d) => { setPicked(true); setQuery(d.id); setOpen(false); onSelect(d.id); };
  const onType = (v) => { if (picked) { setPicked(false); onClear(); } setQuery(v); setOpen(true); };

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="form-control"
        placeholder="Search transaction id (e.g. PI-2026-0006)…"
        value={query}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => { clearTimeout(blurTimer.current); setOpen(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
      />
      {open && (
        <div className="txn-dropdown">
          {docs.length ? docs.map((d) => (
            <div key={d.id} className="txn-option" onMouseDown={() => choose(d)}>
              <span className="font-600 text-primary-color">{d.id}</span>
              <span className="text-sm text-muted">
                &nbsp; {d.lines} item{d.lines > 1 ? 's' : ''} · {d.qty} units
                {d.lines === 1 && d.first ? ` · ${d.first}` : ''}
              </span>
            </div>
          )) : (
            <div className={`txn-option ${error ? 'text-danger' : 'text-muted'}`}>
              {error || 'No matching transactions'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Rack picker, filtering by rack id live. Same UX as MoveItem's.
function RackCombobox({ candidates, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(false);
  const blurTimer = useRef(null);

  // A cleared selection from the parent (new row, document swapped) has to clear
  // the text too, or the box keeps showing a rack that is no longer chosen.
  useEffect(() => { if (!value && picked) { setPicked(false); setQuery(''); } }, [value]);

  const q = query.trim().toLowerCase();
  const matches = (picked ? candidates : candidates.filter((r) => r.rack_id.toLowerCase().includes(q))).slice(0, 8);

  const choose = (r) => { setPicked(true); setQuery(r.rack_id); setOpen(false); onChange(r.id); };
  const onType = (v) => { if (picked) { setPicked(false); onChange(''); } setQuery(v); setOpen(true); };

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="form-control"
        placeholder="Search rack…"
        value={query}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => { clearTimeout(blurTimer.current); setOpen(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
      />
      {open && (
        <div className="txn-dropdown">
          {matches.length ? matches.map((r) => (
            <div key={r.id} className="txn-option" onMouseDown={() => choose(r)}>
              <span className="font-600 text-primary-color">{r.rack_id}</span>
              <span className="text-sm text-muted">&nbsp; {r.available} free{r.status === 'Vacant' ? ' · empty' : ''}</span>
            </div>
          )) : <div className="txn-option text-muted">No racks with space match</div>}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
      <span className="text-sm text-muted">{label}</span>
      <span className="font-600 text-sm truncate" style={{ maxWidth: 170 }}>{value}</span>
    </div>
  );
}
