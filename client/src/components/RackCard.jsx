import { occupancyBucket, pct, pctColorClass } from '../lib/rack.js';

// Reference-style rack tile. `bucket` coloring is display-only; the stored
// status (Vacant/Occupied) is shown as a small label.
export default function RackCard({ rack, onClick }) {
  const bucket = occupancyBucket(rack.used, rack.capacity);
  const p = pct(rack.used, rack.capacity);
  return (
    <div className={`rack-card ${bucket}`} onClick={onClick} style={{ width: '100%' }}>
      <div className="rack-status-dot" />
      <div className="rack-name">{rack.rack_id}</div>
      <div className="rack-pct">{rack.used}/{rack.capacity} · {rack.status}</div>
      <div className="progress"><div className={`progress-bar ${pctColorClass(p)}`} style={{ width: `${p}%` }} /></div>
      <div className="text-xs text-muted mt-1">{rack.available} free</div>
    </div>
  );
}
