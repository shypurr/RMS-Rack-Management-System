import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import RackCard from '../components/RackCard.jsx';
import { pct, pctColorClass, occupancyBucket } from '../lib/rack.js';
import { MANUAL, matches, searchText } from '../lib/items.js';
import { usePaged } from '../lib/paging.js';
import LoadMore from '../components/LoadMore.jsx';

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
  const [editing, setEditing] = useState(null);

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

  // Ten rack tiles at a time. A warehouse of a hundred racks drew a hundred
  // tiles with a progress bar in each, on every keystroke of the search box.
  const rackPage = usePaged(filtered, { resetKey: `${search}|${statusFilter}` });

  const openRack = racks.find((r) => r.rack_no === openRackNo) || null;

  // A rack with anything in it cannot be reshaped: changing its shelves or bins
  // deletes bins, and a bin holding stock cannot be deleted without losing
  // track of that stock in the real warehouse.
  //
  // The refusal names what is in the way. "Only empty racks can be edited" is
  // true but leaves the user to go and work out which of 21 bins is holding
  // things up — the numbers are already on this screen, so it may as well say.
  //
  // This check is a courtesy, not the guard: the server re-checks inside the
  // transaction with the rows locked, because stock can arrive from another
  // computer between this page loading and the dialog being saved.
  const openEdit = (rack) => {
    if (rack.used > 0) {
      const usedBins = rack.bins.filter((b) => Number(b.used) > 0).length;
      toast(
        `${rack.rack_id} has ${rack.used} item${rack.used === 1 ? '' : 's'} in ` +
        `${usedBins} bin${usedBins === 1 ? '' : 's'}. Move them out first, then you ` +
        'can change this rack.',
        'warning'
      );
      return;
    }
    setEditing(rack);
  };

  const editDialog = editing && (
    <EditRackDialog
      rack={editing}
      onClose={() => setEditing(null)}
      onSaved={async (summary) => {
        setEditing(null);
        toast(summary, 'success');
        await load();
      }}
    />
  );

  // Nothing on this screen changes stock. Quantities are set by Putaway, taken
  // by the Picklist and relocated by Move Item — each of those is a real
  // warehouse event with an audit trail behind it. Typing a new number into a
  // box is not, and a screen that allows it is a screen where stock silently
  // stops matching the shelf.

  if (openRack) {
    return (
      <>
        <RackDetail
          rack={openRack}
          itemsByBin={itemsByBin}
          onBack={() => setOpenRackNo(null)}
          onEdit={() => openEdit(openRack)}
        />
        {editDialog}
      </>
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
            <>
            <div className="grid cols-4 gap-col-4">
              {rackPage.visible.map((r) => (
                <RackCard
                  key={r.rack_no}
                  rack={r}
                  subtitle={`${r.shelves} shelves · ${r.bins.length} bins`}
                  onClick={() => setOpenRackNo(r.rack_no)}
                  onEdit={() => openEdit(r)}
                />
              ))}
            </div>
            <LoadMore {...rackPage} noun="racks" onMore={rackPage.loadMore} />
            </>
          ) : (
            <div className="empty-state"><i className="fa-solid fa-box-open" /><p>No racks match your filters</p></div>
          )}
        </div>
      </div>

      {editDialog}
    </>
  );
}

// One rack, opened: its shelves in order, each shelf's bins beside it, and the
// stock in every bin. Full width because a rack is as wide as its shelves are —
// a 13-bin shelf has nowhere to go in a dialog.
function RackDetail({ rack, itemsByBin, onBack, onEdit }) {
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

  const shelfPage = usePaged(shelves, { resetKey: rack.rack_no });

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
        <div className="flex gap-3">
          {/* Also here, not only on the tile: someone who has opened a rack and
              seen for themselves that it is empty should not have to go back
              out to the grid to change it. */}
          <button className="btn btn-outline" onClick={onEdit}>
            <i className="fa-solid fa-pen" />&nbsp; Edit this rack
          </button>
          <button className="btn btn-outline" onClick={onBack}>
            <i className="fa-solid fa-arrow-left" />&nbsp; All racks
          </button>
        </div>
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

      {shelfPage.visible.map((s) => (
        <ShelfCard key={s.shelf_no} shelf={s} itemsByBin={itemsByBin} />
      ))}
      <LoadMore {...shelfPage} noun="shelves" onMore={shelfPage.loadMore} />

      <p className="text-xs text-muted mt-4">
        This is a read-only view of what is on the shelf. Stock arrives through Putaway,
        leaves through the Picklist, and changes rack through Move Item.
      </p>
    </>
  );
}

// One shelf, and ten of its bins at a time. A shelf is its own component
// because each one carries its own "show ten more" — a rack of 7 shelves × 21
// bins is 147 bin cards, each with a progress bar and a small table inside, and
// that one screen was the heaviest thing the portal drew.
function ShelfCard({ shelf, itemsByBin }) {
  const page = usePaged(shelf.bins, { resetKey: shelf.shelf_no });
  return (
    <div className="card mb-4">
      <div className="card-header">
        <span className="card-title">
          <i className="fa-solid fa-layer-group text-primary-color" />&nbsp; Shelf {shelf.label}
        </span>
        <span className="text-sm text-muted ml-auto">
          {shelf.used.toLocaleString()} / {shelf.capacity.toLocaleString()} used · {shelf.bins.length} bins
        </span>
      </div>
      <div className="card-body">
        <div className="bin-row">
          {page.visible.map((b) => (
            <BinCard key={b.id} bin={b} items={itemsByBin.get(b.id) || []} />
          ))}
        </div>
        <LoadMore {...page} noun="bins" onMore={page.loadMore} />
      </div>
    </div>
  );
}

