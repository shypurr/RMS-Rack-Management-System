import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { pct, pctColorClass } from '../lib/rack.js';

export default function RackReport() {
  const toast = useToast();
  const [racks, setRacks] = useState([]);
  const [rackId, setRackId] = useState('');
  const [report, setReport] = useState(null);

  useEffect(() => { api.listRacks().then(setRacks).catch((e) => toast(e.message, 'error')); }, []);

  useEffect(() => {
    if (!rackId) { setReport(null); return; }
    api.getRack(rackId).then(setReport).catch((e) => toast(e.message, 'error'));
  }, [rackId]);

  const p = report ? pct(report.used, report.capacity) : 0;

  return (
    <>
      <div className="breadcrumb-bar"><span>Rack Report</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Rack-wise Report</h1>
          <p className="page-subtitle">Everything stored in a given rack</p>
        </div>
        {report && <button className="btn btn-outline print-show" onClick={() => window.print()}><i className="fa-solid fa-print" /> Print</button>}
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div className="form-group" style={{ margin: 0, maxWidth: 320 }}>
            <label className="form-label">Select Rack</label>
            <select className="form-control" value={rackId} onChange={(e) => setRackId(e.target.value)}>
              <option value="">Choose a rack…</option>
              {/* value is the numeric rack_master.id, never the display code:
                  /api/racks/:id addresses a row, and codes re-pad as the org
                  grows. Sending rack_id made the route parse NaN. */}
              {racks.map((r) => <option key={r.id} value={r.id}>{r.rack_id} — {r.status} ({r.used}/{r.capacity})</option>)}
            </select>
          </div>
        </div>
      </div>

      {report && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">{report.rack_id}</span>
            <span className={`badge ${report.status === 'Vacant' ? 'badge-ghost' : 'badge-success'}`}>{report.status}</span>
          </div>
          <div className="card-body">
            <div className="flex gap-4 mb-4">
              <Stat label="Capacity" value={report.capacity} />
              <Stat label="Used" value={report.used} />
              <Stat label="Available" value={report.available} />
              <Stat label="Occupancy" value={`${p}%`} />
            </div>
            <div className="progress mb-6"><div className={`progress-bar ${pctColorClass(p)}`} style={{ width: `${p}%` }} /></div>

            {report.items.length ? (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead><tr><th>Item</th><th>Color</th><th>Size</th><th>Qty</th><th>Source Module</th><th>Module ID</th></tr></thead>
                  <tbody>
                    {report.items.map((it) => (
                      <tr key={it.id}>
                        <td>{it.item}</td><td>{it.color || '—'}</td><td>{it.size || '—'}</td>
                        <td className="font-600">{it.qty}</td>
                        <td>{it.module_type ? <span className="badge badge-primary">{it.module_type}</span> : <span className="text-muted">Manual</span>}</td>
                        <td>{it.module_id || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state"><i className="fa-solid fa-inbox" /><p>This rack is empty</p></div>
            )}
          </div>
        </div>
      )}
    </>
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
