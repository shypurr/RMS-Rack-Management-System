import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { countBins, countCapacity, nextRackRange } from '../lib/layout.js';

// Rack layout setup.
//
// One job: add racks. Press Add racks, say how many and how each is divided,
// press Done, and they are appended after the ones already there. Come back
// tomorrow with different numbers and those get appended too. The list above
// the form is the history of what has been added.
//
// This replaced a "base layout" plus "racks that differ from the base" pair of
// panels. It described the same warehouses accurately, but it asked the user to
// think in exceptions before they could describe their own building. Nobody
// should need to know what a base layout is to say "I have ten more racks".
//
// Nothing on this screen can remove or shrink a rack — the endpoint it calls
// does not express deletion. Removing racks is its own flow, empty racks only.
const EMPTY_FORM = { racks: '', shelves: '', bins: '', bin_capacity: '' };

export default function RackSetup() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const load = async () => setData(await api.layout());
  useEffect(() => { load().catch((e) => toast(e.message, 'error')); }, []);

  const groups = data?.groups ?? [];
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const projectedBins = countBins(form);
  const projectedCapacity = countCapacity(form);
  const range = nextRackRange(groups, form.racks);
  const complete = ['racks', 'shelves', 'bins', 'bin_capacity']
    .every((k) => Number(form[k]) > 0);

  const startAdding = () => { setForm(EMPTY_FORM); setAdding(true); };
  const cancelAdding = () => { setForm(EMPTY_FORM); setAdding(false); };

  const done = async () => {
    if (!complete) return toast('Fill in all four numbers', 'warning');
    setBusy(true);
    try {
      const res = await api.addRacks({
        racks: Number(form.racks), shelves: Number(form.shelves),
        bins: Number(form.bins), bin_capacity: Number(form.bin_capacity),
      });
      toast(
        `${res.racks} rack${res.racks > 1 ? 's' : ''} added (R${res.rack_from}–R${res.rack_to}) — ${res.added.toLocaleString()} bins`,
        'success'
      );
      cancelAdding();
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
          <p className="page-subtitle">Add racks to your warehouse, a batch at a time</p>
        </div>
      </div>

      {data && (
        <div className="card mb-4">
          <div className="card-body" style={{ padding: '14px 20px' }}>
            {data.configured ? (
              <div className="flex gap-6 flex-wrap items-center text-sm">
                <span><strong>{data.counts.racks.toLocaleString()}</strong> racks</span>
                <span><strong>{data.counts.bins.toLocaleString()}</strong> bins</span>
                <span><strong>{data.counts.capacity.toLocaleString()}</strong> total capacity</span>
              </div>
            ) : (
              <div className="text-sm">
                No racks yet. Press <strong>Add racks</strong> to set up your first batch.
              </div>
            )}
          </div>
        </div>
      )}

      {/* What has been added so far, in the order it was added. */}
      {groups.length > 0 && (
        <div className="card mb-4">
          <div className="card-header"><span className="card-title">Your racks</span></div>
          <div className="card-body">
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th><th>Racks</th><th>Shelves per rack</th>
                    <th>Bins per shelf</th><th>Capacity per bin</th><th>Bins</th><th>Capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id}>
                      <td className="text-muted">{g.seq}</td>
                      <td className="font-600 text-primary-color">
                        {g.rack_count} <span className="text-muted font-400 text-xs">
                          (R{g.rack_from}{g.rack_count > 1 ? `–R${g.rack_to}` : ''})
                        </span>
                      </td>
                      <td>{g.shelves}</td>
                      <td>{g.bins}</td>
                      <td>{g.bin_capacity}</td>
                      <td>{g.bin_count.toLocaleString()}</td>
                      <td>{g.capacity.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted mt-3">
              Each row is one batch you added. Racks are numbered in the order they were
              added and never renumbered.
            </p>
          </div>
        </div>
      )}

      {!adding ? (
        <button className="btn btn-primary" onClick={startAdding} disabled={!data}>
          <i className="fa-solid fa-plus" />&nbsp; Add racks
        </button>
      ) : (
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <i className="fa-solid fa-plus text-primary-color" />&nbsp; Add racks
            </span>
          </div>
          <div className="card-body">
            <div className="grid cols-4 gap-col-4">
              <Field label="Number of racks" value={form.racks} autoFocus
                onChange={(v) => setField('racks', v)} />
              <Field label="Shelves per rack" value={form.shelves}
                onChange={(v) => setField('shelves', v)} />
              <Field label="Bins per shelf" value={form.bins}
                onChange={(v) => setField('bins', v)} />
              <Field label="Capacity per bin" value={form.bin_capacity}
                onChange={(v) => setField('bin_capacity', v)} />
            </div>

            {/* The size of the thing, before it happens. Done applies straight
                away, so this line is where a mistyped extra zero gets caught. */}
            {complete ? (
              <>
                <p className="text-sm text-muted mt-4">
                  This adds <strong>{form.racks}</strong> rack{Number(form.racks) > 1 ? 's' : ''}
                  {range && <> numbered <strong>R{range.from}{range.to > range.from ? `–R${range.to}` : ''}</strong></>},
                  making <strong>{projectedBins.toLocaleString()}</strong> bins. Capacity per bin is how
                  many units fit inside one bin — not how many bins there are.
                </p>
                <p className="text-sm text-muted mt-1">
                  That is <strong>{projectedCapacity.toLocaleString()}</strong> units of extra space.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted mt-4">Fill in all four numbers to see what this adds.</p>
            )}

            <div className="flex gap-3 mt-4">
              <button className="btn btn-primary" onClick={done} disabled={busy || !complete}>
                <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-check'}`} />
                &nbsp; {busy ? 'Adding…' : 'Done'}
              </button>
              <button className="btn btn-ghost" onClick={cancelAdding} disabled={busy}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, value, onChange, autoFocus }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <input
        type="number" min="1" className="form-control" value={value} autoFocus={autoFocus}
        placeholder="0"
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
      />
    </div>
  );
}
