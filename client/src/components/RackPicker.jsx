import { useRef, useState } from 'react';
import { PAGE_SIZE } from '../lib/paging.js';

// Search-and-pick for a bin, shared by Move Item and the Rack Report.
//
// The Rack Report used a plain <select> holding every bin in the warehouse —
// 3,260 <option> elements for a hundred racks, all laid out before the page
// could be shown, and no way to find one except scrolling. A dropdown is the
// one list a "show ten more" button cannot fix: capping it at ten would leave
// the other 3,250 bins unreachable. Searching is what makes ten enough.
//
// So: ten suggestions at a time, and typing narrows them. `value` is the
// numeric rack_master.id — never the display code, which re-pads as the
// organization grows and cannot address a row.
export default function RackPicker({
  candidates, value, onChange, placeholder = 'Search rack…', renderMeta,
}) {
  // null while nobody is mid-search, and the box then shows what is CHOSEN
  // rather than the last thing typed into it.
  const [typed, setTyped] = useState(null);
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);

  const chosen = value ? candidates.find((r) => String(r.id) === String(value)) : null;
  const text = typed ?? (chosen ? chosen.rack_id : '');

  const q = String(typed ?? '').trim().toLowerCase();
  const matches = (typed === null
    ? candidates
    : candidates.filter((r) => r.rack_id.toLowerCase().includes(q))
  ).slice(0, PAGE_SIZE);

  const choose = (r) => { setTyped(null); setOpen(false); onChange(r.id); };
  const onType = (v) => { if (value) onChange(''); setTyped(v); setOpen(true); };
  const close = () => { setOpen(false); setTyped(null); };

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="form-control"
        placeholder={placeholder}
        value={text}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => { clearTimeout(blurTimer.current); setOpen(true); }}
        onBlur={() => { blurTimer.current = setTimeout(close, 150); }}
      />
      {open && (
        <div className="txn-dropdown">
          {matches.length ? matches.map((r) => (
            <div key={r.id} className="txn-option" onMouseDown={() => choose(r)}>
              <span className="font-600 text-primary-color">{r.rack_id}</span>
              <span className="text-sm text-muted">
                &nbsp; {renderMeta
                  ? renderMeta(r)
                  : `${r.available} free${r.status === 'Vacant' ? ' · empty' : ''}`}
              </span>
            </div>
          )) : <div className="txn-option text-muted">No racks match</div>}
        </div>
      )}
    </div>
  );
}
