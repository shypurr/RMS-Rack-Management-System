import { occupancyBucket, pct, pctColorClass } from '../lib/rack.js';

// Reference-style rack tile. `bucket` coloring is display-only; the stored
// status (Vacant/Occupied) is shown as a small label.
//
// `subtitle` is optional and describes what is inside — Rack Management passes
// the shelf and bin counts, since its tiles are whole racks whose numbers are
// sums over many bins rather than one bin's own.
//
// `onEdit` adds the pencil. It is shown on every rack, including full ones: a
// rack with stock in it cannot be reshaped, but hiding the button would leave
// the user guessing why. Pressing it there explains what is in the way instead.
export default function RackCard({ rack, onClick, subtitle, onEdit }) {
  const bucket = occupancyBucket(rack.used, rack.capacity);
  const p = pct(rack.used, rack.capacity);
  return (
    <div className={`rack-card ${bucket}`} onClick={onClick} style={{ width: '100%' }}>
      <div className="rack-status-dot" />
      {onEdit && (
        // stopPropagation, or the click also opens the rack behind the dialog.
        <button
          type="button"
          className="rack-card-edit"
          title={`Change the shelves, bins and capacity of ${rack.rack_id}`}
          aria-label={`Edit ${rack.rack_id}`}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
        >
          <i className="fa-solid fa-pen" />
        </button>
      )}
      <div className="rack-name">{rack.rack_id}</div>
      <div className="rack-pct">{rack.used.toLocaleString()}/{rack.capacity.toLocaleString()} · {rack.status}</div>
      <div className="progress"><div className={`progress-bar ${pctColorClass(p)}`} style={{ width: `${p}%` }} /></div>
      <div className="text-xs text-muted mt-1">
        {rack.available.toLocaleString()} free{subtitle ? ` · ${subtitle}` : ''}
      </div>
    </div>
  );
}
