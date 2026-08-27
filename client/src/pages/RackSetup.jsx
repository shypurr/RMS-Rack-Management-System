import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { countBins, findOverlap } from '../lib/layout.js';

// Rack layout setup.
//
// Two gates stand between the user and a destroyed bin. `preview` writes
// nothing and reports what would change; if anything holds stock it refuses and
// names it. Only then does the user see a count and a Yes button. Nothing is
// ever removed silently — that is the whole contract of this screen.
export default function RackSetup() {
  const toast = useToast();
  const [form, setForm] = useState({ racks: 10, shelves: 3, bins: 5, bin_capacity: 100 });
  const [overrides, setOverrides] = useState([]);
  const [current, setCurrent] = useState(null);
  const [preview, setPreview] = useState(null);   // null until previewed
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const data = await api.layout();
    setCurrent(data);
    if (data.layout) {
      setForm({
        racks: data.layout.racks, shelves: data.layout.shelves,
        bins: data.layout.bins, bin_capacity: data.layout.bin_capacity,
      });
      setOverrides(data.overrides.map((o) => ({ ...o })));
    }
  };
  useEffect(() => { load().catch((e) => toast(e.message, 'error')); }, []);

  // Any edit invalidates a preview — otherwise the user could preview one
  // layout and then apply a different one.
  const setField = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setPreview(null); };
  const setOv = (i, k, v) => {
    setOverrides((os) => os.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
    setPreview(null);
  };
  const addOverride = () => {
    setOverrides((os) => [...os, {
      rack_from: '', rack_to: '', shelves: form.shelves, bins: form.bins, bin_capacity: form.bin_capacity,
    }]);
    setPreview(null);
  };
  const removeOverride = (i) => {
    setOverrides((os) => os.filter((_, j) => j !== i));
    setPreview(null);
  };

  const cleanOverrides = () => overrides
    .filter((o) => o.rack_from && o.rack_to)
    .map((o) => ({
      rack_from: Number(o.rack_from), rack_to: Number(o.rack_to),
      shelves: Number(o.shelves), bins: Number(o.bins), bin_capacity: Number(o.bin_capacity),
    }));

  const overlap = findOverlap(overrides);
  const projected = countBins(form, overrides);
  const sampleCode = current
    ? `R${'1'.padStart(Math.max(2, String(Number(form.racks) || 1).length), '0')}-S01-B01`
    : '';

  const runPreview = async () => {
    if (overlap) return toast(overlap, 'warning');
    setBusy(true);
    try {
      setPreview(await api.layoutPreview({ ...form, overrides: cleanOverrides() }));
    } catch (e) {
      setPreview(null);
      toast(e.message, 'error');
    } finally { setBusy(false); }
  };

  const confirmApply = async () => {
    setBusy(true);
    try {
      const res = await api.layoutApply({
        ...form, overrides: cleanOverrides(), version: preview.version,
      });
      toast(`Layout applied — ${res.added} bins added, ${res.removed} removed`, 'success');
      setPreview(null);
      await load();
    } catch (e) {
      toast(e.message, 'error');
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="breadcrumb-bar"><span>Rack Setup</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Rack Setup</h1>
          <p className="page-subtitle">
            Define how many racks you have, and how each one is divided into shelves and bins
          </p>
        </div>
      </div>

      {current && (
        <div className="card mb-4">
          <div className="card-body" style={{ padding: '14px 20px' }}>
            {current.configured ? (
              <div className="flex gap-6 flex-wrap items-center text-sm">
                <span><strong>{current.counts.racks}</strong> racks</span>
                <span><strong>{current.counts.bins}</strong> bins</span>
                <span><strong>{current.counts.capacity}</strong> total capacity</span>
                <span className="text-muted ml-auto">Bins numbered like {sampleCode}</span>
              </div>
            ) : (
              <div className="text-sm">
                No racks configured yet. Fill in the four numbers below and press Preview.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Base grid */}
      <div className="card mb-4">
        <div className="card-header"><span className="card-title">Base layout</span></div>
        <div className="card-body">
          <div className="grid cols-4 gap-col-4">
            <Field label="Total racks" value={form.racks} onChange={(v) => setField('racks', v)} />
            <Field label="Shelves per rack" value={form.shelves} onChange={(v) => setField('shelves', v)} />
            <Field label="Bins per shelf" value={form.bins} onChange={(v) => setField('bins', v)} />
            <Field label="Capacity per bin" value={form.bin_capacity} onChange={(v) => setField('bin_capacity', v)} />
          </div>
          <p className="text-sm text-muted mt-4">
            This makes <strong>{projected.toLocaleString()}</strong> bins. Capacity per bin is how
            many units fit inside one bin — not how many bins there are.
          </p>
        </div>
      </div>

      {/* Group overrides */}
      <div className="card mb-4">
        <div className="card-header">
          <span className="card-title">Racks that differ</span>
          <button className="btn btn-outline btn-sm ml-auto" onClick={addOverride}>
            <i className="fa-solid fa-plus" />&nbsp; Add a group
          </button>
        </div>
        <div className="card-body">
          {overrides.length === 0 ? (
            <p className="text-sm text-muted">
              All {form.racks || 0} racks use the base layout. Add a group if a block of racks is a
              different model — for example racks 291–300 with 5 shelves and 13 bins each.
            </p>
          ) : (
            <>
              {overrides.map((o, i) => (
                <div key={i} className="flex gap-3 flex-wrap items-end mb-4">
                  <Field small label="From rack" value={o.rack_from} onChange={(v) => setOv(i, 'rack_from', v)} />
                  <Field small label="To rack" value={o.rack_to} onChange={(v) => setOv(i, 'rack_to', v)} />
                  <Field small label="Shelves" value={o.shelves} onChange={(v) => setOv(i, 'shelves', v)} />
                  <Field small label="Bins/shelf" value={o.bins} onChange={(v) => setOv(i, 'bins', v)} />
                  <Field small label="Capacity" value={o.bin_capacity} onChange={(v) => setOv(i, 'bin_capacity', v)} />
                  <button className="btn btn-ghost btn-sm" onClick={() => removeOverride(i)} title="Remove group">
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              ))}
              <p className="text-xs text-muted">
                A group keeps its own shape. Changing the base layout above will not alter these racks.
              </p>
              {overlap && (
                <p className="text-sm mt-4" style={{ color: 'var(--danger)' }}>
                  <i className="fa-solid fa-triangle-exclamation" />&nbsp; {overlap}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <button className="btn btn-primary" onClick={runPreview} disabled={busy || !!overlap}>
          <i className="fa-solid fa-magnifying-glass" />&nbsp; Preview changes
        </button>
      </div>

      {preview && (
        <PreviewPanel
          preview={preview}
          busy={busy}
          onApply={confirmApply}
          onCancel={() => setPreview(null)}
        />
      )}
    </>
  );
}

// Three outcomes, three different things to say. "Blocked" is not a warning the
// user can click past — it carries no apply button at all.
function PreviewPanel({ preview, busy, onApply, onCancel }) {
  if (preview.blockers.length) {
    return (
      <div className="card" style={{ borderLeft: '4px solid var(--danger)' }}>
        <div className="card-header">
          <span className="card-title" style={{ color: 'var(--danger)' }}>
            <i className="fa-solid fa-ban" />&nbsp; Cannot apply — {preview.blockers.length} bin(s) in the way
          </span>
        </div>
        <div className="card-body">
          <p className="text-sm mb-4"><strong>Nothing has been changed.</strong> These bins block it:</p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Bin</th><th>Problem</th></tr></thead>
              <tbody>
                {preview.blockers.map((b) => (
                  <tr key={`${b.rack_no}-${b.shelf_no}-${b.bin_no}`}>
                    <td className="font-600 text-primary-color">
                      R{b.rack_no}-S{b.shelf_no}-B{b.bin_no}
                    </td>
                    <td>
                      {b.kind === 'occupied'
                        ? `Holds ${b.used} units — this change would delete the bin`
                        : `Holds ${b.used} units but the new capacity is only ${b.capacity}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted mt-4">Move this stock elsewhere, then preview again.</p>
          <div className="flex gap-3 mt-4">
            <Link className="btn btn-primary" to="/move">Go to Move Item</Link>
            <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  const destructive = preview.remove > 0;
  return (
    <div className="card" style={{ borderLeft: `4px solid var(--${destructive ? 'warning' : 'success'})` }}>
      <div className="card-header">
        <span className="card-title">
          <i className={`fa-solid fa-${destructive ? 'triangle-exclamation' : 'circle-check'}`} />
          &nbsp; {destructive ? 'Confirm — this deletes bins' : 'Confirm changes'}
        </span>
      </div>
      <div className="card-body">
        <div className="flex gap-6 flex-wrap mb-4 text-sm">
          <span><strong>{preview.add}</strong> bins added</span>
          <span><strong>{preview.remove}</strong> bins deleted</span>
          <span><strong>{preview.keep}</strong> bins kept</span>
          <span className="text-muted">{preview.counts.bins.toLocaleString()} bins afterwards</span>
        </div>
        {destructive && (
          <p className="text-sm mb-4">
            The {preview.remove} bins being deleted are all empty, so no stock will be lost.
            This cannot be undone.
          </p>
        )}
        <div className="flex gap-3">
          <button className="btn btn-primary" onClick={onApply} disabled={busy}>
            {destructive ? `Yes, delete ${preview.remove} bins and apply` : 'Apply'}
          </button>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, small }) {
  return (
    <div style={small ? { width: 110 } : undefined}>
      <label className="form-label">{label}</label>
      <input
        type="number" min="1" className="form-control" value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
