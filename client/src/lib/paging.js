import { useEffect, useMemo, useState } from 'react';

// Ten rows at a time, on the three screens that need it.
//
// Those are Move Item, History and the Audit Log: the lists that grow without
// limit as the warehouse runs. A year of trading is tens of thousands of audit
// entries, and a browser asked to lay all of them out at once stops responding
// long before the number looks large to anyone reading it.
//
// It is deliberately NOT applied everywhere. Rack Management shows every rack,
// because the whole point of that screen is seeing the warehouse at a glance
// and a rack count is fixed by the building, not by how long you have been
// trading. Item Management, Reports, Rack Setup and the Rack Report are left
// whole for the same reason: their size is bounded by things that do not keep
// growing on their own.
//
// The rule lives here rather than in each page so it is one number in one
// place. Change PAGE_SIZE and those three screens change with it.
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
