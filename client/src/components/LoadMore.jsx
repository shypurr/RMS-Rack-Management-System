// The footer under every list in the portal: how much of it you are looking at,
// and a button for the next ten.
//
// It always says the count, even when there is nothing more to load. A list
// that silently stops at ten looks like a list with ten things in it — that is
// exactly how the old 200-record ceiling in History hid itself, and the screen
// said "no records match" when it meant "not loaded". Saying "Showing 10 of
// 318" costs one line and can never be misread.
// `quiet` drops the footer entirely while everything already fits. Small nested
// lists — the few items inside one bin — use it so a card holding three rows
// does not carry a line telling you it is showing three of three.
export default function LoadMore({ shown, total, remaining, size = 10, onMore, noun = 'rows', busy = false, quiet = false }) {
  if (!total) return null;
  if (quiet && remaining === 0) return null;
  return (
    <div className="load-more">
      <span className="text-sm text-muted">
        Showing {shown.toLocaleString()} of {total.toLocaleString()} {noun}
      </span>
      {remaining > 0 && (
        <button className="btn btn-outline btn-sm" onClick={onMore} disabled={busy}>
          <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-chevron-down'}`} />
          &nbsp; {busy ? 'Loading…' : `Show ${Math.min(size, remaining)} more`}
        </button>
      )}
    </div>
  );
}
