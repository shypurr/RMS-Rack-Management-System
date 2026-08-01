// Shared rules for showing and searching stock by its source module.
//
// Every item_location row remembers the module document it arrived on
// (module_id, e.g. "SGR-1") and which module produced it (module_type, e.g.
// "Sales Return"). The warehouse relies on that to know where stock came from,
// so it is searchable on every screen — item name OR module code, one helper
// used everywhere so the rules can't drift page to page.

// Rows added by hand have no document; they all read as "Manual".
export const MANUAL = 'Manual';

export const moduleCode = (row) => row.module_id || MANUAL;

// Everything a row can be found by. Kept lowercase — callers lowercase the query.
export const searchText = (row) =>
  `${row.item} ${row.module_id || ''} ${row.module_type || MANUAL} ${row.color || ''} ${row.size || ''}`
    .toLowerCase();

// Case- and whitespace-insensitive "does this text contain the query".
// An empty query matches everything.
export const matches = (text, query) => {
  const q = (query || '').trim().toLowerCase();
  return !q || text.toLowerCase().includes(q);
};
