// Self-check for the Vastra source-module read path. No test framework —
// `node checkModules.js`. Needs no database and no api-key: it stubs the Vastra
// HTTP layer with the exact response bodies from the published API doc
// (http://13.235.138.204:3000/vastra-custom-api-doc/ → Rack Manager).
//
// Asserts:
//   (a) the request is built correctly: rack-manager path, numeric moduleType,
//       search_string only when searching, raw access token header
//   (b) a Jobslip master flattens to one row per design + material line
//   (c) `page.next` is followed and rows accumulate across pages
//   (d) paging terminates when `next` is absent or self-referential
//   (e) all four module names map to their documented numbers
//   (f) Delivery Challan (the outbound picklist module) is moduleType 5, is
//       kept out of MODULE_TYPES, and flattens like any other module
import 'dotenv/config';
import assert from 'node:assert/strict';

const VASTRA_HOST = 'http://vastra.test';
process.env.VASTRA_API_BASE_URL = `${VASTRA_HOST}/api/v2`;

const { fetchModuleTransactions, MODULE_TYPES, PICK_MODULE_TYPE } = await import('./src/vastraClient.js');

// Every intercepted request lands here so assertions can inspect what we sent.
const sent = [];
let reply = () => { throw new Error('no Vastra stub installed'); };

globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url));
  sent.push({ url: u, headers: opts?.headers || {}, method: opts?.method });
  return new Response(JSON.stringify(reply(u)), {
    status: 200, // Vastra always answers 200 and puts success/failure in the body.
    headers: { 'content-type': 'application/json' },
  });
};

const ok = (label) => console.log(`  ✓ ${label}`);

// Verbatim from the API doc's Jobslip (moduleType 1) example.
const JOBSLIP_MASTER = {
  organizationID: 12397,
  masterID: '1783935130250_83b60d51',
  masterNo: 'JOB-92',
  date: '2026-07-13T04:02:04.000Z',
  name: 'Manoj',
  designDetails: [{
    size_id: '', size_name: '', itemName: 'V-V113013',
    itemTypeID: 'jzw0lhhK_1767951735312', color_name: 'No Color',
    color_id: '701', quantity: 1, rate: '',
    jobslip_master_id: '1783935130250_83b60d51',
  }],
  materialDetails: [{
    itemName: '012', itemTypeID: '6ebd5e242e4360a6_1733400920469',
    color_name: 'No Color', color_id: '701',
    fk_jobslipMatInfoID: '1780913613955_6e9edb97', quantity: 250,
    jobslip_master_id: '1780913609230_9a937ae8',
  }],
  fk_parentJobslipID: '',
  karigarOrgID: '12397_Yk90g1733403653533',
};

// ── (a) + (b) request shape and flattening ────────────────────────────────
sent.length = 0;
reply = () => ({ status: true, page: {}, data: [JOBSLIP_MASTER] });
let rows = await fetchModuleTransactions('tok-abc', 'Job Slip', 'Job19');

assert.equal(sent.length, 1);
assert.equal(sent[0].url.pathname, '/api/v2/rack-manager/basic-details');
assert.equal(sent[0].url.searchParams.get('moduleType'), '1');
assert.equal(sent[0].url.searchParams.get('search_string'), 'Job19');
// The doc's `&?search_string=` typo must not survive into a real query string.
assert.equal(sent[0].url.search.includes('&?'), false, 'doc typo leaked into the URL');
// Vastra takes the RAW token — a "Bearer " prefix here is rejected upstream.
assert.equal(sent[0].headers.authorization, 'tok-abc');
ok('request: rack-manager path, moduleType=1, search_string passed, raw token');

assert.equal(rows.length, 2, 'one design + one material line → 2 rows');
assert.deepEqual(
  rows.map((r) => [r.id, r.detail_kind, r.item, r.color, r.size, r.qty]),
  [
    ['JOB-92', 'design', 'V-V113013', 'No Color', '', 1],
    ['JOB-92', 'material', '012', 'No Color', '', 250],
  ]
);
assert.equal(rows[0].module_type, 'Job Slip');
assert.equal(rows[0].rate, null, "empty-string rate must become null, not NaN");
assert.equal(rows[1].qty, 250);
assert.equal(new Set(rows.map((r) => r.line_id)).size, 2, 'line_id must be unique per row');
ok('JOB-92 flattens to 2 rows (design + material) in the client row shape');

