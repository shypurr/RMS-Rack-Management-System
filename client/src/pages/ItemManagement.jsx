import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';

export default function ItemManagement() {
  const toast = useToast();
  const [items, setItems] = useState([]); // all item_location rows
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null); // a design group

  useEffect(() => {
    api.listItems()
      .then(setItems)
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, []);

  // One group per design (item name): total qty, distinct racks, and every row.
  // Grouping stays on the name alone — item_code is an attribute of the design,
  // and rows added before the column existed carry '' until they're backfilled,
  // so keying on it would split one design into two lines.
  const designs = useMemo(() => {
    const map = new Map();
    for (const r of items) {
      const g = map.get(r.item) || { item: r.item, code: '', total: 0, racks: new Set(), rows: [] };
      g.total += r.qty;
      g.code ||= r.item_code || '';
      g.racks.add(r.rack_id);
      g.rows.push(r);
      map.set(r.item, g);
    }
    return [...map.values()]
      .map((g) => ({ ...g, rackCount: g.racks.size }))
      .sort((a, b) => a.item.localeCompare(b.item));
  }, [items]);

  const q = search.trim().toLowerCase();
  const filtered = designs.filter(
    (d) => d.item.toLowerCase().includes(q) || d.code.toLowerCase().includes(q)
  );
  const totalUnits = designs.reduce((s, d) => s + d.total, 0);

  return (
    <>
      <div className="breadcrumb-bar"><span>Item Management</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Item Management</h1>
          <p className="page-subtitle">Every item in stock — where it lives and how much</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body" style={{ padding: '14px 20px' }}>
          <div className="flex gap-6 flex-wrap items-center" style={{ fontSize: 13 }}>
            <span><strong>{designs.length}</strong> Designs</span>
            <span><strong>{totalUnits}</strong> Units in stock</span>
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div className="input-group" style={{ minWidth: 180 }}>
            <span className="input-icon"><i className="fa-solid fa-search" /></span>
            <input className="form-control" placeholder="Search item name or code…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title"><i className="fa-solid fa-box text-primary-color" />&nbsp; Items</span></div>
        <div className="card-body">
          {loading ? (
            <div className="grid cols-1 gap-col-4">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 48 }} />)}
            </div>
          ) : filtered.length ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead><tr><th>Item</th><th>Item Code</th><th>Total Qty</th><th>Racks</th><th></th></tr></thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr key={d.item}>
                      <td className="font-600">{d.item}</td>
                      <td className="text-muted">{d.code || '—'}</td>
                      <td>{d.total}</td>
                      <td>{d.rackCount}</td>
                      <td><button className="btn btn-outline btn-sm" onClick={() => setSelected(d)}>View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state"><i className="fa-solid fa-box-open" /><p>No items match your search</p></div>
          )}
        </div>
      </div>

      {selected && <ItemModal design={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function ItemModal({ design, onClose }) {
  // Sort rows for a stable read: color, then size.
  const rows = [...design.rows].sort((a, b) =>
    (a.color || '').localeCompare(b.color || '') || (a.size || '').localeCompare(b.size || '')
  );
  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{design.item}</h2>
            {design.code && <div className="text-xs text-muted">{design.code}</div>}
          </div>
          <div className="modal-close" onClick={onClose}><i className="fa-solid fa-xmark" /></div>
        </div>
        <div className="modal-body">
          <div className="flex gap-4 mb-4">
            <Stat label="Total Qty" value={design.total} />
            <Stat label="Racks" value={design.rackCount} />
            <Stat label="Variants" value={rows.length} />
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Color</th><th>Size</th><th>Rack</th><th>Qty</th><th>Source</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.color || '—'}</td>
                    <td>{r.size || '—'}</td>
                    <td className="font-600 text-primary-color">{r.rack_id}</td>
                    <td>{r.qty}</td>
                    <td>{r.module_type
                      ? <span className="badge badge-primary" title={r.module_id || ''}>{r.module_type}{r.module_id ? ` · ${r.module_id}` : ''}</span>
                      : <span className="text-muted">Manual</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ textAlign: 'center', flex: 1, background: 'var(--bg)', padding: 12, borderRadius: 'var(--radius-md)' }}>
      <div className="font-700" style={{ fontSize: 18 }}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
