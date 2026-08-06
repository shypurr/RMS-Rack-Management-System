import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { matches } from '../lib/items.js';

// What has actually moved through the racks: stock put away, and picklists
// generated. Each half reads from where that flow records itself — putaway from
// the audit trail, picklists from their own table, which is the only thing that
// knows about a picklist that was generated and then never acted on.
//
// The Audit Log tab stays as the raw everything-view; this is the operational
// read of the same history.
export default function History() {
  const toast = useToast();
  const [tab, setTab] = useState('putaway');
  const [putaway, setPutaway] = useState([]);
  const [picklists, setPicklists] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [printingId, setPrintingId] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.historyPutaway(200), api.historyPicklists(200)])
      .then(([p, l]) => { setPutaway(p); setPicklists(l); })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, []);

  const shownPutaway = useMemo(
    () => putaway.filter((r) => matches(`${r.item} ${r.color} ${r.size} ${r.rack_id} ${r.module_id || ''} ${r.module_type || ''} ${r.user_id}`, query)),
    [putaway, query]
  );
  const shownPicklists = useMemo(
    () => picklists.filter((r) => matches(`${r.dc_no || ''} ${r.party || ''} ${r.user_id} ${r.rack_updated ? 'updated' : 'not updated pending'}`, query)),
    [picklists, query]
  );

  const openPdf = async (row) => {
    const tab = window.open('', '_blank');
    setPrintingId(row.id);
    try {
      const url = await api.picklistPdf(row.id, row.dc_no ? `picklist-${row.dc_no}` : `picklist-${row.id}`);
      if (tab) tab.location = url; else window.open(url, '_blank');
    } catch (e) {
      tab?.close();
      toast(e.message, 'error');
    } finally {
      setPrintingId(null);
    }
  };

  const rows = tab === 'putaway' ? shownPutaway : shownPicklists;
  const notUpdated = picklists.filter((p) => !p.rack_updated).length;

  return (
    <>
      <div className="breadcrumb-bar"><span>History</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">History</h1>
          <p className="page-subtitle">Stock put away and picklists generated</p>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <div className="tab-bar">
            <div className={`tab-btn ${tab === 'putaway' ? 'active' : ''}`} onClick={() => setTab('putaway')}>
              Putaway <span className="text-muted">({putaway.length})</span>
            </div>
            <div className={`tab-btn ${tab === 'picklist' ? 'active' : ''}`} onClick={() => setTab('picklist')}>
              Picklist <span className="text-muted">({picklists.length})</span>
            </div>
          </div>

          <div className="input-group mb-3">
            <span className="input-icon"><i className="fa-solid fa-search" /></span>
            <input className="form-control" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'putaway'
                ? 'Search item, colour, size, rack or module code…'
                : 'Search challan no, party, or "not updated"…'} />
          </div>

          {tab === 'picklist' && notUpdated > 0 && !query && (
            <p className="text-xs text-muted mb-3">
              <i className="fa-solid fa-circle-info" />&nbsp;
              {notUpdated} picklist{notUpdated > 1 ? 's were' : ' was'} generated without the racks being
              updated. Search <span className="font-600">not updated</span> to see just those.
            </p>
          )}

          {loading && <p className="text-muted">Loading…</p>}

          {!loading && !rows.length && (
            <div className="empty-state">
              <i className="fa-solid fa-clock-rotate-left" />
              <h3>Nothing here yet</h3>
              <p>{query ? 'No records match that search.' : tab === 'putaway'
                ? 'Stock added through Putaway will show up here.'
                : 'Picklists appear here as soon as one is generated.'}</p>
            </div>
          )}

          {!loading && rows.length > 0 && tab === 'putaway' && (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>When</th><th>Item</th><th>Color</th><th>Size</th><th>Added</th><th>Rack</th><th>Source</th><th>By</th></tr>
                </thead>
                <tbody>
                  {shownPutaway.map((r) => (
                    <tr key={r.id}>
                      <td className="text-muted text-xs">{fmt(r.created_at)}</td>
                      <td className="font-600">{r.item}</td>
                      <td>{r.color || '—'}</td>
                      <td>{r.size || '—'}</td>
                      <td>
                        <span className="text-success font-700">+{r.qty}</span>
                        {r.merged && <span className="text-xs text-muted">&nbsp; (rack held {r.rack_qty} after)</span>}
                      </td>
                      <td className="font-600 text-primary-color">{r.rack_id}</td>
                      <td className="text-xs">{r.module_id
                        ? <>{r.module_id}<span className="text-muted"> · {r.module_type}</span></>
                        : <span className="text-muted">Manual</span>}</td>
                      <td className="text-xs text-muted">{r.user_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && rows.length > 0 && tab === 'picklist' && (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>When</th><th>Challan No</th><th>Party</th><th>Lines</th><th>Qty</th><th>Rack updated</th><th>By</th><th /></tr>
                </thead>
                <tbody>
                  {shownPicklists.map((r) => (
                    <tr key={r.id}>
                      <td className="text-muted text-xs">{fmt(r.created_at)}</td>
                      <td className="font-600">{r.dc_no || <span className="text-muted">#{r.id}</span>}</td>
                      <td>{r.party || '—'}</td>
                      <td>{r.lines}</td>
                      <td>
                        {r.total_qty}
                        {r.short_qty > 0 && <>&nbsp; <span className="badge badge-danger">short {r.short_qty}</span></>}
                      </td>
                      <td>
                        {/* The point of this column: a picklist generated and
                            never acted on is where a stock discrepancy hides. */}
                        {r.rack_updated
                          ? <span className="badge badge-success">true · {r.picked_qty} picked</span>
                          : <span className="badge badge-warning">false</span>}
                      </td>
                      <td className="text-xs text-muted">{r.user_id}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-ghost btn-sm" title="Open the printable PDF"
                          disabled={printingId === r.id} onClick={() => openPdf(r)}>
                          <i className={`fa-solid ${printingId === r.id ? 'fa-spinner fa-spin' : 'fa-file-pdf'}`} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const fmt = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
