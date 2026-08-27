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

  // Rack layout (setup screen). `preview` writes nothing; `apply` carries the
  // version preview returned, so a layout edited in another tab is rejected
  // rather than silently clobbered.
  layout: () => request('/layout'),
  layoutPreview: (body) => request('/layout/preview', { method: 'POST', body }),
  layoutApply: (body) => request('/layout/apply', { method: 'POST', body }),

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
  // picklistId closes the matching history entry (rack updated: yes).
  pickItems: (dcNo, picks, picklistId = null) =>
    request('/picklist/pick', { method: 'POST', body: { dcNo: dcNo || null, picks, picklistId } }),

  // Re-resolve a stored picklist against current stock (History → Update).
  reresolvePicklist: (id) => request(`/picklist/${id}/resolve`),

  historyPutaway: (limit = 100) => request(`/history/putaway?limit=${limit}`),
  historyPicklists: (limit = 100) => request(`/history/picklists?limit=${limit}`),

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