// One bin and what is in it. An empty bin still gets a card — the point of this
// screen is seeing where the space is, and a gap in the grid says that better
// than a missing tile would.
function BinCard({ bin, items }) {
  const p = pct(bin.used, bin.capacity);
  const page = usePaged(items, { resetKey: bin.id });
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
        <>
        <table className="bin-items">
          <tbody>
            {page.visible.map((it) => (
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
        {/* quiet: a bin usually holds two or three lines, and a footer saying
            "showing 3 of 3" on every tile would be noise on a 21-bin shelf. */}
        <LoadMore {...page} noun="lines here" onMore={page.loadMore} quiet />
        </>
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

// Reshaping one rack: how many shelves it has, how many bins on each shelf, and
// how much fits in a bin.
//
// Only ever opened for a rack with nothing in it. The caller checks before
// opening so the refusal is instant; the server checks again with the rows
// locked, because stock can arrive from another computer in between.
//
// The rack's NUMBER is not on this form. R001 is painted on a real rack in a
// real warehouse — renaming it here would rename nothing there.
function EditRackDialog({ rack, onClose, onSaved }) {
  const toast = useToast();

  // The current shape, read back off the rack's own bins. There is no
  // rack-level row to read it from: rack_master holds one row per bin, so
  // "7 shelves" is a count of distinct shelf numbers rather than a stored
  // figure, and the capacity is one bin's, not the rack's.
  const current = useMemo(() => ({
    shelves: new Set(rack.bins.map((b) => b.shelf_no)).size,
    bins: Math.max(...rack.bins.map((b) => b.bin_no)),
    bin_capacity: Math.max(...rack.bins.map((b) => Number(b.capacity))),
  }), [rack]);

  const [form, setForm] = useState({
    shelves: String(current.shelves),
    bins: String(current.bins),
    bin_capacity: String(current.bin_capacity),
  });
  const [busy, setBusy] = useState(false);

  const n = (v) => Number(v) || 0;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v.replace(/[^0-9]/g, '') }));

  const complete = n(form.shelves) > 0 && n(form.bins) > 0 && n(form.bin_capacity) > 0;
  const binsAfter = n(form.shelves) * n(form.bins);
  const removing = Math.max(0, rack.bins.length - binsAfter);
  const adding = Math.max(0, binsAfter - rack.bins.length);
  const unchanged = complete
    && n(form.shelves) === current.shelves
    && n(form.bins) === current.bins
    && n(form.bin_capacity) === current.bin_capacity;

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.editRack(rack.rack_no, {
        shelves: n(form.shelves), bins: n(form.bins), bin_capacity: n(form.bin_capacity),
      });
      onSaved(`${res.label} now has ${res.shelves} shelves and ${res.binsAfter} bins.`);
    } catch (e) {
      // Most likely something was put into the rack while this dialog was open.
      // The message from the server says so and names the amount, so it is
      // shown as it is rather than replaced with a generic failure.
      toast(e.message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop open" onMouseDown={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Edit {rack.rack_id}</span>
          <div className="modal-close" onClick={() => !busy && onClose()}>
            <i className="fa-solid fa-xmark" />
          </div>
        </div>

        <div className="modal-body">
          <div className="grid cols-3 gap-col-4">
            <div>
              <label className="form-label">Shelves</label>
              <input className="form-control" type="number" min="1" autoFocus
                value={form.shelves} onChange={(e) => set('shelves', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Bins per shelf</label>
              <input className="form-control" type="number" min="1"
                value={form.bins} onChange={(e) => set('bins', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Capacity per bin</label>
              <input className="form-control" type="number" min="1"
                value={form.bin_capacity} onChange={(e) => set('bin_capacity', e.target.value)} />
            </div>
          </div>

          {/* What the numbers add up to, before they are saved. Capacity per bin
              is the one people read as "how many bins" — spelling out both
              figures is what stops a 10 meant as bins arriving as capacity. */}
          {complete ? (
            <p className="rack-edit-effect text-muted mt-4">
              {rack.rack_id} will have <strong>{form.shelves}</strong> shelves of{' '}
              <strong>{form.bins}</strong> bins — <strong>{binsAfter.toLocaleString()}</strong> bins
              in all, holding <strong>{form.bin_capacity}</strong> each, so{' '}
              <strong>{(binsAfter * n(form.bin_capacity)).toLocaleString()}</strong> in total.
              <br />
              {removing > 0 && (
                <span className="removing">
                  <i className="fa-solid fa-triangle-exclamation" />&nbsp;
                  This removes {removing.toLocaleString()} empty bin{removing === 1 ? '' : 's'} from
                  this rack. Nothing is stored in them.
                </span>
              )}
              {adding > 0 && <>This adds {adding.toLocaleString()} new bin{adding === 1 ? '' : 's'}.</>}
              {removing === 0 && adding === 0 && (unchanged
                ? 'Nothing has changed yet.'
                : 'The same number of bins, with a different capacity.')}
            </p>
          ) : (
            <p className="text-sm text-muted mt-4">Fill in all three numbers.</p>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !complete || unchanged}>
            <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-check'}`} />
            &nbsp; {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
