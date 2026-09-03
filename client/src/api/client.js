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

// Only the filters that are actually set are sent, so an empty box never
// narrows anything server-side.
function historyQuery({ q, from, to, status, limit, offset } = {}) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (status) p.set('status', status);
  if (limit) p.set('limit', String(limit));
  if (offset) p.set('offset', String(offset));
  return p.toString();
}

export const api = {
  sendOtp: (country_code, mobile, is_resend = 0) =>
    request('/auth/send-otp', { method: 'POST', body: { country_code, mobile, is_resend } }),
  verifyOtp: (country_code, mobile, otp) =>
    request('/auth/verify-otp', { method: 'POST', body: { country_code, mobile, otp } }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),

  // QR login. `qrStart` returns the value to draw plus the secret that proves
  // this tab owns the attempt; `qrStatus` is polled until it answers approved,
  // at which point it carries the same { token, org } verify-otp does.
  qrStart: () => request('/auth/qr/start', { method: 'POST' }),
  qrStatus: (id, secret) =>
    request(`/auth/qr/status?id=${encodeURIComponent(id)}&secret=${encodeURIComponent(secret)}`),
  qrCancel: (id, secret) => request('/auth/qr/cancel', { method: 'POST', body: { id, secret } }),

  listRacks: () => request('/racks'),
  // `id` is the numeric rack_master.id, not the display code — codes re-pad
  // when the organization grows, so they cannot address a row.
  getRack: (id) => request(`/racks/${id}`),

  // Rack layout (setup screen). `addRacks` appends one batch of racks after the
  // ones already there — it is the only call that changes the layout, and it
  // cannot remove anything. Removing racks is a separate flow.
  layout: () => request('/layout'),
  addRacks: (body) => request('/layout/racks', { method: 'POST', body }),

  addItem: (payload) => request('/item-locations', { method: 'POST', body: payload }),
  findPlacements: (item, color = '', size = '') =>
    request(`/item-locations/placements?item=${encodeURIComponent(item)}&color=${encodeURIComponent(color)}&size=${encodeURIComponent(size)}`),
  // updateItemQty removed with its endpoint — stored quantities are not
  // hand-editable. See the note in server/src/routes/itemLocations.js.
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
  // picklistId closes the matching history entry (rack updated: yes).
  pickItems: (dcNo, picks, picklistId = null) =>
    request('/picklist/pick', { method: 'POST', body: { dcNo: dcNo || null, picks, picklistId } }),

  // Re-resolve a stored picklist against current stock (History → Update).
  reresolvePicklist: (id) => request(`/picklist/${id}/resolve`),

  // History searches, filters by date and paginates on the SERVER — the old
  // "fetch 200 and filter in the browser" made everything older than the last
  // 200 records unreachable. Both return { total, rows }.
  historyPutaway: (params = {}) => request(`/history/putaway?${historyQuery(params)}`),
  historyPicklists: (params = {}) => request(`/history/picklists?${historyQuery(params)}`),
  // One stored picklist's lines, as recorded — powers expanding a history row.
  historyPicklist: (id) => request(`/history/picklists/${id}`),

  // The PDF endpoint needs the Authorization header, which a plain
  // window.open() cannot send — so fetch it, then open the result as a blob.
  // Wrapped in a File so the viewer's download button gets a real filename.
  picklistPdf: async (id, name) => {
    const res = await fetch(`/api/picklist/${id}/pdf`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Could not build the PDF (${res.status})`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(new File([blob], `${name}.pdf`, { type: 'application/pdf' }));
  },

  auditLog: (action) => request(`/audit-log${action ? `?action=${encodeURIComponent(action)}` : ''}`),

  dashboard: () => request('/dashboard'),
  listItems: () => request('/item-locations'),
};