// ── search_string omitted when browsing ───────────────────────────────────
sent.length = 0;
await fetchModuleTransactions('tok-abc', 'Job Slip');
assert.equal(sent[0].url.searchParams.has('search_string'), false);
ok('browse mode (no query) omits search_string entirely');

// ── (c) pagination is followed ────────────────────────────────────────────
sent.length = 0;
let call = 0;
reply = () => {
  call++;
  const master = { ...JOBSLIP_MASTER, masterID: `m${call}`, masterNo: `JOB-9${call}` };
  return call < 3
    ? { status: true, page: { next: `/rack-manager/basic-details?moduleType=1&pageno=${call + 1}` }, data: [master] }
    : { status: true, page: {}, data: [master] };
};
rows = await fetchModuleTransactions('tok-abc', 'Job Slip');
assert.equal(call, 3, 'should have followed next twice then stopped');
assert.equal(rows.length, 6, '3 pages × 2 lines');
assert.deepEqual([...new Set(rows.map((r) => r.id))], ['JOB-91', 'JOB-92', 'JOB-93']);
ok('page.next followed across 3 pages, rows accumulated');

// ── (d) a self-referential next must not loop forever ─────────────────────
sent.length = 0;
reply = (u) => ({
  status: true,
  page: { next: `${u.pathname.replace('/api/v2', '')}${u.search}` }, // points at itself
  data: [JOBSLIP_MASTER],
});
rows = await fetchModuleTransactions('tok-abc', 'Job Slip');
assert.equal(sent.length, 1, 'self-referential next must stop after one page');
ok('self-referential page.next terminates instead of looping');

// ── (e) module name → documented number ───────────────────────────────────
const expected = { 'Job Slip': '1', 'Sales Return': '2', 'Purchase Inward': '3', 'Pack Design': '4' };
reply = () => ({ status: true, page: {}, data: [] });
for (const name of MODULE_TYPES) {
  sent.length = 0;
  await fetchModuleTransactions('tok-abc', name);
  assert.equal(sent[0].url.searchParams.get('moduleType'), expected[name], `${name} number`);
}
ok('all four MODULE_TYPES map to their documented moduleType numbers');

await assert.rejects(() => fetchModuleTransactions('tok-abc', 'Not A Module'));
ok('an unknown module name is rejected instead of silently querying moduleType=undefined');

// ── (f) Delivery Challan — outbound, picklist only ────────────────────────
// Putaway (Add Item) and the no-moduleType fan-out both iterate MODULE_TYPES,
// so a challan appearing there would offer outbound documents for inbound work.
assert.equal(PICK_MODULE_TYPE, 'Delivery Challan');
assert.equal(MODULE_TYPES.includes(PICK_MODULE_TYPE), false, 'DC must stay out of the inbound list');

sent.length = 0;
await fetchModuleTransactions('tok-abc', PICK_MODULE_TYPE);
assert.equal(sent[0].url.searchParams.get('moduleType'), '5');
ok('Delivery Challan queries moduleType=5 and is excluded from MODULE_TYPES');

// A challan carries several design lines under one masterNo — that grouping is
// what the picklist route relies on to rebuild the whole document.
sent.length = 0;
reply = () => ({
  status: true,
  page: {},
  data: [{
    ...JOBSLIP_MASTER,
    masterID: 'dc-1', masterNo: 'DC-104', name: 'Ramesh',
    designDetails: [
      { itemName: 'Rayon Kurti', color_name: 'Blue', size_name: 'L', quantity: 30, rate: '', itemTypeID: 'a' },
      { itemName: 'Rayon Kurti', color_name: 'Pink', size_name: 'M', quantity: 12, rate: '', itemTypeID: 'b' },
      { itemName: 'Silk Stole', color_name: 'Gold', size_name: 'Free Size', quantity: 5, rate: '', itemTypeID: 'c' },
    ],
    materialDetails: [],
  }],
});
rows = await fetchModuleTransactions('tok-abc', PICK_MODULE_TYPE, 'DC-104');
assert.equal(rows.length, 3, 'a 3-line challan flattens to 3 rows');
assert.deepEqual([...new Set(rows.map((r) => r.id))], ['DC-104'], 'all lines share one masterNo');
assert.equal(new Set(rows.map((r) => r.line_id)).size, 3, 'line_id unique per challan line');
assert.deepEqual(rows.map((r) => r.qty), [30, 12, 5]);
assert.equal(rows[0].party, 'Ramesh');
ok('a multi-line DC flattens to one row per line, all sharing the challan no');

console.log('\nAll source-module checks passed.');
