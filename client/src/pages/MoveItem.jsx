import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { pct, pctColorClass, sortByEmptiness } from '../lib/rack.js';

const variantKey = (r) => `${r.item}|${r.color}|${r.size}`;

export default function MoveItem() {
  const toast = useToast();
  const [racks, setRacks] = useState([]);
  const [items, setItems] = useState([]);      // all item_location rows (for the variant picker)
  const [search, setSearch] = useState('');
  const [variant, setVariant] = useState(null); // { item, color, size }
  const [placements, setPlacements] = useState([]); // racks holding the chosen variant
  const [source, setSource] = useState(null);  // chosen placement { id, rack_id, qty, available }
  const [qty, setQty] = useState(1);
  const [toRackId, setToRackId] = useState('');

  const loadRacks = () => api.listRacks().then(setRacks).catch((e) => toast(e.message, 'error'));
  const loadItems = () => api.listItems().then(setItems).catch((e) => toast(e.message, 'error'));
  useEffect(() => { loadRacks(); loadItems(); }, []);

  // Distinct item+color+size variants, with total qty across racks.
  const variants = useMemo(() => {
    const map = new Map();
    for (const r of items) {
      const k = variantKey(r);
      const v = map.get(k) || { item: r.item, color: r.color, size: r.size, total: 0 };
      v.total += r.qty;
      map.set(k, v);
    }
    return [...map.values()].sort((a, b) => a.item.localeCompare(b.item));
  }, [items]);

  const filteredVariants = variants.filter((v) =>
    `${v.item} ${v.color} ${v.size}`.toLowerCase().includes(search.toLowerCase())
  );

  // When a variant is chosen, find every rack that holds it.
  const chooseVariant = async (v) => {
    setVariant(v); setSource(null); setToRackId(''); setQty(1); setPlacements([]);
    try {
      setPlacements(await api.findPlacements(v.item, v.color, v.size));
    } catch (e) { toast(e.message, 'error'); }
  };

  const chooseSource = (p) => { setSource(p); setQty(1); setToRackId(''); };

  const destRacks = sortByEmptiness(racks.filter((r) => r.rack_id !== source?.rack_id));
  const destRack = racks.find((r) => r.rack_id === toRackId);

  const reset = () => { setVariant(null); setPlacements([]); setSource(null); setToRackId(''); setQty(1); setSearch(''); };

  const doMove = async () => {
    if (!source || !toRackId) return toast('Pick a source rack and a destination', 'warning');
    if (qty <= 0 || qty > source.qty) return toast(`Quantity must be 1–${source.qty}`, 'warning');
    try {
      await api.move(source.id, toRackId, Number(qty));
      toast(`Moved ${qty} × ${variant.item} → ${toRackId}`, 'success');
      await Promise.all([loadRacks(), loadItems()]);
      reset();
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <div className="breadcrumb-bar"><span>Move Item</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Move Item</h1>
          <p className="page-subtitle">Pick an item, choose where it's stored, then move it — atomic transfer</p>
        </div>
      </div>

      <div className="grid gap-col-6" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Step 1 — pick the item */}
        <div className="card">
          <div className="card-header"><span className="card-title"><i className="fa-solid fa-box text-primary-color" />&nbsp; Step 1 — Select Item</span></div>
          <div className="card-body">
            <div className="input-group mb-3">
              <span className="input-icon"><i className="fa-solid fa-search" /></span>
              <input className="form-control" placeholder="Search item, color or size…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="data-table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>Item</th><th>Color</th><th>Size</th><th>Total</th><th></th></tr></thead>
                <tbody>
                  {filteredVariants.map((v) => {
                    const chosen = variant && variantKey(variant) === variantKey(v);
                    return (
                      <tr key={variantKey(v)} style={{ background: chosen ? 'var(--primary-alpha)' : undefined }}>
                        <td>{v.item}</td><td>{v.color || '—'}</td><td>{v.size || '—'}</td><td>{v.total}</td>
                        <td><button className="btn btn-outline btn-sm" onClick={() => chooseVariant(v)}>{chosen ? 'Selected' : 'Select'}</button></td>
                      </tr>
                    );
                  })}
                  {!filteredVariants.length && <tr><td colSpan={5} className="text-muted" style={{ textAlign: 'center' }}>No items match</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Step 2 — pick source rack + qty */}
        <div className="card">
          <div className="card-header"><span className="card-title"><i className="fa-solid fa-location-dot text-primary-color" />&nbsp; Step 2 — Source Rack</span></div>
          <div className="card-body">
            {!variant ? (
              <div className="empty-state"><i className="fa-solid fa-hand-pointer" /><p>Select an item first</p></div>
            ) : !placements.length ? (
              <div className="empty-state"><i className="fa-solid fa-inbox" /><p>This item isn't in any rack</p></div>
            ) : (
              <>
                <p className="text-sm text-muted mb-3">Stored in {placements.length} rack{placements.length > 1 ? 's' : ''} — pick one to move from:</p>
                <div className="grid cols-2 gap-col-4 mb-4">
                  {placements.map((p) => {
                    const chosen = source?.id === p.id;
                    return (
                      <div key={p.id} className="flex items-center gap-3 p-4" style={{ background: 'var(--bg)', borderRadius: 'var(--radius-md)', outline: chosen ? '2px solid var(--primary)' : 'none', cursor: 'pointer' }} onClick={() => chooseSource(p)}>
                        <div style={{ flex: 1 }}>
                          <div className="font-700 text-primary-color">{p.rack_id}</div>
                          <div className="text-xs text-muted">{p.qty} here · {p.available} free</div>
                        </div>
                        {chosen && <i className="fa-solid fa-circle-check" style={{ color: 'var(--primary)' }} />}
                      </div>
                    );
                  })}
                </div>
                {source && (
                  <div className="form-group">
                    <label className="form-label">Quantity to Move (max {source.qty})</label>
                    <input className="form-control" type="number" min="1" max={source.qty} value={qty} onChange={(e) => setQty(e.target.value)} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Step 3 — destination */}
      {source && (
        <div className="card mt-4">
          <div className="card-header"><span className="card-title"><i className="fa-solid fa-layer-group text-primary-color" />&nbsp; Step 3 — Destination Rack</span></div>
          <div className="card-body">
            <div className="grid gap-col-6" style={{ gridTemplateColumns: '340px 1fr', alignItems: 'end' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">To Rack (emptiest first)</label>
                <select className="form-control" value={toRackId} onChange={(e) => setToRackId(e.target.value)}>
                  <option value="">Select destination…</option>
                  {destRacks.map((r) => <option key={r.rack_id} value={r.rack_id}>{r.rack_id} ({r.available} free{r.status === 'Vacant' ? ', empty' : ''})</option>)}
                </select>
              </div>

              {destRack && (
                <div className="flex items-center gap-4 p-4" style={{ background: 'var(--bg)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div className="text-xs text-muted">From</div>
                    <div className="font-700 text-primary-color">{source.rack_id}</div>
                  </div>
                  <div style={{ color: 'var(--primary)', fontSize: 22 }}><i className="fa-solid fa-arrow-right-long" /></div>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div className="text-xs text-muted">To (after)</div>
                    <div className="font-700 text-primary-color">{destRack.rack_id}</div>
                    <div className="progress mt-1"><div className={`progress-bar ${pctColorClass(pct(destRack.used + Number(qty || 0), destRack.capacity))}`} style={{ width: `${pct(destRack.used + Number(qty || 0), destRack.capacity)}%` }} /></div>
                  </div>
                </div>
              )}
            </div>
            <button className="btn btn-primary mt-4" onClick={doMove} disabled={!toRackId}>
              <i className="fa-solid fa-check" /> Move {qty} × {variant.item} → {toRackId || 'rack'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
