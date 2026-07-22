import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { Line, Pie, sevenDayTrend } from '../lib/charts.js';

const REPORTS = {
  inventory: {
    title: 'Inventory Report', icon: 'boxes-stacked', color: 'var(--primary)', bg: 'var(--primary-alpha)', desc: 'Full stock listing',
    headers: ['Item', 'Color', 'Size', 'Qty', 'Rack', 'Source'],
    fetch: () => api.listItems(),
    row: (r) => [r.item, r.color || '—', r.size || '—', r.qty, r.rack_id, r.module_type || 'Manual'],
  },
  rack: {
    title: 'Rack Utilization', icon: 'layer-group', color: 'var(--warning)', bg: 'rgba(245,158,11,.12)', desc: 'Occupancy per rack',
    headers: ['Rack', 'Capacity', 'Used', 'Available', '% Used', 'Status'],
    fetch: () => api.listRacks(),
    row: (r) => [r.rack_id, r.capacity, r.used, r.available, `${r.capacity ? Math.round((r.used / r.capacity) * 100) : 0}%`, r.status],
  },
  movement: {
    title: 'Movement Report', icon: 'arrows-up-down', color: 'var(--success)', bg: 'rgba(34,197,94,.12)', desc: 'Item relocation history',
    headers: ['When', 'Item', 'From', 'To', 'Qty', 'By'],
    fetch: () => api.auditLog('move'),
    row: (r) => [new Date(r.created_at).toLocaleString('en-IN'), r.before_json?.item || '—', r.after_json?.fromRack || '—', r.after_json?.toRack || '—', r.after_json?.movedQty ?? '—', r.user_id],
  },
  audit: {
    title: 'Audit Report', icon: 'clock-rotate-left', color: '#a855f7', bg: 'rgba(168,85,247,.12)', desc: 'Every change logged',
    headers: ['When', 'Action', 'Entity', 'By', 'Before', 'After'],
    fetch: () => api.auditLog(),
    row: (r) => [new Date(r.created_at).toLocaleString('en-IN'), r.action, `${r.entity_type} #${r.entity_id}`, r.user_id, JSON.stringify(r.before_json), JSON.stringify(r.after_json)],
  },
};

export default function Reports() {
  const toast = useToast();
  const [dash, setDash] = useState(null);
  const [active, setActive] = useState(null); // report key
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.dashboard().then(setDash).catch((e) => toast(e.message, 'error')); }, []);

  const openReport = async (key) => {
    setActive(key);
    setLoading(true);
    try {
      const data = await REPORTS[key].fetch();
      setRows(data.map(REPORTS[key].row));
    } catch (e) {
      toast(e.message, 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!active || !rows.length) return;
    const { headers, title } = REPORTS[active];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV downloaded', 'success');
  };

  const t = dash ? sevenDayTrend(dash.trend) : { labels: [], added: [], moved: [] };
  const chartOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { padding: 14, boxWidth: 12 } } } };

  return (
    <>
      <div className="breadcrumb-bar"><span>Reports</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports &amp; Analytics</h1>
          <p className="page-subtitle">Drill into stock, racks, and activity</p>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid cols-4 gap-col-4 mb-6">
        {Object.entries(REPORTS).map(([key, r]) => (
          <div key={key} className="card" style={{ cursor: 'pointer', outline: active === key ? '2px solid var(--primary)' : 'none' }} onClick={() => openReport(key)}>
            <div className="card-body" style={{ textAlign: 'center', padding: 24 }}>
              <div style={{ width: 52, height: 52, background: r.bg, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 22, color: r.color }}>
                <i className={`fa-solid fa-${r.icon}`} />
              </div>
              <div className="font-700" style={{ fontSize: 14, marginBottom: 4 }}>{r.title}</div>
              <div className="text-sm text-muted">{r.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid cols-2 gap-col-4 mb-6">
        <div className="card">
          <div className="card-header"><span className="card-title">Added vs Moved (7 days)</span></div>
          <div className="card-body" style={{ height: 240 }}>
            {dash && <Line options={{ ...chartOpts, scales: { y: { beginAtZero: true } } }} data={{ labels: t.labels, datasets: [
              { label: 'Added', data: t.added, borderColor: '#0191D0', backgroundColor: 'rgba(1,145,208,.10)', fill: true, tension: 0.4 },
              { label: 'Moved', data: t.moved, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.10)', fill: true, tension: 0.4 },
            ] }} />}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">Stock by Item</span></div>
          <div className="card-body" style={{ height: 240 }}>
            {dash && (dash.topItems.length ? (
              <Pie options={{ ...chartOpts, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } } } }}
                data={{ labels: dash.topItems.map((i) => i.item), datasets: [{ data: dash.topItems.map((i) => i.qty), backgroundColor: ['#0191D0', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#f97316', '#6366f1'], borderWidth: 0 }] }} />
            ) : <div className="empty-state"><i className="fa-solid fa-inbox" /><p>No stock yet</p></div>)}
          </div>
        </div>
      </div>

      {/* Drill-down table */}
      {active && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">{REPORTS[active].title}</span>
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={exportCSV} disabled={!rows.length}><i className="fa-solid fa-download" /> CSV</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setActive(null)}><i className="fa-solid fa-xmark" /></button>
            </div>
          </div>
          <div className="data-table-wrap">
            {loading ? <div className="skeleton" style={{ height: 160, margin: 16 }} /> : rows.length ? (
              <table className="data-table">
                <thead><tr>{REPORTS[active].headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>{r.map((c, j) => <td key={j} className={j >= 4 ? 'text-xs' : ''} style={{ maxWidth: 240 }}>{String(c)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty-state" style={{ padding: 32 }}><i className="fa-solid fa-inbox" /><p>No rows</p></div>}
          </div>
        </div>
      )}
    </>
  );
}
