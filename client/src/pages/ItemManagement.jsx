import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { MANUAL, matches, moduleCode } from '../lib/items.js';

export default function ItemManagement() {
  const toast = useToast();
  const [items, setItems] = useState([]); // all item_location rows
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null); // a module+item group

  useEffect(() => {
    api.listItems()
      .then(setItems)
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, []);

  // One line per module document per item — the warehouse reads stock by where
  // it came from, so the same item arriving on two documents stays two lines.
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of items) {
      const code = moduleCode(r);
      const key = `${code}|${r.item}`;
      const g = map.get(key) || {
        key, code, moduleType: r.module_type, item: r.item,
        total: 0, racks: new Set(), rows: [],
      };
      g.total += r.qty;
      g.racks.add(r.rack_id);
      g.rows.push(r);
      map.set(key, g);
    }
    return [...map.values()]
      .map((g) => ({ ...g, rackCount: g.racks.size }))
      // By module code, manual stock last; then by item within a document.
      .sort((a, b) =>
        (a.code === MANUAL) - (b.code === MANUAL) ||
        a.code.localeCompare(b.code) ||
        a.item.localeCompare(b.item)
      );
  }, [items]);

  // Find by item name or by module code — both, on purpose.
  const filtered = groups.filter((g) => matches(`${g.item} ${g.code} ${g.moduleType || ''}`, search));

  const totalUnits = groups.reduce((s, g) => s + g.total, 0);
  const docCount = new Set(groups.filter((g) => g.code !== MANUAL).map((g) => g.code)).size;
  const designCount = new Set(groups.map((g) => g.item)).size;

  return (
    <>
      <div className="breadcrumb-bar"><span>Item Management</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Item Management</h1>
          <p className="page-subtitle">Every item in stock — which module it came from, where it lives and how much</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body" style={{ padding: '14px 20px' }}>
          <div className="flex gap-6 flex-wrap items-center" style={{ fontSize: 13 }}>
            <span><strong>{docCount}</strong> Module documents</span>
            <span><strong>{designCount}</strong> Designs</span>
            <span><strong>{totalUnits}</strong> Units in stock</span>
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div className="input-group" style={{ minWidth: 180 }}>
            <span className="input-icon"><i className="fa-solid fa-search" /></span>
            <input className="form-control" placeholder="Search by module code (e.g. SGR-1) or item name…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                <thead><tr><th>Module</th><th>Item</th><th>Total Qty</th><th>Racks</th><th></th></tr></thead>
                <tbody>
                  {filtered.map((g) => (
                    <tr key={g.key}>
                      <td><ModuleCell code={g.code} type={g.moduleType} /></td>
                      <td className="font-600">{g.item}</td>
                      <td>{g.total}</td>
                      <td>{g.rackCount}</td>
                      <td><button className="btn btn-outline btn-sm" onClick={() => setSelected(g)}>View</button></td>
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

      {selected && <ItemModal group={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

// Document number leads, module type sits underneath as context.
function ModuleCell({ code, type }) {
  if (code === MANUAL) return <span className="text-muted">{MANUAL}</span>;
  return (
    <div>
      <div className="font-700 text-primary-color">{code}</div>
      {type && <div className="text-xs text-muted">{type}</div>}
    </div>
  );
}

function ItemModal({ group, onClose }) {
  // Sort rows for a stable read: color, then size.
  const rows = [...group.rows].sort((a, b) =>
    (a.color || '').localeCompare(b.color || '') || (a.size || '').localeCompare(b.size || '')
  );
  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{group.item}</h2>
            <div className="text-xs text-muted">
              {group.code === MANUAL ? 'Added manually' : `${group.code}${group.moduleType ? ` · ${group.moduleType}` : ''}`}
            </div>
          </div>
          <div className="modal-close" onClick={onClose}><i className="fa-solid fa-xmark" /></div>
        </div>
        <div className="modal-body">
          <div className="flex gap-4 mb-4">
            <Stat label="Total Qty" value={group.total} />
            <Stat label="Racks" value={group.rackCount} />
            <Stat label="Variants" value={rows.length} />
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Color</th><th>Size</th><th>Rack</th><th>Qty</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.color || '—'}</td>
                    <td>{r.size || '—'}</td>
                    <td className="font-600 text-primary-color">{r.rack_id}</td>
                    <td>{r.qty}</td>
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
