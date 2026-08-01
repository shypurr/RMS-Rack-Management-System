import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import RackCard from '../components/RackCard.jsx';
import { pct, pctColorClass } from '../lib/rack.js';
import { MANUAL, matches, searchText } from '../lib/items.js';

export default function RackList() {
  const toast = useToast();
  const [racks, setRacks] = useState([]);
  const [items, setItems] = useState([]); // stock rows, so racks are findable by what's in them
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null); // rack detail (with items)

  const load = async () => {
    setLoading(true);
    try {
      const [rackList, itemList] = await Promise.all([api.listRacks(), api.listItems()]);
      setRacks(rackList);
      setItems(itemList);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openRack = async (rackId) => {
    try {
      setSelected(await api.getRack(rackId));
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const stats = useMemo(() => {
    const vacant = racks.filter((r) => r.status === 'Vacant').length;
    const occupied = racks.filter((r) => r.status === 'Occupied').length;
    return { vacant, occupied, total: racks.length };
  }, [racks]);

  // Everything a rack can be found by: its own id, plus the item names and
  // module codes of the stock sitting in it — so "SGR-1" shows the racks that
  // document's goods went into.
  const rackText = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      map.set(it.rack_id, `${map.get(it.rack_id) || ''} ${searchText(it)}`);
    }
    return map;
  }, [items]);

  const filtered = racks.filter(
    (r) =>
      matches(`${r.rack_id} ${rackText.get(r.rack_id) || ''}`, search) &&
      (!statusFilter || r.status === statusFilter)
  );

  return (
    <>
      <div className="breadcrumb-bar"><span>Rack Management</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Rack Management</h1>
          <p className="page-subtitle">Live occupancy across all rack bins</p>
        </div>
      </div>

      {/* Legend + stats */}
      <div className="card mb-4">
        <div className="card-body" style={{ padding: '14px 20px' }}>
          <div className="flex gap-6 flex-wrap items-center">
            <Legend color="var(--text-muted)" label="Vacant" />
            <Legend color="var(--success)" label="Low (1–49%)" />
            <Legend color="var(--warning)" label="Partial (50–84%)" />
            <Legend color="var(--danger)" label="Full (≥85%)" />
            <div className="ml-auto flex gap-4" style={{ fontSize: 13 }}>
              <span><strong>{stats.vacant}</strong> Vacant</span>
              <span><strong>{stats.occupied}</strong> Occupied</span>
              <span><strong>{stats.total}</strong> Total</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="flex gap-3 flex-wrap">
            <div className="input-group" style={{ flex: 1, minWidth: 180 }}>
              <span className="input-icon"><i className="fa-solid fa-search" /></span>
              <input className="form-control" placeholder="Search rack ID, module code (e.g. SGR-1) or item name…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="form-control" style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="Vacant">Vacant</option>
              <option value="Occupied">Occupied</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="card">
        <div className="card-header"><span className="card-title"><i className="fa-solid fa-warehouse text-primary-color" />&nbsp; Rack Bins</span></div>
        <div className="card-body">
          {loading ? (
            <div className="grid cols-4 gap-col-4">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 100 }} />)}
            </div>
          ) : filtered.length ? (
            <div className="grid cols-4 gap-col-4">
              {filtered.map((r) => <RackCard key={r.rack_id} rack={r} onClick={() => openRack(r.rack_id)} />)}
            </div>
          ) : (
            <div className="empty-state"><i className="fa-solid fa-box-open" /><p>No racks match your filters</p></div>
          )}
        </div>
      </div>

      {selected && <RackModal rack={selected} onClose={() => setSelected(null)} onChanged={async () => { await load(); await openRack(selected.rack_id); }} />}
    </>
  );
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-2">
      <div style={{ width: 12, height: 12, borderRadius: '50%', background: color }} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function RackModal({ rack, onClose, onChanged }) {
  const toast = useToast();
  const p = pct(rack.used, rack.capacity);

  const setQty = async (id, qty) => {
    try {
      await api.updateItemQty(id, qty);
      toast(qty === 0 ? 'Item removed' : 'Quantity updated', 'success');
      onChanged();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <h2 className="modal-title">{rack.rack_id}</h2>
          <div className="modal-close" onClick={onClose}><i className="fa-solid fa-xmark" /></div>
        </div>
        <div className="modal-body">
          <div className="flex gap-4 mb-4">
            <Stat label="Capacity" value={rack.capacity} />
            <Stat label="Used" value={rack.used} />
            <Stat label="Available" value={rack.available} />
            <Stat label="Status" value={rack.status} />
          </div>
          <div className="progress mb-4"><div className={`progress-bar ${pctColorClass(p)}`} style={{ width: `${p}%` }} /></div>

          {rack.items.length ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Module</th><th>Item</th><th>Color</th><th>Size</th><th>Qty</th><th></th></tr>
                </thead>
                <tbody>
                  {rack.items.map((it) => (
                    <tr key={it.id}>
                      <td>
                        {it.module_id
                          ? <div>
                              <div className="font-700 text-primary-color">{it.module_id}</div>
                              {it.module_type && <div className="text-xs text-muted">{it.module_type}</div>}
                            </div>
                          : <span className="text-muted">{MANUAL}</span>}
                      </td>
                      <td>{it.item}</td>
                      <td>{it.color || '—'}</td>
                      <td>{it.size || '—'}</td>
                      <td>
                        <input type="number" min="0" defaultValue={it.qty} style={{ width: 70 }} className="form-control"
                          onKeyDown={(e) => { if (e.key === 'Enter') setQty(it.id, Number(e.target.value)); }} />
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => setQty(it.id, 0)} title="Remove">
                          <i className="fa-solid fa-trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted mt-4">Edit a quantity and press Enter to save. Set to 0 (or trash) to remove.</p>
            </div>
          ) : (
            <div className="empty-state"><i className="fa-solid fa-inbox" /><p>This rack is empty</p></div>
          )}
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
