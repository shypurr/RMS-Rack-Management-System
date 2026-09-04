import { useEffect, useMemo, useState } from 'react';

// Ten rows at a time, everywhere.
//
// Nothing in this app renders a whole table any more. A warehouse that has been
// running for a year has tens of thousands of stock rows and audit entries, and
// a browser asked to lay out all of them at once stops responding — on the
// hardware a warehouse actually has, well before the data looks large to anyone
// reading a row count.
//
// The rule lives here rather than in each page so it is one number in one
// place. Change PAGE_SIZE and every list in the portal changes with it.
export const PAGE_SIZE = 10;

// Paging over a list the page already holds in memory (a filtered array, a
// grouped one). Lists that come from the server page there instead — see
// History — because the point of that one is that the older rows were never
// fetched at all.
//
// `resetKey` is what says "this is a different list now": a search box, a tab,
// a chosen filter. It defaults to the list's length, which catches most
// changes on its own; pass the search text where one exists, so that two
// searches happening to return the same number of rows still start at page one.
// Without a reset, typing a new search after four presses of "Show 10 more"
// would open on fifty results.
export function usePaged(rows, { size = PAGE_SIZE, resetKey } = {}) {
  const list = rows || [];
  const [shown, setShown] = useState(size);
  const key = resetKey === undefined ? list.length : resetKey;

  useEffect(() => { setShown(size); }, [key, size]);

  const visible = useMemo(() => list.slice(0, shown), [list, shown]);
  const remaining = Math.max(0, list.length - visible.length);

  return {
    visible,
    shown: visible.length,
    total: list.length,
    remaining,
    hasMore: remaining > 0,
    size,
    loadMore: () => setShown((n) => n + size),
  };
}
