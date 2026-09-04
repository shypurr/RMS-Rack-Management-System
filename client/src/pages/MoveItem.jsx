import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { pct, pctColorClass, sortByEmptiness } from '../lib/rack.js';
import { matches, moduleCode } from '../lib/items.js';
import { usePaged } from '../lib/paging.js';
import LoadMore from '../components/LoadMore.jsx';
import RackPicker from '../components/RackPicker.jsx';

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
  // Numeric rack_master.id; the combobox shows rack_id, the derived code.
  const [toRackId, setToRackId] = useState(null);

  const loadRacks = () => api.listRacks().then(setRacks).catch((e) => toast(e.message, 'error'));
  const loadItems = () => api.listItems().then(setItems).catch((e) => toast(e.message, 'error'));
  useEffect(() => { loadRacks(); loadItems(); }, []);

  // Distinct item+color+size variants, with total qty across racks. A variant
  // can hold stock from several module documents, so every code is kept — both
  // to show and to search on.
  const variants = useMemo(() => {
    const map = new Map();
    for (const r of items) {
      const k = variantKey(r);
      const v = map.get(k) || { item: r.item, color: r.color, size: r.size, total: 0, codes: new Set() };
      v.total += r.qty;
      v.codes.add(moduleCode(r));
      map.set(k, v);
    }
    return [...map.values()].sort((a, b) => a.item.localeCompare(b.item));
  }, [items]);

  const filteredVariants = variants.filter((v) =>
    matches(`${v.item} ${v.color} ${v.size} ${[...v.codes].join(' ')}`, search)
  );

  // Ten items at a time in the picker, and ten racks at a time in the list of
  // places this one is stored — a design that has been received all year can
  // sit in dozens of bins.
  const itemPage = usePaged(filteredVariants, { resetKey: search });
  const placementPage = usePaged(placements, { resetKey: variant ? variantKey(variant) : '' });

  // When a variant is chosen, find every rack that holds it.
  const chooseVariant = async (v) => {
    setVariant(v); setSource(null); setToRackId(null); setQty(1); setPlacements([]);
    try {
      setPlacements(await api.findPlacements(v.item, v.color, v.size));
    } catch (e) { toast(e.message, 'error'); }
  };

  const chooseSource = (p) => { setSource(p); setQty(1); setToRackId(null); };

  const destCandidates = sortByEmptiness(racks.filter((r) => r.id !== source?.fk_rack_id));
  const destRack = racks.find((r) => r.id === toRackId);

  // The quantity box holds text while it is being typed, and can be empty or
  // hold more than the rack has. Every sum in the picture below reads this
  // instead, so a half-typed box shows 0 rather than NaN, and typing 500 where
  // 5 are stored does not draw "5 left after: -495". The real limit is still
  // enforced in doMove and again on the server.
  const moving = Math.max(0, Math.min(Number(qty) || 0, source?.qty ?? 0));

  const reset = () => { setVariant(null); setPlacements([]); setSource(null); setToRackId(null); setQty(1); setSearch(''); };

  const doMove = async () => {
    if (!source || !toRackId) return toast('Pick a source rack and a destination', 'warning');
    if (qty <= 0 || qty > source.qty) return toast(`Quantity must be 1–${source.qty}`, 'warning');
    try {
      await api.move(source.id, toRackId, Number(qty));
      toast(`Moved ${qty} × ${variant.item} → ${destRack?.rack_id ?? 'rack'}`, 'success');
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
              <input className="form-control" placeholder="Search module code (e.g. SGR-1), item, color or size…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {/* Scrolls inside the card rather than stretching it: "Show 10
                more" must not walk the button down the page. The count below
                sits outside the scroll area so it is always in view. */}
            <div className="data-table-wrap scroll-list">
              <table className="data-table">
                <thead><tr><th>Item</th><th>Color</th><th>Size</th><th>Total</th><th></th></tr></thead>
                <tbody>
                  {itemPage.visible.map((v) => {
                    const chosen = variant && variantKey(variant) === variantKey(v);
                    return (
                      <tr key={variantKey(v)} style={{ background: chosen ? 'var(--primary-alpha)' : undefined }}>
                        <td>
                          <div>{v.item}</div>
                          <ModuleCodes codes={v.codes} />
                        </td>
                        <td>{v.color || '—'}</td><td>{v.size || '—'}</td><td>{v.total}</td>
                        <td><button className="btn btn-outline btn-sm" onClick={() => chooseVariant(v)}>{chosen ? 'Selected' : 'Select'}</button></td>
                      </tr>
                    );
                  })}
                  {!filteredVariants.length && <tr><td colSpan={5} className="text-muted" style={{ textAlign: 'center' }}>No items match</td></tr>}
                </tbody>
              </table>
            </div>
            <LoadMore {...itemPage} noun="items" onMore={itemPage.loadMore} />
          </div>
        </div>

        {/* Step 2 — where it is now, how many, and where it is going.
            Choosing a destination used to be a third card BELOW this pair, so
            picking the rack to move to meant scrolling away from the rack you
            had just picked to move from. The whole decision is one thought and
            now lives in one card.
            overflow:visible so the rack dropdown is not clipped by the card. */}
        <div className="card" style={{ overflow: 'visible' }}>
          <div className="card-header"><span className="card-title"><i className="fa-solid fa-location-dot text-primary-color" />&nbsp; Step 2 — Move it</span></div>
          <div className="card-body">
            {!variant ? (
              <div className="empty-state"><i className="fa-solid fa-hand-pointer" /><p>Select an item first</p></div>
            ) : !placements.length ? (
              <div className="empty-state"><i className="fa-solid fa-inbox" /><p>This item isn't in any rack</p></div>
            ) : (
              <>
                <p className="text-sm text-muted mb-3">Stored in {placements.length} rack{placements.length > 1 ? 's' : ''} — pick one to move from:</p>
                <div className="scroll-list scroll-list-compact mb-4">
                <div className="grid cols-2 gap-col-4">
                  {placementPage.visible.map((p) => {
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
                </div>
                <LoadMore {...placementPage} noun="racks" onMore={placementPage.loadMore} />
                {source && (
                  <>
                    <div className="form-group">
                      <label className="form-label">How many to move (most you can is {source.qty})</label>
                      <input className="form-control" type="number" min="1" max={source.qty} value={qty} onChange={(e) => setQty(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Move it to (emptiest racks first)</label>
                      <RackPicker key={source.id} candidates={destCandidates} value={toRackId} onChange={setToRackId} placeholder="Search rack ID…" />
                    </div>
                    {/* The button belongs with the boxes that decide what it
                        does, not under the picture below — that card only shows
                        what is about to happen. */}
                    <button className="btn btn-primary" onClick={doMove} disabled={!toRackId}>
                      <i className="fa-solid fa-check" />&nbsp;
                      Move {moving} × {variant.item} → {destRack?.rack_id || 'rack'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* No heading on purpose. This is not a third step to work through — it
          is a picture of what the two cards above are about to do, so a title
          numbering it would send people looking for something else to fill in.
          It appears as soon as a rack is chosen to move from, and fills in the
          right-hand side once a destination is picked. */}
      {source && (
        <div className="card mt-4">
          <div className="card-body">
            <div className="flex items-center gap-4 p-4" style={{ background: 'var(--bg)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ textAlign: 'center', flex: 1 }}>
                <div className="text-xs text-muted">From</div>
                <div className="font-700 text-primary-color" style={{ fontSize: 16 }}>{source.rack_id}</div>
                <div className="text-xs text-muted mt-1">
                  {source.qty} in there now · {Math.max(0, source.qty - moving)} left after
                </div>
              </div>

              <div style={{ color: 'var(--primary)', fontSize: 22 }}><i className="fa-solid fa-arrow-right-long" /></div>

              <div style={{ textAlign: 'center', flex: 1 }}>
                <div className="text-xs text-muted">To</div>
                {destRack ? (
                  <>
                    <div className="font-700 text-primary-color" style={{ fontSize: 16 }}>{destRack.rack_id}</div>
                    <div className="progress mt-1">
                      <div
                        className={`progress-bar ${pctColorClass(pct(destRack.used + moving, destRack.capacity))}`}
                        style={{ width: `${pct(destRack.used + moving, destRack.capacity)}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted mt-1">
                      {destRack.used} in there now · {destRack.used + moving} after
                    </div>
                  </>
                ) : (
                  <div className="text-muted" style={{ fontSize: 16, fontWeight: 700 }}>Not chosen yet</div>
                )}
              </div>
            </div>

            {/* Which item is making the trip. The racks either side say where;
                without this the picture never says what. */}
            <p className="text-sm text-muted mt-3" style={{ textAlign: 'center' }}>
              Moving <strong>{moving}</strong> × <strong>{variant.item}</strong>
              {variant.color ? ` · ${variant.color}` : ''}
              {variant.size ? ` · ${variant.size}` : ''}
              {destRack ? '' : ' — pick a rack above to move it to.'}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// The module documents a variant's stock arrived on. Two are enough to
// recognise it; the rest collapse into a count so the cell stays one line.
function ModuleCodes({ codes }) {
  const list = [...codes];
  if (!list.length) return null;
  const shown = list.slice(0, 2).join(', ');
  const rest = list.length - 2;
  return (
    <div className="text-xs text-muted">
      {shown}{rest > 0 ? ` +${rest}` : ''}
    </div>
  );
}

