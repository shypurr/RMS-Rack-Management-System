// Session token from the Vastra OTP login. Opaque — the Vastra access_token
// itself never reaches the browser. Key follows the `wms-theme` convention.
const TOKEN_KEY = 'wms-token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Thin fetch wrapper. Throws Error(message) on non-2xx so callers can toast it.
async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // 401 from anywhere means the session is gone — drop it and go to /login.
  if (res.status === 401) {
    clearToken();
    if (window.location.pathname !== '/login') window.location.replace('/login');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  sendOtp: (country_code, mobile, is_resend = 0) =>
    request('/auth/send-otp', { method: 'POST', body: { country_code, mobile, is_resend } }),
  verifyOtp: (country_code, mobile, otp) =>
    request('/auth/verify-otp', { method: 'POST', body: { country_code, mobile, otp } }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),

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
  // Picklist (Flow C). `challans` feeds the DC dropdown, `picklist` is
  // read-only, `pickItems` is the one that deducts stock.
  challans: (q = '', limit = 10) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (limit) p.set('limit', String(limit));
    return request(`/picklist/challans?${p.toString()}`);
  },
  // Manual path: the user types the challan, we answer where its items are.
  resolvePicklist: (body) => request('/picklist/resolve', { method: 'POST', body }),
  picklist: (dcNo) => request(`/picklist/${encodeURIComponent(dcNo)}`),
  // dcNo is optional — manual entry has none, it only exists on the module path.
  pickItems: (dcNo, picks) =>
    request('/picklist/pick', { method: 'POST', body: { dcNo: dcNo || null, picks } }),

  auditLog: (action) => request(`/audit-log${action ? `?action=${encodeURIComponent(action)}` : ''}`),

  dashboard: () => request('/dashboard'),
  listItems: () => request('/item-locations'),
};
