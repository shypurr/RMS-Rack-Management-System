import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import { Line, Doughnut, Bar, sevenDayTrend } from '../lib/charts.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const ACTION_ICON = { add: 'plus', update: 'pen', move: 'arrow-right-long', remove: 'trash' };
const ACTION_TONE = { add: 'success', update: 'info', move: 'warning', remove: 'danger' };

export default function Dashboard() {
  const toast = useToast();
  const [data, setData] = useState(null);

  const load = () => api.dashboard().then(setData).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  if (!data) {
    return (
      <>
        <div className="page-header"><div><h1 className="page-title">Warehouse Dashboard</h1></div></div>
        <div className="grid cols-6 gap-col-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 96 }} />)}</div>
      </>
    );
  }

  const s = data.stats;
  const t = sevenDayTrend(data.trend);
  const chartOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { padding: 16, boxWidth: 12 } } } };

  return (
    <>
      <div className="breadcrumb-bar"><span>Dashboard</span></div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Warehouse Dashboard</h1>
          <p className="page-subtitle">Live overview of racks, items, and activity</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={load}><i className="fa-solid fa-rotate" /> Refresh</button>
          <Link to="/add" className="btn btn-primary"><i className="fa-solid fa-plus" /> Add Item</Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid cols-6 gap-col-4 mb-6">
        <StatCard icon="boxes-stacked" color="blue"   value={fmt(s.totalItems)}    label="Total Items Stored" sub={`across ${s.totalRacks} racks`} />
        <StatCard icon="arrow-up"      color="green"  value={fmt(s.addedToday)}    label="Items Added Today" />
        <StatCard icon="arrows-up-down" color="orange" value={fmt(s.movedToday)}   label="Moves Today" />
        <StatCard icon="layer-group"   color="red"    value={s.occupiedRacks}      label="Occupied Racks" />
        <StatCard icon="box-open"      color="teal"   value={s.vacantRacks}        label="Vacant Racks" />
        <StatCard icon="gauge-high"    color="purple" value={`${s.overallPct}%`}   label="Overall Occupancy" sub={`${fmt(s.totalUsed)} / ${fmt(s.totalCapacity)}`} />
      </div>

      {/* Trend + Occupancy */}
      <div className="grid gap-col-6 mb-6" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="card">
          <div className="card-header"><span className="card-title"><i className="fa-solid fa-chart-line text-primary-color" />&nbsp; Activity Trend (7 days)</span></div>
          <div className="card-body" style={{ height: 280 }}>
            <Line
              options={{ ...chartOpts, scales: { y: { beginAtZero: true } } }}
              data={{
                labels: t.labels,
                datasets: [
                  { label: 'Added', data: t.added, borderColor: '#0191D0', backgroundColor: 'rgba(1,145,208,.10)', fill: true, tension: 0.4, pointRadius: 3 },
                  { label: 'Moved', data: t.moved, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.10)', fill: true, tension: 0.4, pointRadius: 3 },
                ],
              }}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title"><i className="fa-solid fa-chart-pie text-primary-color" />&nbsp; Rack Occupancy</span></div>
          <div className="card-body" style={{ height: 280 }}>
            <Doughnut
              options={{ ...chartOpts, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { padding: 16, boxWidth: 10 } } } }}
              data={{
                labels: ['Full (≥85%)', 'Partial (1–84%)', 'Vacant'],
                datasets: [{ data: [data.buckets.full, data.buckets.partial, data.buckets.vacant], backgroundColor: ['#ef4444', '#f59e0b', '#22c55e'], borderWidth: 0, hoverOffset: 8 }],
              }}
            />
          </div>
        </div>
      </div>

      {/* Top items + Recent activity */}
      <div className="grid gap-col-6" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <div className="card-header"><span className="card-title"><i className="fa-solid fa-ranking-star text-primary-color" />&nbsp; Top Items by Quantity</span></div>
          <div className="card-body" style={{ height: 300 }}>
            {data.topItems.length ? (
              <Bar
                options={{ ...chartOpts, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }}
                data={{
                  labels: data.topItems.map((i) => i.item),
                  datasets: [{ label: 'Qty', data: data.topItems.map((i) => i.qty), backgroundColor: ['#0191D0', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#f97316', '#6366f1'], borderRadius: 4 }],
                }}
              />
            ) : <div className="empty-state"><i className="fa-solid fa-inbox" /><p>No items stored yet</p></div>}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title"><i className="fa-solid fa-clock-rotate-left text-primary-color" />&nbsp; Recent Activity</span></div>
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {data.recent.length ? data.recent.map((r) => (
              <div key={r.id} className="notif-item">
                <div className={`notif-icon-wrap ${ACTION_TONE[r.action] || 'info'}`}><i className={`fa-solid fa-${ACTION_ICON[r.action] || 'circle-info'}`} /></div>
                <div className="notif-content">
                  <div className="notif-item-title">{activityTitle(r)}</div>
                  <div className="notif-item-msg">{activitySub(r)}</div>
                  <div className="notif-time">{new Date(r.created_at).toLocaleString('en-IN')}</div>
                </div>
                <span className={`badge badge-${ACTION_TONE[r.action] === 'danger' ? 'danger' : ACTION_TONE[r.action] === 'warning' ? 'warning' : ACTION_TONE[r.action] === 'info' ? 'primary' : 'success'} text-xs`}>{r.action}</span>
              </div>
            )) : <div className="empty-state" style={{ padding: 32 }}><i className="fa-solid fa-clock-rotate-left" /><p>No activity yet</p></div>}
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({ icon, color, value, label, sub }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}><i className={`fa-solid fa-${icon}`} /></div>
      <div className="stat-info">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
      </div>
    </div>
  );
}

function activityTitle(r) {
  const a = r.after_json || {};
  const b = r.before_json || {};
  const name = a.item || b.item || `#${r.entity_id}`;
  if (r.action === 'move') return `Moved ${name}`;
  if (r.action === 'add') return `Added ${name}`;
  if (r.action === 'remove') return `Removed ${name}`;
  return `Updated ${name}`;
}

function activitySub(r) {
  const a = r.after_json || {};
  const b = r.before_json || {};
  if (r.action === 'move') return `${a.fromRack} → ${a.toRack} · ${a.movedQty} units`;
  if (r.action === 'add') return `${a.qty} units → ${a.fk_rack_id}${a.module_type ? ` · ${a.module_type}` : ''}`;
  if (r.action === 'remove') return `from ${b.fk_rack_id || '—'}`;
  return `qty ${b.qty ?? '—'} → ${a.qty ?? '—'}`;
}
