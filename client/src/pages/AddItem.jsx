import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { MODULE_TYPES, occupancyBucket, pct, pctColorClass, sortByEmptiness } from '../lib/rack.js';

const EMPTY = { item: '', color: '', size: '', qty: 1, moduleType: null, moduleId: null };

export default function AddItem() {
  const toast = useToast();
  const [mode, setMode] = useState('source'); // 'source' (Flow A) | 'manual' (Flow B)
  const [form, setForm] = useState(EMPTY);
  const [racks, setRacks] = useState([]);
  const [rackId, setRackId] = useState('');
  const [rackSearch, setRackSearch] = useState('');

  // Flow A state
  const [moduleType, setModuleType] = useState(MODULE_TYPES[0]);
  const [txnResetKey, setTxnResetKey] = useState(0); // bump to remount/clear the combobox

  const [placements, setPlacements] = useState([]); // racks already holding this exact item

  useEffect(() => { api.listRacks().then(setRacks).catch((e) => toast(e.message, 'error')); }, []);

  // Look up existing placements whenever the item/color/size changes (debounced).
  useEffect(() => {
    const it = (form.item || '').trim();
    if (!it) { setPlacements([]); return; }
    const t = setTimeout(() => {
      api.findPlacements(it, form.color || '', form.size || '').then(setPlacements).catch(() => setPlacements([]));
    }, 250);
    return () => clearTimeout(t);
  }, [form.item, form.color, form.size]);

  const fillFromTxn = (t) =>
    setForm({ item: t.item, color: t.color, size: t.size, qty: t.qty, moduleType: t.module_type, moduleId: t.id });
  const clearTxn = () => setForm(EMPTY);

  const switchMode = (m) => {
    setMode(m);
    setForm(m === 'manual' ? { ...EMPTY } : EMPTY);
    setTxnResetKey((k) => k + 1);
  };

  const selectedRack = racks.find((r) => r.rack_id === rackId);

  const save = async () => {
    if (!form.item || !form.qty || form.qty <= 0) return toast('Item and a positive quantity are required', 'warning');
    if (!rackId) return toast('Select a rack', 'warning');
    try {
      const res = await api.addItem({ rackId, ...form, qty: Number(form.qty) });
      toast(`${form.item} × ${form.qty} added to ${rackId}`, 'success');
      setForm(mode === 'source' ? EMPTY : { ...EMPTY });
      setTxnResetKey((k) => k + 1);
      setRackId('');
      // refresh rack availability
      setRacks((rs) => rs.map((r) => (r.rack_id === res.rack.rack_id ? { ...r, used: res.rack.used, status: res.rack.status, available: r.capacity - res.rack.used } : r)));
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const rackOptions = sortByEmptiness(
    racks.filter((r) => r.rack_id.toLowerCase().includes(rackSearch.toLowerCase()))
  ).slice(0, 8);

  return (
    <>
      <div className="breadcrumb-bar"><span>Add Item</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Add Item to Rack</h1>
          <p className="page-subtitle">From a source module (Purchase Inward, Job Slip…) or manual entry</p>
        </div>
      </div>

      <div className="grid gap-col-6" style={{ gridTemplateColumns: '1fr 340px' }}>
        <div>
          {/* Step 1 — source (overflow:visible so the txn dropdown isn't clipped by the card) */}
          <div className="card mb-4" style={{ overflow: 'visible' }}>
            <div className="card-header"><span className="card-title"><i className="fa-solid fa-file-import text-primary-color" />&nbsp; Step 1 — Item Source</span></div>
            <div className="card-body">
              <div className="tab-bar">
                <div className={`tab-btn ${mode === 'source' ? 'active' : ''}`} onClick={() => switchMode('source')}>From Source Module</div>
                <div className={`tab-btn ${mode === 'manual' ? 'active' : ''}`} onClick={() => switchMode('manual')}>Manual Entry</div>
              </div>

              {mode === 'source' && (
                <div className="grid cols-2 gap-col-4">
                  <div className="form-group">
                    <label className="form-label">Module Type</label>
                    <select className="form-control" value={moduleType} onChange={(e) => setModuleType(e.target.value)}>
                      {MODULE_TYPES.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Transaction</label>
                    <TxnCombobox key={`${moduleType}-${txnResetKey}`} moduleType={moduleType} onSelect={fillFromTxn} onClear={clearTxn} />
                  </div>
                </div>
              )}
              {mode === 'manual' && <p className="text-muted text-sm">Enter item details directly below.</p>}
            </div>
          </div>

          {/* Step 2 — details */}
          <div className="card mb-4">
            <div className="card-header"><span className="card-title"><i className="fa-solid fa-box text-primary-color" />&nbsp; Step 2 — Item Details</span></div>
            <div className="card-body">
              <div className="grid cols-2 gap-col-4">
                <Field label="Item" required value={form.item} onChange={(v) => setForm({ ...form, item: v })} readOnly={mode === 'source' && !!form.moduleId} />
                <Field label="Quantity" type="number" required value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} />
                <Field label="Color" value={form.color} onChange={(v) => setForm({ ...form, color: v })} readOnly={mode === 'source' && !!form.moduleId} />
                <Field label="Size" value={form.size} onChange={(v) => setForm({ ...form, size: v })} readOnly={mode === 'source' && !!form.moduleId} />
              </div>
            </div>
          </div>

          {/* Already-placed hint */}
          {placements.length > 0 && (
            <div className="card mb-4" style={{ borderColor: 'var(--warning)' }}>
              <div className="card-body">
                <div className="flex items-center gap-2 mb-2">
                  <i className="fa-solid fa-circle-info" style={{ color: 'var(--warning)' }} />
                  <span className="font-700">Already stored in {placements.length} rack{placements.length > 1 ? 's' : ''}</span>
                </div>
                <p className="text-sm text-muted mb-3">This exact item is already placed. Add to an existing rack to consolidate, or pick a new rack below.</p>
                <div className="grid cols-2 gap-col-4">
                  {placements.map((p) => {
                    const noRoom = p.available < Number(form.qty || 0);
                    const chosen = rackId === p.rack_id;
                    return (
                      <div key={p.id} className="flex items-center gap-3 p-4" style={{ background: 'var(--bg)', borderRadius: 'var(--radius-md)', outline: chosen ? '2px solid var(--primary)' : 'none' }}>
                        <div style={{ flex: 1 }}>
                          <div className="font-700 text-primary-color">{p.rack_id}</div>
                          <div className="text-xs text-muted">has {p.qty} here · {p.available} free</div>
                        </div>
                        <button className="btn btn-outline btn-sm" disabled={noRoom} onClick={() => setRackId(p.rack_id)}>
                          {noRoom ? 'No room' : chosen ? 'Selected' : 'Add here'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — rack */}
          <div className="card">
            <div className="card-header"><span className="card-title"><i className="fa-solid fa-layer-group text-primary-color" />&nbsp; Step 3 — Select Rack</span></div>
            <div className="card-body">
              <div className="input-group mb-3">
                <span className="input-icon"><i className="fa-solid fa-search" /></span>
                <input className="form-control" placeholder="Search rack ID (only racks with space shown)…" value={rackSearch} onChange={(e) => setRackSearch(e.target.value)} />
              </div>
              <div className="grid cols-2 gap-col-4">
                {rackOptions.map((r) => {
                  const p = pct(r.used, r.capacity);
                  return (
                    <div key={r.rack_id} className={`rack-card ${occupancyBucket(r.used, r.capacity)}`} style={{ width: '100%', outline: rackId === r.rack_id ? '2px solid var(--primary)' : 'none' }} onClick={() => setRackId(r.rack_id)}>
                      <div className="rack-status-dot" />
                      <div className="rack-name">{r.rack_id}</div>
                      <div className="rack-pct">{r.available} free of {r.capacity}</div>
                      <div className="progress"><div className={`progress-bar ${pctColorClass(p)}`} style={{ width: `${p}%` }} /></div>
                    </div>
                  );
                })}
                {!rackOptions.length && <p className="text-muted">No racks with available space.</p>}
              </div>
              <button className="btn btn-primary mt-4" onClick={save} disabled={!rackId || !form.item}>
                <i className="fa-solid fa-check" /> Add to {rackId || 'rack'}
              </button>
            </div>
          </div>
        </div>

        {/* Right summary */}
        <div>
          <div className="card">
            <div className="card-header"><span className="card-title">Summary</span></div>
            <div className="card-body">
              <SummaryRow label="Mode" value={mode === 'source' ? 'Source Module' : 'Manual'} />
              <SummaryRow label="Item" value={form.item || '—'} />
              <SummaryRow label="Color / Size" value={`${form.color || '—'} / ${form.size || '—'}`} />
              <SummaryRow label="Qty" value={form.qty || '—'} />
              <SummaryRow label="Module" value={form.moduleType || '—'} />
              <hr className="divider" />
              <SummaryRow label="Target rack" value={rackId || '—'} />
              {selectedRack && <SummaryRow label="After add" value={`${selectedRack.used + Number(form.qty || 0)}/${selectedRack.capacity}`} />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Searchable transaction picker: open (empty) shows the latest 10 for the module
// type; typing an id (e.g. "PI-06") searches ALL transactions server-side.
function TxnCombobox({ moduleType, onSelect, onClear }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null); // why the list is empty, when it isn't "no matches"
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(false); // a txn is currently selected
  const blurTimer = useRef(null);

  // Debounced fetch: latest 10 when empty, matches when typing. Skip while a
  // selection is showing (query holds the picked id, not a search term).
  useEffect(() => {
    if (picked) return;
    const t = setTimeout(() => {
      api.sourceTransactions(moduleType, query.trim(), 10)
        .then((rows) => { setResults(rows); setError(null); })
        // Swallowing this used to render an empty dropdown for a module that was
        // actually erroring — "no transactions" and "Vastra is unreachable" looked
        // identical. Show what the server said instead.
        .catch((e) => { setResults([]); setError(e.message); });
    }, query.trim() ? 200 : 0);
    return () => clearTimeout(t);
  }, [query, moduleType, picked]);

  const choose = (t) => {
    setPicked(true);
    setQuery(t.id);
    setOpen(false);
    onSelect(t);
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
        placeholder="Search transaction id (e.g. PI-06)…"
        value={query}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => { clearTimeout(blurTimer.current); setOpen(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
      />
      {open && results.length > 0 && (
        <div className="txn-dropdown">
          {results.map((t) => (
            // One Vastra document yields a row per line item, so `id` (the
            // document no) repeats — line_id is what's unique. Stub rows have
            // no line_id and are already unique by id.
            <div key={t.line_id ?? t.id} className="txn-option" onMouseDown={() => choose(t)}>
              <span className="font-600 text-primary-color">{t.id}</span>
              <span className="text-sm text-muted">&nbsp; {t.item} {t.color} {t.size} (×{t.qty})</span>
            </div>
          ))}
        </div>
      )}
      {open && results.length === 0 && (
        <div className="txn-dropdown">
          <div className={`txn-option ${error ? 'text-danger' : 'text-muted'}`}>
            {error || 'No matching transactions'}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required, readOnly }) {
  return (
    <div className="form-group">
      <label className="form-label">{label} {required && <span className="required">*</span>}</label>
      <input className="form-control" type={type} value={value} readOnly={readOnly}
        style={readOnly ? { background: 'var(--bg)' } : undefined}
        min={type === 'number' ? 1 : undefined}
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
