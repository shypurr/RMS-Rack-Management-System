import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';

const ACTION_BADGE = { add: 'badge-success', update: 'badge-primary', move: 'badge-warning', remove: 'badge-danger' };

export default function AuditLog() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auditLog().then(setRows).catch((e) => toast(e.message, 'error')).finally(() => setLoading(false));
  }, []);

  const fmt = (v) => (v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

  return (
    <>
      <div className="breadcrumb-bar"><span>Audit Log</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">Every add, update, move, and remove — who, when, before, after</p>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="skeleton" style={{ height: 200 }} />
          ) : rows.length ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>When</th><th>Action</th><th>Entity</th><th>By</th><th>Before</th><th>After</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="text-muted text-xs" style={{ whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString('en-IN')}</td>
                      <td><span className={`badge ${ACTION_BADGE[r.action] || 'badge-ghost'}`}>{r.action}</span></td>
                      <td className="text-xs">{r.entity_type} #{r.entity_id}</td>
                      <td className="text-xs">{r.user_id}</td>
                      <td className="text-xs" style={{ maxWidth: 220 }}>{fmt(r.before_json)}</td>
                      <td className="text-xs" style={{ maxWidth: 220 }}>{fmt(r.after_json)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state"><i className="fa-solid fa-clock-rotate-left" /><p>No activity yet</p></div>
          )}
        </div>
      </div>
    </>
  );
}
