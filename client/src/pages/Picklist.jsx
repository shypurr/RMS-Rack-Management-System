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

// The "From Vastra Module" tab is fully wired (DcCombobox, GET /api/picklist/
// :dcNo, the module branch in generate) but Vastra does not serve the Delivery
// Challan module yet, so showing the tab only offers the user something that
// cannot work. Flip this to true the day the module goes live — nothing else
// on this page needs to change.
const VASTRA_DC_READY = false;

// One draft = one line on the challan: a design, in one colour, across a run of
// sizes. Same design in another colour is a second line, exactly as the challan
// prints it. `sizeQty` holds quantities against the sizes that are in stock —
// and only those, because a picklist is stock LEAVING the warehouse and cannot
// take out more than is in it.
const EMPTY_DRAFT = { item: '', color: '', sizeQty: {} };

export default function Picklist() {
  const toast = useToast();
  const [mode, setMode] = useState('manual'); // 'manual' | 'module'

  // The challan is not recreated here — it already exists in the Vastra app.
  // Manual entry is only its item details, transcribed to find the racks, so the
  // challan number is the one header field worth typing. Party was optional,
  // never used to find anything, and is gone; the column still exists server-side
  // so picklists recorded with one keep showing it in History.
  const [dcNo, setDcNo] = useState('');
  const [lines, setLines] = useState([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const [stock, setStock] = useState([]);
  const [detail, setDetail] = useState(null);
  const [alloc, setAlloc] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

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

  // What the challan ALREADY claims of this design+colour, per size. A second
  // line for the same item+colour+size is summed server-side by resolveLines,
  // so the ceiling has to account for it or two half-size lines would together
  // walk past the stock the cap is supposed to enforce.
  const committed = useMemo(() => {
    const m = new Map();
    const item = draft.item.trim(), color = draft.color.trim();
    for (const l of lines) {
      if (l.item !== item || l.color !== color) continue;
      m.set(l.size, (m.get(l.size) || 0) + l.qty);
    }
    return m;
  }, [lines, draft.item, draft.color]);

  // The hard ceiling for one size box: everything the warehouse holds of that
  // item+colour+size across ALL racks, less whatever is already on this
  // challan. Stock going OUT cannot exceed stock on hand — unlike Putaway,
  // where the inward count is a judgement call and stays freely editable.
  const ceilingFor = (size, have) => Math.max(0, have - (committed.get(size) || 0));

  // Sizes whose last keystroke was cut down to the ceiling, so the cell can say
  // why the number it shows is not the number that was typed.
  const [capped, setCapped] = useState({});

  const setSizeQty = (size, raw, ceiling) => {
    if (raw === '') {
      setDraft({ ...draft, sizeQty: { ...draft.sizeQty, [size]: '' } });
      setCapped(({ [size]: _drop, ...rest }) => rest);
      return;
    }
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) return;   // junk ("e", "-") never lands
    const clamped = Math.min(n, ceiling);
    setDraft({ ...draft, sizeQty: { ...draft.sizeQty, [size]: String(clamped) } });
    setCapped(({ [size]: _drop, ...rest }) => (n > ceiling ? { ...rest, [size]: ceiling } : rest));
  };

  // The exact `lines` array the picklist on screen was resolved from. Compared
  // by reference — `lines` is replaced, never mutated — so this is simply
  // "has the challan been edited since". Only used to say so; it disables
  // nothing.
  const [generatedFrom, setGeneratedFrom] = useState(null);

  // Drops the picklist entirely. Only two things do that now: switching or
  // clearing the challan, and the pick itself. Editing the lines does not.
  const clearPicklist = () => { setDetail(null); setAlloc({}); setGeneratedFrom(null); };

  // Draft validation shows on the form, under the button that was pressed —
  // see .form-error. `draft` is replaced rather than mutated on every edit, so
  // this clears the moment the user acts on the message.
  const [draftError, setDraftError] = useState('');
  useEffect(() => { setDraftError(''); }, [draft]);

  // Whether a blank entry row is on screen. It used to be unconditional, which
  // is what made "Add item" look decorative: after a commit the next blank row
  // was already sitting there, so the next design could be typed straight into
  // it and the button never had to be pressed. A row now exists only because it
  // was asked for — the first one on an empty challan, and every later one from
  // pressing Add item — and generating closes it again.
  const [entryOpen, setEntryOpen] = useState(true);
  const openEntry = () => { setDraft(EMPTY_DRAFT); setCapped({}); setDraftError(''); setEntryOpen(true); };
  // Editing the challan used to call clearPicklist(), so adding a second design
  // made the picklist you were looking at vanish and Generate felt like a point
  // of no return. It now survives every edit: the only things that end a
  // picklist are regenerating it (same entry, updated in place) and taking the
  // stock out of the racks.
  const editLines = (next) => { setLines(next); };

  // Fold the draft into the challan's lines and hand back the result. Returns
  // null when the draft is not fillable, having already put the reason on the
  // form. Split out of addDraft because Generate needs the same fold — and
  // needs the RESULT rather than the state write, since setLines has not
  // landed by the time the request goes out.
  const foldDraft = () => {
    const item = draft.item.trim();
    if (!item) { setDraftError('Please pick an item first'); return null; }
    const color = draft.color.trim();

    // A design whose colours are all real ones cannot be picked without
    // choosing between them, and until one is chosen there is no size run to
    // put a quantity in — so saying "add quantity" here points at a box that
    // is not on screen yet.
    //
    // Guarded on `includes('')` because a design that also has an uncoloured
    // variant offers '' as a legitimate choice, and the select renders that
    // and its "Select a color…" placeholder with the same empty value. The two
    // are indistinguishable, so '' cannot be called an error there.
    if (draftColors.length > 0 && !draftColors.includes('') && !color) {
      setDraftError('Please add color'); return null;
    }

    // Only the size run — every quantity in it is already capped at stock.
    const added = draftSizes
      .map(([size]) => ({ item, color, size, qty: Number(draft.sizeQty[size]) || 0 }))
      .filter((s) => s.qty > 0);

    if (!added.length) { setDraftError('Please add quantity'); return null; }

    // Merge into a line already on the challan for the same item+colour+size
    // rather than appending a second one — the challan should read as one row
    // per size, and the merged total is what the cap was computed against.
    const next = [...lines];
    for (const a of added) {
      const at = next.findIndex((l) => l.item === a.item && l.color === a.color && l.size === a.size);
      if (at >= 0) next[at] = { ...next[at], qty: next[at].qty + a.qty };
      else next.push(a);
    }
    return next;
  };

  const commitDraft = (next) => {
    editLines(next);
    setDraft(EMPTY_DRAFT);
    setCapped({});
  };

  const addDraft = () => {
    const next = foldDraft();
    if (next) commitDraft(next);
  };

  // `useLines` exists because Generate may have just folded the draft in: that
  // setLines has not landed yet, so reading `lines` here would resolve the
  // challan MINUS the line the user just typed.
  const generate = async (dc = dcNo, useLines = lines) => {
    setLoading(true);
    try {
      const res = mode === 'manual'
        // Passing the current id back is what makes a regenerate UPDATE the
        // picklist on screen — same history entry, its lines replaced — rather
        // than filing a second one and abandoning the first.
        ? await api.resolvePicklist({ dcNo: dcNo.trim() || null, lines: useLines, picklistId: detail?.id ?? null })
        : await api.picklist(dc);
      setDetail(res);
      setGeneratedFrom(useLines);
      // Seed the boxes from the server's largest-rack-first suggestion.
      const next = {};
      for (const r of res.rows) for (const p of r.placements) next[p.id] = p.suggested;
      setAlloc(next);
    } catch (e) {
      // Deliberately keeps whatever picklist is already on screen: a failed
      // regenerate has produced nothing to replace it with, and throwing the
      // last good one away is the behaviour this screen is moving away from.
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // What the Generate button actually runs. Generating is the goal of this
  // screen; "Add item" is only for putting a SECOND design on the same challan.
  // So a one-design challan never has to be "added" first — pressing Generate
  // folds whatever is in the entry form into the lines and resolves in one go,
  // which is also what keeps the challan table honest: the picklist below is
  // always exactly the rows shown above it, and pressing Generate twice cannot
  // count the same draft twice.
  //
  // A half-filled draft (item chosen, no quantity) stops here with the same
  // message the Add item button gives, rather than being silently dropped —
  // a dropped line is stock that never gets picked.
  const generateManual = async () => {
    // Nothing pending — the lines already on the challan stand on their own.
    if (!draft.item.trim()) { setEntryOpen(false); return generate(); }
    const next = foldDraft();
    if (!next) return;
    commitDraft(next);
    setEntryOpen(false);
    await generate(dcNo, next);
  };

  // Opens the printable sheet in a new tab. Popup blockers only trust a window
  // opened synchronously from the click, so the tab is claimed first and its
  // location set once the PDF has been fetched.
  const openPdf = async () => {
    const tab = window.open('', '_blank');
    setPrinting(true);
    try {
      const url = await api.picklistPdf(detail.id, detail.dcNo ? `picklist-${detail.dcNo}` : `picklist-${detail.id}`);
      if (tab) tab.location = url;
      else window.open(url, '_blank');   // blocked anyway — try once more
    } catch (e) {
      tab?.close();
      toast(e.message, 'error');
    } finally {
      setPrinting(false);
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
    if (!picks.length) return toast('Nothing chosen to pick yet', 'warning');

    const short = detail.rows.filter((r) => r.shortage > 0);
    setSaving(true);
    try {
      const res = await api.pickItems(detail.dcNo, picks, detail.id);
      toast(`${res.pickedQty} units picked${detail.dcNo ? ` for ${detail.dcNo}` : ''} across ${res.racks.length} rack(s)`, 'success');
      if (short.length) {
        toast(`Not enough stock for ${short.length} item(s): ${short.map((r) => r.item).join(', ')}`, 'warning');
      }
      // The pick is done — clear the whole challan so the next one starts from
      // a blank slate. Leaving the list up invites picking it a second time.
      setStock(await api.listItems());   // the catalogue's availability just changed
      setLines([]); setDraft(EMPTY_DRAFT); setCapped({}); setEntryOpen(true);
      setDcNo('');
      clearPicklist();
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
  // A design picked in the entry form counts, even before it has been added:
  // the whole point is that a single-item challan needs no Add item press. The
  // missing quantity is caught by foldDraft and shown on the form, so it is not
  // what gates the button.
  // Reference comparison: `lines` is replaced on every edit, so an identity
  // mismatch means the challan has moved on from what is displayed below.
  const challanChanged = !!detail && generatedFrom !== lines;

  const canGenerate = mode === 'manual'
    ? lines.length > 0 || !!draft.item.trim()
    : !!dcNo.trim();

  const switchMode = (m) => {
    setMode(m);
    setDcNo('');
    setLines([]); setDraft(EMPTY_DRAFT); setCapped({}); setEntryOpen(true);
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

      {/* One column. The Summary panel that used to sit on the right repeated
          what the page already says in place — the challan table has its own
          Total row, shortages are the red badges on each line, and "ready to
          pick" is in the generated picklist's own header. Its 340px is worth
          more to the size run, which is the part that actually grows. */}
      <div>
        <div>
          {/* Step 1 — the challan itself (overflow:visible so the module dropdown isn't clipped) */}
          <div className="card mb-4" style={{ overflow: 'visible' }}>
            <div className="card-header"><span className="card-title"><i className="fa-solid fa-file-invoice text-primary-color" />&nbsp; Step 1 — Delivery Challan</span></div>
            <div className="card-body">
              {VASTRA_DC_READY && (
                <div className="tab-bar">
                  <div className={`tab-btn ${mode === 'manual' ? 'active' : ''}`} onClick={() => switchMode('manual')}>Manual Entry</div>
                  <div className={`tab-btn ${mode === 'module' ? 'active' : ''}`} onClick={() => switchMode('module')}>From Vastra Module</div>
                </div>
              )}

              {mode === 'manual' && (
                <>
                  <p className="text-muted text-sm">Enter item details directly below.</p>
                  <div className="mt-4" style={{ maxWidth: 320 }}>
                    <Field label="Challan No" value={dcNo} placeholder="optional — for the history record"
                      onChange={(v) => { setDcNo(v); clearPicklist(); }} />
                  </div>
                  <p className="text-xs text-muted">
                    Optional — it just makes this picklist easier to find later.
                  </p>
                </>
              )}

              {mode === 'module' && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Challan No <span className="required">*</span></label>
                  <DcCombobox onSelect={(d) => { setDcNo(d.id); clearPicklist(); }}
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
          {/* overflow:visible on the card, not the body: .card clips, so the
              item dropdown was cut off at the card's bottom edge */}
          {mode === 'manual' && (
            <div className="card mb-4" style={{ overflow: 'visible' }}>
              <div className="card-header"><span className="card-title"><i className="fa-solid fa-list text-primary-color" />&nbsp; Step 2 — Items on the Challan</span></div>
              <div className="card-body">
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

                {entryOpen ? (
                <div className="add-item-panel">
                  <div className="text-sm font-700 mb-3">
                    Item {blocks.length + 1}
                    {blocks.length > 0 && <span className="text-muted font-600">&nbsp;— same design in another colour goes in as its own item</span>}
                  </div>

                  <div className={`picklist-entry-row ${draftSizes.length ? '' : 'no-sizes'}`}>
                    <div className="form-group">
                      <label className="form-label">Item / Design <span className="required">*</span></label>
                      <ItemCombobox
                        value={draft.item}
                        items={itemNames}
                        stats={itemStats}
                        onChange={(v) => { setDraft({ ...EMPTY_DRAFT, item: v }); setCapped({}); }}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Color</label>
                      {draftColors.length > 0 ? (
                        <select className="form-control" value={draft.color}
                          onChange={(e) => { setDraft({ ...draft, color: e.target.value, sizeQty: {} }); setCapped({}); }}>
                          <option value="">Select a color…</option>
                          {draftColors.map((c) => <option key={c} value={c}>{c || '(no color)'}</option>)}
                        </select>
                      ) : (
                        <input className="form-control" placeholder="Color" value={draft.color}
                          onChange={(e) => { setDraft({ ...draft, color: e.target.value, sizeQty: {} }); setCapped({}); }} />
                      )}
                    </div>

                  {/* The size run — one design across a row of sizes, the shape
                      the challan itself uses. Each box is hard-capped: stock
                      cannot leave the warehouse that isn't in it.

                      It sits in the SAME row as Item and Color, in the width the
                      Summary panel used to take. It is the part that grows: two
                      fixed boxes do not need more room, seven sizes do. */}
                  {draftSizes.length > 0 && (
                    <div className="form-group">
                      <label className="form-label">Quantity per size</label>
                      {/* Short runs read better as labelled rows — the size, its
                          quantity box and its stock line up in columns and each
                          figure gets a caption saying which is which. Past three
                          sizes that column would run far past the Item and Color
                          fields beside it, so the run packs into wrapping tiles
                          instead and trades the captions for compactness. */}
                      <div className={`size-run ${draftSizes.length > 3 ? 'tiles' : 'rows'}`}>
                        {draftSizes.map(([size, have]) => {
                          const ceiling = ceilingFor(size, have);
                          const onChallan = committed.get(size) || 0;
                          const cls = `size-cell ${capped[size] !== undefined ? 'over' : ''} ${ceiling === 0 ? 'maxed' : ''}`;
                          const qtyInput = (
                            <input className="form-control" type="number" min="0" max={ceiling}
                              placeholder="0" disabled={ceiling === 0}
                              value={draft.sizeQty[size] ?? ''}
                              onChange={(e) => setSizeQty(size, e.target.value, ceiling)} />
                          );
                          // Shared by both layouts so the cap warnings cannot
                          // drift apart between them.
                          const note = (onChallan > 0 || ceiling === 0 || capped[size] !== undefined) && (
                            <div className="size-cell-note">
                              {onChallan > 0 && <span>{onChallan} on challan</span>}
                              {ceiling === 0
                                ? <span className="size-cell-over">all taken</span>
                                : capped[size] !== undefined && <span className="size-cell-over">max {ceiling}</span>}
                            </div>
                          );
                          return draftSizes.length > 3 ? (
                            <div key={size} className={cls}>
                              <div className="size-cell-label">{size || 'no size'}</div>
                              {qtyInput}
                              <div className="size-cell-stock">{have} in stock</div>
                              {note}
                            </div>
                          ) : (
                            <div key={size} className={cls}>
                              <div className="size-cell-label">{size || 'no size'}</div>
                              <div className="size-cell-field">
                                <span className="size-cell-cap">Qty</span>
                                {qtyInput}
                              </div>
                              <div className="size-cell-field size-cell-stock">
                                <span className="size-cell-cap">Stock</span>
                                <span className="badge badge-ghost">{have}</span>
                              </div>
                              {note}
                            </div>
                          );
                        })}
                      </div>
                      {Object.keys(capped).length > 0 && (
                        <p className="text-xs text-danger mt-1">
                          <i className="fa-solid fa-triangle-exclamation" />&nbsp;
                          Capped at what the racks actually hold — a picklist can only take out
                          stock that is in the warehouse.
                        </p>
                      )}
                    </div>
                  )}
                  </div>

                  {draft.item && !draft.color && draftColors.length > 0 && (
                    <p className="text-xs text-muted mb-3">Pick a colour to see its size run.</p>
                  )}

                  {/* "Add a size not in stock" used to live here. It is gone
                      because it was the way around the cap: a size typed free
                      hand merges back into the same item+colour+size line
                      server-side, so it could put a line over stock after the
                      size run had been capped. */}

                  {draft.item && !catalog.has(draft.item) && (
                    <p className="text-xs text-danger mb-3">
                      <i className="fa-solid fa-triangle-exclamation" />&nbsp;
                      &ldquo;{draft.item}&rdquo; isn&apos;t in any rack, so there is nothing to pick.
                      Put it away first, then build the picklist.
                    </p>
                  )}

                  <div className="flex gap-3 items-center">
                    <button className="btn btn-primary" onClick={addDraft} disabled={!draft.item}>
                      <i className="fa-solid fa-plus" /> Add item
                    </button>
                  </div>

                  {draftError && (
                    <p className="form-error mt-4" role="alert">
                      <i className="fa-solid fa-circle-exclamation" />
                      Error: {draftError}
                    </p>
                  )}
                </div>
                ) : (
                  <div className="flex">
                    <button className="btn btn-primary" onClick={openEntry}>
                      <i className="fa-solid fa-plus" /> Add item
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Wrapped rather than bare: .btn is inline-flex, so on its own in a
              block it sits on a text baseline — the card above contributes a
              16px mb-4 while below there is only the line box's descender, and
              the button ends up crowding the Picklist card. A flex wrapper
              takes it out of inline flow entirely, so the mb-4 here is the
              whole gap below and matches the one above. */}
          <div className="flex mb-4">
            <button className="btn btn-primary"
              onClick={() => (mode === 'manual' ? generateManual() : generate())}
              disabled={loading || !canGenerate}>
              <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-clipboard-list'}`} />
              &nbsp; {loading ? 'Generating…' : 'Generate Picklist'}
            </button>
          </div>
        </div>

        {detail && (
          <div className="card">
            <div className="card-header">
              <span className="card-title"><i className="fa-solid fa-clipboard-list text-primary-color" />&nbsp; Picklist{detail.dcNo ? ` — ${detail.dcNo}` : ''}</span>
              <span className="flex items-center gap-3">
                <span className="badge badge-primary">{totalPicked} of {totals.qty} ready to pick</span>
                <button className="btn btn-outline btn-sm" onClick={openPdf} disabled={printing || !detail.id}>
                  <i className={`fa-solid ${printing ? 'fa-spinner fa-spin' : 'fa-file-pdf'}`} />
                  &nbsp; {printing ? 'Building…' : 'Print PDF'}
                </button>
              </span>
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
                            {r.shortage > 0 && <>&nbsp; <span className="badge badge-danger">{r.shortage} not in stock</span></>}
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
                                {picked} of {r.qty} chosen
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
                  &nbsp; {saving ? 'Taking out…' : 'Take out of racks'}
                </button>
                {/* Nothing here is disabled when the challan has moved on — the
                    picklist below is still a real, pickable snapshot and the
                    user may well mean to take it out as it stands. It just says
                    so, because otherwise adding an item and going straight to
                    "Take out of racks" drops that item silently: the pick
                    resets the whole challan afterwards. */}
                <span className={`text-sm ${challanChanged ? 'text-warning' : 'text-muted'}`}>
                  {overAllocated
                    ? 'One of the quantities is more than that rack actually holds.'
                    : challanChanged
                      ? 'The challan has changed since this was generated — press Generate Picklist again to include the new items.'
                      : 'Nothing has left the racks yet. This button removes the quantities above.'}
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
