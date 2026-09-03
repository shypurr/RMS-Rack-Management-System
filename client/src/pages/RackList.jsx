import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import RackCard from '../components/RackCard.jsx';
import { pct, pctColorClass, occupancyBucket } from '../lib/rack.js';
import { MANUAL, matches, searchText } from '../lib/items.js';

// Rack Management, two levels deep: racks, then one rack's shelves and bins.
//
// `rack_master` is really the BIN table — one row per bin — so listing it
// directly showed 2,050 tiles for 50 racks and called them racks. Nothing about
// a warehouse reads that way. The rows are grouped into racks here instead, and
// the bins only appear once you have picked a rack to look inside.
//
// Both levels come from the two requests the page already made: listRacks() for
// every bin, listItems() for every stock row. Grouping is client-side, so
// opening a rack costs no round trip.

// The display code is built server-side from the org's current pad widths
// ("R001-S01-B01"). Splitting it is how the rack, shelf and bin labels stay
// identical to the server's numbering — recomputing the padding here would be a
// second implementation of the same rule, free to drift from the first.
const parts = (code) => String(code || '').split('-');
const rackLabel = (code) => parts(code)[0] || '';
const shelfLabel = (code) => parts(code)[1] || '';
const binLabel = (code) => parts(code)[2] || '';

export default function RackList() {
  const toast = useToast();
  const [bins, setBins] = useState([]);
  const [items, setItems] = useState([]); // stock rows, so racks are findable by what's in them
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [openRackNo, setOpenRackNo] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [binList, itemList] = await Promise.all([api.listRacks(), api.listItems()]);
      setBins(binList);
      setItems(itemList);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Stock keyed by the bin holding it. `fk_rack_id` is the bin's row id.
  const itemsByBin = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      const list = m.get(it.fk_rack_id) || [];
      list.push(it);
      m.set(it.fk_rack_id, list);
    }
    return m;
  }, [items]);

  // Bins folded into the racks they belong to. A rack's capacity and used are
  // the sums of its bins — there is no rack-level row to read them from.
  const racks = useMemo(() => {
    const m = new Map();
    for (const b of bins) {
      const g = m.get(b.rack_no) || {
        rack_no: b.rack_no,
        rack_id: rackLabel(b.rack_id),
        bins: [],
        capacity: 0,
        used: 0,
      };
      g.bins.push(b);
      g.capacity += Number(b.capacity) || 0;
      g.used += Number(b.used) || 0;
      m.set(b.rack_no, g);
    }
    return [...m.values()]
      .sort((a, z) => a.rack_no - z.rack_no)
      .map((g) => ({
        ...g,
        available: g.capacity - g.used,
        // A rack is occupied if anything anywhere inside it is — the same rule
        // the bin rows use, lifted one level.
        status: g.used > 0 ? 'Occupied' : 'Vacant',
        shelves: new Set(g.bins.map((b) => b.shelf_no)).size,
      }));
  }, [bins]);

  const stats = useMemo(() => ({
    vacant: racks.filter((r) => r.status === 'Vacant').length,
    occupied: racks.filter((r) => r.status === 'Occupied').length,
    total: racks.length,
    bins: bins.length,
  }), [racks, bins]);

  // Everything a rack can be found by: its own label, plus the item names and
  // module codes of every stock row anywhere inside it — so "SGR-1" still finds
  // the rack that document's goods went into, now that the tiles are racks.
  const rackText = useMemo(() => {
    const m = new Map();
    for (const r of racks) {
      const text = r.bins
        .flatMap((b) => itemsByBin.get(b.id) || [])
        .map(searchText)
        .join(' ');
      m.set(r.rack_no, text);
    }
    return m;
  }, [racks, itemsByBin]);

  const filtered = racks.filter(
    (r) =>
      matches(`${r.rack_id} ${rackText.get(r.rack_no) || ''}`, search) &&
      (!statusFilter || r.status === statusFilter)
  );

  const openRack = racks.find((r) => r.rack_no === openRackNo) || null;

  // Nothing on this screen changes stock. Quantities are set by Putaway, taken
  // by the Picklist and relocated by Move Item — each of those is a real
  // warehouse event with an audit trail behind it. Typing a new number into a
  // box is not, and a screen that allows it is a screen where stock silently
  // stops matching the shelf.

  if (openRack) {
    return (
      <RackDetail
        rack={openRack}
        itemsByBin={itemsByBin}
        onBack={() => setOpenRackNo(null)}
      />
    );
  }

  return (
    <>
      <div className="breadcrumb-bar"><span>Rack Management</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Rack Management</h1>
          <p className="page-subtitle">Live occupancy across your racks — open one to see its shelves and bins</p>
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
              <span><strong>{stats.total}</strong> Racks</span>
              <span className="text-muted"><strong>{stats.bins.toLocaleString()}</strong> bins</span>
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
              <input className="form-control" placeholder="Search rack, module code (e.g. SGR-1) or item name…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
        <div className="card-header"><span className="card-title"><i className="fa-solid fa-warehouse text-primary-color" />&nbsp; Racks</span></div>
        <div className="card-body">
          {loading ? (
            <div className="grid cols-4 gap-col-4">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 100 }} />)}
            </div>
          ) : filtered.length ? (
            <div className="grid cols-4 gap-col-4">
              {filtered.map((r) => (
                <RackCard
                  key={r.rack_no}
                  rack={r}
                  subtitle={`${r.shelves} shelves · ${r.bins.length} bins`}
                  onClick={() => setOpenRackNo(r.rack_no)}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state"><i className="fa-solid fa-box-open" /><p>No racks match your filters</p></div>
          )}
        </div>
      </div>
    </>
  );
}

