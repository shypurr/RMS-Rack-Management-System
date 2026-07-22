// Thin fetch wrapper. Throws Error(message) on non-2xx so callers can toast it.
async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  listRacks: () => request('/racks'),
  getRack: (id) => request(`/racks/${encodeURIComponent(id)}`),
  createRack: (rackId, capacity) => request('/racks', { method: 'POST', body: { rackId, capacity } }),

  addItem: (payload) => request('/item-locations', { method: 'POST', body: payload }),
  findPlacements: (item, color = '', size = '') =>
    request(`/item-locations/placements?item=${encodeURIComponent(item)}&color=${encodeURIComponent(color)}&size=${encodeURIComponent(size)}`),
  updateItemQty: (id, qty) => request(`/item-locations/${id}`, { method: 'PATCH', body: { qty } }),
  move: (itemId, toRackId, qty) => request('/moves', { method: 'POST', body: { itemId, toRackId, qty } }),

  sourceTransactions: (moduleType, q = '', limit = 10) => {
    const p = new URLSearchParams();
    if (moduleType) p.set('moduleType', moduleType);
    if (q) p.set('q', q);
    if (limit) p.set('limit', String(limit));
    return request(`/source-transactions?${p.toString()}`);
  },
  auditLog: (action) => request(`/audit-log${action ? `?action=${encodeURIComponent(action)}` : ''}`),

  dashboard: () => request('/dashboard'),
  listItems: () => request('/item-locations'),
};
