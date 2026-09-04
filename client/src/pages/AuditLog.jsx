import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { matches } from '../lib/items.js';
import { usePaged } from '../lib/paging.js';
import LoadMore from '../components/LoadMore.jsx';

const ACTION_BADGE = { add: 'badge-success', update: 'badge-primary', move: 'badge-warning', remove: 'badge-danger' };

export default function AuditLog() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auditLog().then(setRows).catch((e) => toast(e.message, 'error')).finally(() => setLoading(false));
  }, []);

  const fmt = (v) => (v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

  // The before/after JSON carries the item name and the module document, so
  // matching against it finds an entry by either — same as everywhere else.
  const filtered = rows.filter((r) =>
    matches(`${r.action} ${r.entity_type} ${r.entity_id} ${r.user_id} ${fmt(r.before_json)} ${fmt(r.after_json)}`, search)
  );

  // Ten at a time. The audit log is the fastest-growing table in the database
  // — every put-away, pick and move writes a row — so it is the first screen
  // that would have stopped responding without this.
  const page = usePaged(filtered, { resetKey: search });

  return (
    <>
      <div className="breadcrumb-bar"><span>Audit Log</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">Every add, update, move, and remove — who, when, before, after</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div className="input-group" style={{ minWidth: 180 }}>
            <span className="input-icon"><i className="fa-solid fa-search" /></span>
            <input className="form-control" placeholder="Search module code (e.g. SGR-1), item, rack or user…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="skeleton" style={{ height: 200 }} />
          ) : filtered.length ? (
            <>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>When</th><th>Action</th><th>Entity</th><th>By</th><th>Before</th><th>After</th></tr>
                </thead>
                <tbody>
                  {page.visible.map((r) => (
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
            <LoadMore {...page} noun="entries" onMore={page.loadMore} />
            </>
          ) : (
            <div className="empty-state">
              <i className="fa-solid fa-clock-rotate-left" />
              <p>{rows.length ? 'No entries match your search' : 'No activity yet'}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