// One rack, opened: its shelves in order, each shelf's bins beside it, and the
// stock in every bin. Full width because a rack is as wide as its shelves are —
// a 13-bin shelf has nowhere to go in a dialog.
function RackDetail({ rack, itemsByBin, onBack }) {
  const p = pct(rack.used, rack.capacity);

  const shelves = useMemo(() => {
    const m = new Map();
    for (const b of rack.bins) {
      const s = m.get(b.shelf_no) || { shelf_no: b.shelf_no, label: shelfLabel(b.rack_id), bins: [], capacity: 0, used: 0 };
      s.bins.push(b);
      s.capacity += Number(b.capacity) || 0;
      s.used += Number(b.used) || 0;
      m.set(b.shelf_no, s);
    }
    return [...m.values()]
      .sort((a, z) => a.shelf_no - z.shelf_no)
      .map((s) => ({ ...s, bins: s.bins.slice().sort((a, z) => a.bin_no - z.bin_no) }));
  }, [rack]);

  return (
    <>
      <div className="breadcrumb-bar">
        <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>Rack Management</a>
        <span className="text-muted">&nbsp;›&nbsp;</span>
        <span>{rack.rack_id}</span>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{rack.rack_id}</h1>
          <p className="page-subtitle">{shelves.length} shelves · {rack.bins.length} bins</p>
        </div>
        <button className="btn btn-outline" onClick={onBack}>
          <i className="fa-solid fa-arrow-left" />&nbsp; All racks
        </button>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div className="flex gap-4 mb-4">
            <Stat label="Capacity" value={rack.capacity.toLocaleString()} />
            <Stat label="Used" value={rack.used.toLocaleString()} />
            <Stat label="Available" value={rack.available.toLocaleString()} />
            <Stat label="Status" value={rack.status} />
          </div>
          <div className="progress"><div className={`progress-bar ${pctColorClass(p)}`} style={{ width: `${p}%` }} /></div>
        </div>
      </div>

      {shelves.map((s) => (
        <div key={s.shelf_no} className="card mb-4">
          <div className="card-header">
            <span className="card-title">
              <i className="fa-solid fa-layer-group text-primary-color" />&nbsp; Shelf {s.label}
            </span>
            <span className="text-sm text-muted ml-auto">
              {s.used.toLocaleString()} / {s.capacity.toLocaleString()} used · {s.bins.length} bins
            </span>
          </div>
          <div className="card-body">
            <div className="bin-row">
              {s.bins.map((b) => (
                <BinCard key={b.id} bin={b} items={itemsByBin.get(b.id) || []} />
              ))}
            </div>
          </div>
        </div>
      ))}

      <p className="text-xs text-muted">
        This is a read-only view of what is on the shelf. Stock arrives through Putaway,
        leaves through the Picklist, and changes rack through Move Item.
      </p>
    </>
  );
}

// One bin and what is in it. An empty bin still gets a card — the point of this
// screen is seeing where the space is, and a gap in the grid says that better
// than a missing tile would.
function BinCard({ bin, items }) {
  const p = pct(bin.used, bin.capacity);
  return (
    <div className={`bin-card ${occupancyBucket(bin.used, bin.capacity)}`}>
      <div className="flex items-center gap-2">
        <span className="font-700 text-primary-color">{binLabel(bin.rack_id)}</span>
        <span className="text-xs text-muted ml-auto">{bin.used}/{bin.capacity}</span>
      </div>
      <div className="progress" style={{ margin: '6px 0' }}>
        <div className={`progress-bar ${pctColorClass(p)}`} style={{ width: `${p}%` }} />
      </div>

      {items.length ? (
        <table className="bin-items">
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>
                  <div className="font-600">{it.item}</div>
                  <div className="text-xs text-muted">
                    {[it.color || null, it.size || null].filter(Boolean).join(' · ') || 'No colour or size'}
                    {' · '}
                    {it.module_id
                      ? <span className="text-primary-color">{it.module_id}</span>
                      : MANUAL}
                  </div>
                </td>
                <td style={{ width: 48, textAlign: 'right' }}>
                  <span className="font-700 bin-qty-value">{it.qty}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-xs text-muted" style={{ padding: '6px 0' }}>Empty · {bin.capacity} free</div>
      )}
    </div>
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

function Stat({ label, value }) {
  return (
    <div style={{ textAlign: 'center', flex: 1, background: 'var(--bg)', padding: 12, borderRadius: 'var(--radius-md)' }}>
      <div className="font-700" style={{ fontSize: 18 }}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
