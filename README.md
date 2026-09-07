# RMS — Rack Management System

Rack Management module for Vastra (textile WMS). React + Vite frontend, Node/Express API,
MySQL. Implements the SRS: add / update / move items across rack bins with a shared-capacity
guard, atomic moves, and a full audit trail.

- `server/` — Express + MySQL API.
- `client/` — Vite + React app (reproduces the `wms/` look).
- `wms/`, `docs/` — the senior dev's static mockup and the SRS. Both are **gitignored**, so a
  fresh clone won't have them; they are reference material only, never run or modified.

## Prerequisites
- Node 18+
- A running MySQL 8 (CHECK constraints are used). Set credentials in `server/.env` (copy from
  `.env.example`).
- Vastra API credentials — see [Login](#login) below. Without them the app starts and
  `/api/health` answers, but nobody can sign in.

> Deploying rather than developing? Skip to [Deployment](#deployment) — it covers the build,
> the required environment, and what the server does to the database at boot.

## Run

> ⚠️ **`npm run seed` erases all racks, stock and history.** Run it once when setting up a
> new database, and never again on one that holds real organizations — it drops and
> recreates those tables every time it runs. Logins and picklist history survive
> (they live in `auth.sql` / `picklist.sql`, applied at boot); racks and stock do not.

```bash
# 1. Backend
cd server
npm install
npm run seed        # FIRST TIME ONLY — creates DB `rms`, applies schema, loads demo data
npm run dev         # http://localhost:4000

# 2. Frontend (new terminal)
cd client
npm install
npm run dev         # http://localhost:5173  (proxies /api → :4000)
```

## Deployment

This is an ordinary long-running Node process — **not** serverless, no Lambda handler, no AWS
SDK, no platform-specific packaging. It runs anywhere Node 18+ runs: EC2, a VPS, Docker,
Render, Railway, or plain systemd/pm2 on a box.

### One service, not two

The client and the server are separate packages (`client/`, `server/`) with their own
`package.json` and lockfile, but they **deploy as a single service**. `src/app.js` serves
`client/dist` as static files when that directory exists, so the client's relative `/api`
calls land on the same origin — no CORS configuration, no second host, no `VITE_API_URL` to
set. There are no hardcoded URLs anywhere in `client/src`.

From the repository root:

```bash
npm run build     # installs both sides, builds the client into client/dist
npm start         # node server/src/index.js — listens on $PORT (default 4000)
```

`npm run build` installs the server with `--omit=dev`, so the dev-only MQTT broker (`aedes`)
is not pulled into production.

> Splitting them is supported but unnecessary: `client/dist` is a plain static bundle that any
> CDN can host. If you do split it, lock down `cors()` first — see
> [Before production](#before-production).

### What the deploy needs

| Requirement | Detail |
|-------------|--------|
| **Node 18+** | Enforced by `engines` in each `package.json`. The server uses ESM and top-level `await`. |
| **MySQL 8+** | `CHECK` constraints are used, so MySQL 8+ or MariaDB 10.2+. MariaDB below that will reject the schema. |
| **The database must already exist** | The app creates *tables*, not the *database*. Run `CREATE DATABASE rms CHARACTER SET utf8mb4;` once — or run `npm run seed` on a throwaway database, which does it for you. |
| **`server/.env`** | Gitignored, so a fresh clone has none. Copy `server/.env.example`, which documents every variable. |
| **Outbound TCP to the Vastra host** | `VASTRA_API_BASE_URL` for OTP login, and `MQTT_URL` for QR login. See [Network egress](#network-egress). |

Minimum environment for a staging deploy:

```bash
DB_HOST=…  DB_PORT=3306  DB_USER=…  DB_PASSWORD=…  DB_NAME=rms
DB_SSL=true                 # required by most managed MySQL; omit for a local/VPC database
PORT=4000
VASTRA_API_BASE_URL=…       # no fallback is baked in — unset means nobody can log in
VASTRA_API_KEY=…
MQTT_URL=…                  # optional; unset simply disables QR login
```

### Migrations run themselves

There is no migrate step to wire into the deploy pipeline. Every schema file is
`CREATE TABLE IF NOT EXISTS` and is applied at boot, and the one-time reshaping migrations are
guarded by a ledger table so each runs at most once, ever. **Starting the server is the
migration.** See [Migrations](#migrations) for the full picture.

Boot is deliberately non-fatal: if the database or broker is unreachable the process still
starts and says exactly what is wrong in the log, rather than crash-looping.

### Verifying a deploy

```bash
curl -s https://<host>/api/health
# {"ok":true,"db":"up"}                                   → API up, schema applied, DB reachable
# {"ok":false,"db":"down","code":"ENOTFOUND","host":"…"}  → see Troubleshooting
```

The endpoint is public by design, and reports the DB hostname only — never the user, port or
password. Loading the root URL should then serve the React app.

### Network egress

QR login needs an outbound connection from the **server** to Vastra's MQTT broker (the browser
never connects to it — an HTTPS page cannot open a `ws://` socket, which is why this lives in
Node). If that port is firewalled, the app still starts and OTP login works normally; only QR
login is unavailable, and the reason is printed at boot. `.env.example` documents the three
broker URLs that are known to work and why the scheme matters.

### ⚠️ Do not run `npm run seed` on staging

It **drops and rebuilds** the four `core.sql` tables — all racks, stock and audit history.
Logins, picklist history and layouts survive, but the warehouse does not. It exists to load
demo data into a development database. A staging deploy does not need it: the app builds its
own schema at boot.

## Project structure

Server paths are relative to `server/src/`, client paths to `client/src/`. The server is
layered **route → service → db**: nothing below `services/` knows about HTTP.

| Feature | Server | Client |
|---------|--------|--------|
| **Login** (mobile + OTP) | `routes/auth.js` → `services/session.js`, `vastraClient.js` | `pages/Login.jsx`, `lib/otp.js` |
| **QR login** | `services/qrLogin.js`, `mqttClient.js` | `components/QrSignIn.jsx` |
| **Dashboard** | `routes/dashboard.js` → `services/dashboardService.js` | `pages/Dashboard.jsx`, `lib/charts.js` |
| **Rack setup / layout** | `routes/layout.js` → `services/layoutService.js`, `middleware/requireLayoutPermission.js` | `pages/RackSetup.jsx`, `lib/layout.js`, `components/SetupGate.jsx` |
| **Rack list & drilldown** | `routes/racks.js` → `services/rackService.js` | `pages/RackList.jsx`, `components/RackCard.jsx`, `lib/rack.js` |
| **Putaway** (Flow A) | `routes/itemLocations.js` → `rackService.addItem`, `findPlacements` | `pages/AddItem.jsx`, `lib/putaway.js` |
| **Move** (Flow B) | `routes/moves.js` → `rackService.moveItem` | `pages/MoveItem.jsx`, `components/RackPicker.jsx` |
| **Picklist** (Flow C) | `routes/picklist.js` → `services/picklistStore.js`, `services/picklistPdf.js`, `rackService.pickItems` | `pages/Picklist.jsx` |
| **Source modules** | `routes/sourceTransactions.js` → `services/sourceModules.js` | `lib/items.js` |
| **Stock list** | `routes/itemLocations.js` | `pages/ItemManagement.jsx` |
| **History** | `routes/history.js` → `services/picklistStore.js` | `pages/History.jsx` |
| **Audit log** | `routes/audit.js` → `services/audit.js` | `pages/AuditLog.jsx` |
| **Reports** | `routes/dashboard.js`, `routes/racks.js` | `pages/Reports.jsx`, `pages/RackReport.jsx` |
| **Rack display codes** | `lib/rackCode.js` — derived, never stored | — |
| **Pagination** | `limit`/`offset` on the route | `lib/paging.js`, `components/LoadMore.jsx` |
| **Auth gate / errors** | `middleware/requireAuth.js`, `lib/httpError.js` | `api/client.js` (401 → `/login`) |
| **App shell, theme, toasts** | — | `components/Layout.jsx`, `components/Toast.jsx`, `lib/useTheme.js` |

### Client routes

Defined in `main.jsx`; pages live in `pages/`. `SetupGate` redirects to `/setup` when the
organization has no bins yet.

| Path | Page | Gated by `SetupGate` |
|------|------|:--:|
| `/login` | `Login.jsx` | — |
| `/` | `Dashboard.jsx` | |
| `/racks` | `RackList.jsx` | ✓ |
| `/setup` | `RackSetup.jsx` | |
| `/items` | `ItemManagement.jsx` | |
| `/add` | `AddItem.jsx` | ✓ |
| `/move` | `MoveItem.jsx` | ✓ |
| `/picklist` | `Picklist.jsx` | ✓ |
| `/history` | `History.jsx` | |
| `/reports` | `Reports.jsx` | |
| `/report` | `RackReport.jsx` | |
| `/audit` | `AuditLog.jsx` | |

### Self-checks and dev tools

No test framework — run each with `node`; it prints its own assertions. See
[Verify](#verify-matches-plan).

| Script | Covers |
|--------|--------|
| `checkAuth.js` | the Vastra login path end to end |
| `checkTenancy.js` | cross-organization isolation — that no route leaks between orgs |
| `checkLayout.js` / `layoutEdit.check.mjs` | rack layout maths, and editing one rack |
| `checkModules.js` | the Vastra source-module read path |
| `checkQrLogin.js` | the QR protocol, with no DB, broker or network |
| `checkRackCode.js` | rack code derivation and re-padding |
| `checkSessionRecovery.js` | what happens when Vastra stops accepting a stored token |
| `historySearch.check.mjs` | history filters and server-side paging |
| `inwardFixtures.check.mjs` | the inward document generator |
| `client/src/lib/*.check.mjs` | the client's pure logic — `layout`, `otp` and `putaway` — with no browser or server needed |
| `devBroker.js`, `devFakeVastra.js`, `devPublishQr.js` | local stand-ins so QR login can be driven with no Vastra access at all |
| `makeChallans.js`, `makeInwards.js` | add sample documents to an existing database — unlike `seed.js`, these drop **nothing** |

## Login

**Vastra is the identity provider.** Only organizations that already exist in Vastra can use
RMS — there is no signup, no password login and no admin "create user" screen. An
`organization` row appears in our DB only as a side effect of a successful, Vastra-verified
OTP login: we mirror the identity Vastra hands back so the audit trail and foreign keys have
something to point at.

Flow: **mobile → Vastra texts an OTP → verify → opaque session token.**

1. `POST /api/auth/send-otp` → Vastra's `loyalty-signup` sends the SMS (staging echoes the
   OTP in the response message).
2. `POST /api/auth/verify-otp` → Vastra's `loyalty-verifyotp` returns the org profile. We
   upsert `organization` (matched on `vastra_org_id`), issue a `session` row, and return
   `{ token, org }`.
3. The client stores that token under `localStorage['wms-token']` and sends it as
   `Authorization: Bearer <token>` on every call. A 401 from any endpoint clears it and
   redirects to `/login`.

The token is opaque and lives in a DB table — not a JWT — which is what makes it revocable:
one active session per org (logging in anywhere kills the previous session), `POST
/api/auth/logout` deletes it, and flipping `organization.blocked = 1` logs an org out on its
next request.

Vastra's own `access_token` is stored in `organization.vastra_access_token` and **never
leaves the server**. All Vastra traffic is server-side; the browser never touches the Vastra
host.

### Vastra env vars (`server/.env`)

| Var | Default | Notes |
|-----|---------|-------|
| `VASTRA_API_BASE_URL` | *(none — fails closed)* | e.g. `http://13.235.138.204:3000/api/v2`. No fallback is hardcoded. Use the base URL you were given: the friendly `webstaging.vastraapp.com` host 301s POSTs away and drops the path. |
| `VASTRA_API_KEY` | *(empty)* | Sent as the `api-key` header on every request. |
| `VASTRA_API_TIMEOUT` | `10000` | ms, via `AbortSignal.timeout()`. |
| `VASTRA_UDID` | `rms-backend` | Fixed value, accepted by Vastra. |
| `VASTRA_DEVICE_TYPE` | `android` | Fixed value, accepted by Vastra. |
| `USE_VASTRA_MODULES` | `false` | `true` reads Flow A from the real Vastra modules instead of the `source_transaction` stub — see [Source modules](#source-modules-flow-a). Off by default because the demo dataset lives in the stub. |
| `USE_VASTRA_PICKLIST` | follows `USE_VASTRA_MODULES` | Same switch for the challan feed alone. Set it to `false` to pick against the sample challans from `makeChallans.js` while Add Item keeps reading live Vastra — see [Sample challans](#sample-challans-to-test-with). |

`server/src/vastraClient.js` is the only module that talks to Vastra. Two notes on that API:
every endpoint answers **HTTP 200** and puts success/failure in the body (read `status`, not
the HTTP code), and the `authorization` header takes the **raw** access token — no `Bearer`
prefix.

### Source modules (Flow A)

Flow A auto-fills Add Item from a source document (`Purchase Inward`, `Job Slip`,
`Pack Design`, `Sales Return`). Two backends, chosen by `USE_VASTRA_MODULES`:

- **off (default)** — the `source_transaction` stub table, loaded by `npm run seed`.
- **on** — the live Vastra read, implemented in `fetchModuleTransactions()`.

All four modules are **one endpoint** discriminated by a numeric `moduleType`, not four paths:

```
GET /rack-manager/basic-details?moduleType=1&search_string=Job19
```

| `moduleType` | Module | Note |
|---|---|---|
| 1 | Job Slip | |
| 2 | Sales Return | Vastra calls it "Order Return" — same module |
| 3 | Purchase Inward | |
| 4 | Pack Design | |
| 5 | Delivery Challan | **Outbound.** Picklist only — see [Picklist](#picklist-flow-c) |

The first four are inbound and make up `MODULE_TYPES`, which drives both the Add Item dropdown
and the fan-out when `/api/source-transactions` is called without a `moduleType`. Delivery
Challan is deliberately **not** in that array (it's `PICK_MODULE_TYPE`): a challan takes stock
out, so offering it during putaway would be wrong.

Notes worth keeping, all learned the hard way:

- The dev-supplied path `/rekManager/basic-details` **404s**; `rack-manager` is the one that
  resolves. The API doc writes the query separator as `&?search_string=` — that literal `?`
  mid-query is a typo in the doc, not something to reproduce.
- A master document carries **two** detail arrays — `designDetails` (the goods) and
  `materialDetails` (raw material consumed). Both are physically rackable, so both are
  flattened into rows and tagged `detail_kind: 'design' | 'material'`.
- Rows are normalized to the shape the stub returns — `{ id, module_type, item, color, size,
  qty }` — so the frontend needs no changes either way. The live path adds `line_id`
  (unique per line; `id` repeats across a multi-line document), `detail_kind`, `master_id`,
  `date`, `party`, `rate` and `item_type_id`.
- `id` is the document's `masterNo` (`JOB-92`), not `masterID` — it's what the user types and
  reads.
- Paging follows `page.next` (a ready-made path), capped at 20 pages and stopped if `next`
  ever points at itself.

Both backends live behind `services/sourceModules.js` → `fetchTransactions(org, { moduleType, q,
limit })`, shared by the Flow A feed and the picklist so the branching exists once. Failure
handling is there too: no stored Vastra token → **401**; an auth-shaped rejection → **401** (and the
RMS session is destroyed so the client redirects to the login screen); any other rejection → **502**.

Vastra answers `status:false` for *everything* it refuses, so an expired token and a module it
won't serve are indistinguishable at the transport level. Only an **auth-shaped** rejection
clears the stored token; anything else surfaces Vastra's own message and leaves the session
alone — otherwise one unsupported module logs the org out of the four that work. Learned by
asking for `moduleType=5` before Vastra had it.

### Picklist (Flow C)

The outbound counterpart of Add Item. Work through a Delivery Challan and RMS answers **which
rack** each item on it is sitting in — then deducts the stock once the picker confirms.

> **Vastra does not serve the Delivery Challan module yet.** So the challan's items are entered
> by hand: the user generates the challan in the Vastra app, then transcribes its item details
> here to find the racks. The module-driven path is built and wired behind the *From Vastra
> Module* tab — when the API lands, switching over is a UI toggle, not a rewrite. Both tabs
> feed the same resolver (`resolveLines()` in `routes/picklist.js`), so they cannot drift apart.

1. **Enter the items.** The challan is *not* recreated here — it already exists in the Vastra
   app, so there is no number, party or date to fill in. Only its item details are
   transcribed, and only so the racks can be found. **Size runs are the point** — pick a
   design once and fill in a quantity per size, the way the challan is laid out. The same
   design in another colour is added as its own item, exactly as the challan prints it.
2. **Generate Picklist.** Builds the table — item, colour, size, quantity, and every rack
   holding that item. Lines repeated on one challan are merged into a single row.
   **This step is read-only; it never touches stock.**
3. **Update Rack.** Deducts the quantities in the per-rack boxes. Boxes are pre-filled
   largest-rack-first until the line is covered, and the picker can override them. The whole
   challan then clears — leaving the list on screen invites picking it a second time.

A **Print PDF** button on the generated list opens a printable sheet in a new tab, laid out
with the same columns as the screen. Challan No and Party are optional fields kept only for
the history record.

Manual entry is backed by the stock actually in the racks: the item field matches on any
substring (typing `Dupatta` finds `Chiffon Dupatta`) and fills in the stored name, colour
narrows to that item's colours, and the size run shows each size with how much is on hand. A
rack lookup matches `(item, colour, size)` **exactly**, so a name that doesn't resolve would
silently find nothing — the form warns instead, and the line still goes on the list and
reports as short. `+ Add a size not in stock` covers sizes the warehouse doesn't carry.

Entering more than the racks hold is **allowed and flagged**, not blocked: a challan can
legitimately order stock you don't have. The size box turns red with `only N` under it, and
the line flows through as a shortage. Clamping would quietly rewrite the customer's order.

### Picklist history and `rack updated`

A `picklist` row is written when a picklist is **generated**, not when the racks are updated.
Generating still changes no stock — but leaving a trace is the whole point of the
`rack updated: true/false` column in History: a picklist that was produced and then never
acted on is exactly where a stock discrepancy hides.

- Regenerating while iterating on the same challan **updates the same row** (the client passes
  the id back), so history is one entry per picklist, not one per click.
- Once its racks are updated a row is **closed** — a further generate starts a new entry,
  because that is a genuinely new pick.
- `picklist_line` stores a text snapshot (including the suggested racks), not foreign keys
  into `item_location`: those rows get deducted, merged and deleted, and a history entry has
  to stay readable afterwards.
- The tables live in `migrations/picklist.sql`, applied at boot like `auth.sql` rather than
  sitting in `core.sql` — this is operational history, and `npm run seed` must not drop it.

**History tab** reads both flows from wherever each one actually records itself: putaway from
`audit_log` (`add` rows), picklists from the `picklist` table. `audit_log` alone could not
answer the question, because generating writes no audit row by design. The Audit Log tab
stays as the raw everything-view.

**Updating racks from History.** A row still showing `rack updated: false` gets an **Update**
button — the picking happened on the floor, the portal just never caught up. It opens a
confirm dialog rather than deducting on the spot, because the saved `racks` text is a snapshot
from generation time and stock may well have moved since. So the lines are **re-resolved
against stock as it is now** (`GET /api/picklist/:id/resolve`), which naturally spills the
allocation onto whichever racks currently hold the item. Any line whose racks no longer match
is called out with `sheet said: …`, since the picker is holding that paper. Confirming runs
the same `POST /api/picklist/pick` as the main tab and closes the history entry; re-resolving
an already-updated picklist is refused with **409**.

On the putaway side, `after_json.qty` is the row's total *after* the add, which for a merge
into existing stock is not what was put away — history reports the difference against
`before_json` instead, and notes what the rack held afterwards.

**Size runs.** A real challan lists one design once and spreads it across a row of sizes:

```
Sr  Item             Color      36  38  42  44  46  L   Total
1   DES-5044 Janki   No Color   1   2   3   1   1   1   9
```

That reaches RMS as one line per size — same item, same colour, different size, its own
quantity — because each size can sit in a different rack. The picklist keeps a design's sizes
adjacent (numeric sizes sort numerically, lettered ones alphabetically) so it reads the way
the challan does.

### Sample challans to test with

Only relevant to the *From Vastra Module* tab — manual entry needs no sample data, just stock
in the racks. Useful for exercising that path before the real API exists.

`node server/makeChallans.js` adds sample challans to a database that already has stock.
Unlike `npm run seed` it **drops nothing** — racks, stock and audit history are untouched.
Challans are generated from the stock actually in the racks, so the picklist resolves to real
rack ids instead of showing every line short, and each one carries a size run.

```bash
node server/makeChallans.js            # add 14 challans
node server/makeChallans.js 30         # add 30
node server/makeChallans.js --replace  # delete the existing sample challans first
```

It brings an older database up to date on its own (adds `party` / `doc_date`, widens the
`module_type` ENUM) and continues the numbering rather than colliding with what's there.

To read those samples rather than live Vastra, set **`USE_VASTRA_PICKLIST=false`**. It defaults
to whatever `USE_VASTRA_MODULES` is, so setting it explicitly is what splits the two — the
point being to test picking against sample challans while Add Item keeps reading live Vastra.
Both are read at load, so a change needs a restart.

Behaviour worth knowing:

- **Split stock** — an item in several racks gets one input per rack, capped at what that rack
  holds. The row shows `picked X / Y` and turns red when the split doesn't add up.
- **Shortage** — if the challan asks for more than the racks hold, the row is badged
  `short by N`. The update still deducts what exists (partial fulfilment is real), and a
  warning toast names the short lines. An item in no rack at all reads `Not in any rack`.
- **Atomic** — the whole picklist is one transaction. If any line over-picks, the request is
  **400** and nothing at all is written. Rows are locked in ascending id order so two
  concurrent picklists queue instead of deadlocking.
- **Audit** — each picked row writes `remove` (row emptied) or `update` (partial). Those two
  actions also mean "someone edited a quantity by hand", so `after_json` carries
  `source: 'picklist'` to tell them apart, plus `picklist: <challan no>` when one is known
  (module tab only — manual entry transcribes a challan's items, not its number).

`item_location.module_type` intentionally has **no** `Delivery Challan` member — a challan
removes stock, it never becomes the provenance of stored stock. The `source_transaction` stub
does carry it, spreading one challan over `DC-2026-0001#1`, `#2`… because `id` is that table's
primary key; the route groups on the part before the `#`.

### Migrations
There is no `schema.sql`. The schema lives in four files under `server/migrations/`, all
`CREATE TABLE IF NOT EXISTS`, applied on **every boot** from `src/index.js` in this order:

| File | Holds |
|------|-------|
| `auth.sql` | `organization`, `session`. First, because every other table has a foreign key to `organization` |
| `picklist.sql` | `picklist`, `picklist_line` — operational history |
| `layout.sql` | `rack_layout`, `rack_group`, `rack_group_override` — an organization's rack configuration |
| `core.sql` | `rack_master`, `item_location`, `audit_log`, `source_transaction` |

Because they are all `IF NOT EXISTS`, re-applying them on every boot is free and idempotent:
**starting the server is the migration.** A deploy brings its own database up to date with no
separate migrate step.

`npm run seed` drops the four `core.sql` tables *itself* — the `DROP` list lives in `seed.js`,
never in the `.sql` — and then re-applies that same file, so the table definitions exist in
exactly one place and cannot drift between "what seed builds" and "what a deploy builds".
Logins, picklist history and layouts live in the other three files and are therefore **never**
dropped by a reseed.

Reshaping a table that *already exists* is something `IF NOT EXISTS` cannot do, so those
migrations live in `src/schemaMigrations.js`, guarded by a `schema_migration` ledger table.
Each runs at most once ever, and each refuses loudly rather than destroy rows it cannot carry
across. See [the `fk_org_id` troubleshooting entry](#troubleshooting) for the one deliberate
override.

### Scope: multi-tenant, one organization per warehouse
Every business table is organization-scoped. `rack_master`, `item_location`, `audit_log`,
`source_transaction`, `picklist`, `rack_layout` and `rack_group` all carry `fk_org_id` with a
foreign key to `organization(id) ON DELETE CASCADE`, and every query filters on it —
`checkTenancy.js` is what verifies that no route leaks across organizations.

Rack identity is a surrogate `rack_master.id`, unique per organization on
`(fk_org_id, rack_no, shelf_no, bin_no)`. The human-readable code (`R001-S01-B01`) is
**derived at read time** by `src/lib/rackCode.js` and stored nowhere — so an organization
growing past a digit boundary re-pads its own labels without renaming anything, and two
organizations can each have an `R001-S01-B01` without colliding.

One deployment therefore serves many Vastra organizations, each seeing only its own racks and
stock. What is *not* implemented is **roles** — see [Deferred](#deferred).

### Before production
See [Deployment](#deployment) for the build and environment. The two open items:

- `cors()` in `src/app.js` is wide open. The session token travels in an `Authorization`
  header rather than a cookie, so this is not a CSRF hole, and it is moot while the server
  serves the client from its own origin — but lock it to a known origin, and definitely do so
  before hosting the client separately.
- `audit_log.user_id` is `VARCHAR(60)` and stores `vastra_org_id` (`VARCHAR(64)`). Fine for
  the short ids Vastra issues today; widen the column if that ever changes.

## Sample data
`npm run seed` drops and rebuilds the schema, then loads a demo warehouse so every screen has
something to show. Re-run it on a **development** database any time to get back to a clean
state — never on one with real organizations in it, because "clean" means their racks, stock
and history are gone.

| Table | Rows | Shape |
|-------|------|-------|
| `rack_master` | 100 | `R{1-5}-S{1-4}-B{1-5}`. Capacity varies by shelf (150/120/100/60) so the utilisation report isn't uniform. ~24 Vacant, ~58 partial, ~18 at 85%+ — one rack per dashboard bucket. |
| `item_location` | ~220 | 16-product textile catalogue with per-item colour/size runs. ~4,700 units. ~70% carry a `module_type` (Flow A), the rest are Manual. |
| `audit_log` | ~425 | add / update / move / remove over the last 21 days, weighted recent. Every one of the last 7 days has activity (fills the trend chart) and today has both adds and moves (fills the "today" tiles). `user_id` varies across 5 stub users. |
| `source_transaction` | 72 + ~50 | 18 per inbound module, ids like `PI-2026-0007` — searchable in the Add Item box. Plus 14 delivery challans (`DC-2026-0001`, 2–5 lines each, split over `#1`/`#2`… rows) built **from the stock that exists**, so a generated picklist actually resolves to racks. ~15% of lines over-ask on purpose so the shortage path has something to render. |

Invariants the seed respects, same as the API: `used = SUM(item qty)`, `used <= capacity`,
`status` derived from `used`, and no duplicate `(item, color, size)` within a rack.

```bash
npm run seed -- --empty   # schema + 100 empty racks + source txns only, no stock/history
```

## Data model

Every business table carries `fk_org_id → organization(id) ON DELETE CASCADE` and every query
filters on it. See [Scope](#scope-multi-tenant-one-organization-per-warehouse).

- `rack_master(id PK, fk_org_id, rack_no, shelf_no, bin_no, capacity, used, status)` — one row
  per **bin**, unique on `(fk_org_id, rack_no, shelf_no, bin_no)`. `id` is the identity and
  never changes; the display code `R001-S01-B01` is derived from the three integers at read
  time by `src/lib/rackCode.js` and is stored nowhere. `used` = SUM(item qty), `status` derived
  Vacant/Occupied, and a DB CHECK enforces `used <= capacity`.
- `item_location(id, fk_org_id, item, color, size, qty, fk_rack_id, module_id, module_type)` —
  many rows per bin (shared pool). `fk_rack_id` is the numeric `rack_master.id`, not the display
  code. `module_id` is the source document the stock arrived on (`SGR-1`, `JOB-92`) and
  `module_type` which module produced it; both are `NULL` for stock added by hand, which every
  screen renders as **Manual**. That pair is the provenance the warehouse searches by — see
  [Finding stock](#finding-stock-by-source-module).
- `audit_log(id, fk_org_id, entity_type, entity_id, action, before_json, after_json, user_id, created_at)` —
  append-only. `fk_org_id` is the tenancy filter; `user_id` is the *actor* and holds the
  logged-in organization's `vastra_org_id`. They carry the same value today only because Vastra
  gives us no per-person identity yet, which is why they are separate columns.
- `source_transaction(id, fk_org_id, module_type, …)`, PK `(fk_org_id, id)` — dev stub feeding
  Flow A (inbound) and Flow C (delivery challans). Its `module_type` ENUM includes the challan;
  `item_location`'s deliberately does not. `USE_VASTRA_MODULES=true` bypasses this table
  entirely and Vastra scopes the data by access token instead.
- `picklist(id, fk_org_id, dc_no, party, source, total_qty, short_qty, rack_updated, picked_qty, picked_at, user_id)`
  and `picklist_line(...)` — written on **generate**, closed on Update Rack. In
  `migrations/picklist.sql`, applied at boot, so a demo reseed never deletes real history.
- `rack_layout(fk_org_id PK, version, …)`, `rack_group(id, fk_org_id, seq, rack_from, rack_to, shelves, bins, bin_capacity)`
  and `rack_group_override(...)` — an organization's rack configuration as an ordered list of
  groups. `rack_master` remains the source of truth for stock; these exist to prefill the setup
  form and compute the next change's diff. `rack_layout`'s four grid columns are legacy,
  nullable and no longer written — `rack_group` replaced them.
- `organization(id, vastra_org_id UNIQUE, name, mobile, vastra_access_token, blocked)` —
  mirrored from Vastra on OTP login. `vastra_org_id` is the identity key; matching on mobile
  or name would be wrong, both change on Vastra's side.
- `session(token PK, org_id → organization)` — one active row per organization, which is what
  makes single-active-session and `blocked` genuinely revocable (a JWT could not be).
- `schema_migration(id PK, applied_at, note)` — the ledger that makes the one-time migrations
  in `src/schemaMigrations.js` run at most once. See [Migrations](#migrations).

## Finding stock by source module

The warehouse identifies stock by the document it arrived on, not just by product name, so
**module code is searchable on every screen** alongside the item name. The rules live in one
place — `client/src/lib/items.js` — so they can't drift page to page:

| Export | Does |
|--------|------|
| `MANUAL` | The `'Manual'` label for stock with no source document |
| `moduleCode(row)` | `row.module_id`, or `Manual` |
| `searchText(row)` | Everything a row is findable by: item, module id, module type, colour, size |
| `matches(text, query)` | Case-insensitive substring; an empty query matches everything |

What each page does with them:

| Page | Behaviour |
|------|-----------|
| Item Management | One line per **(module code, item)** pair, not per item — the same product arriving on two documents stays two lines, because that is how the floor tracks it. Manual stock sorts last. Search hits item name, module code or module type. |
| Rack List | Searches racks by the item names *and* module codes they contain, not only by rack id |
| Move Item | Variants show their module codes; search matches item, colour, size or code |
| Picklist | Item / colour / size autocomplete from stock in the racks, because a rack lookup matches them exactly. The generated list resolves each challan line to its racks |
| Reports | One search box filters every report, matching against all rendered columns |
| History | Putaway search hits item, colour, size, rack or module code; picklist search hits challan no, party, or `not updated` |
| Audit Log | Search covers action, entity, user and the before/after JSON |

## API
Everything except `/api/health` and `/api/auth/*` requires `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/send-otp` | Vastra texts an OTP (rate-limited per IP) |
| POST | `/api/auth/verify-otp` | verify → `{ token, org }` |
| POST | `/api/auth/logout` | kill the session + the stored Vastra token |
| GET | `/api/auth/me` | `{ id, name }` — restore a session on refresh |
| GET | `/api/dashboard` | every dashboard widget in one aggregation |
| GET | `/api/racks` | rack list |
| GET | `/api/racks/:id` | rack + items (report) |
| POST | `/api/racks` | create rack |
| GET | `/api/item-locations` | full stock listing (Inventory Report) |
| GET | `/api/item-locations/placements?item=&color=&size=` | racks already holding this item |
| POST | `/api/item-locations` | add item (Flow A/B) |
| PATCH | `/api/item-locations/:id` | update qty (0 = remove) |
| POST | `/api/moves` | atomic move |
| GET | `/api/source-transactions?moduleType=&q=&limit=` | Flow A feed, inbound modules only. No `q` → latest `limit` (default 10, max 100); with `q` → every match |
| POST | `/api/picklist/resolve` | `{ lines: [{ item, color, size, qty }], dcNo?, party?, picklistId? }` → where each line is stored. Changes no stock, but records a history entry. **The path in use today** |
| GET | `/api/picklist/challans?q=&limit=` | delivery challans from the module, grouped one entry per **document**. Awaiting the Vastra API |
| GET | `/api/picklist/:dcNo` | same picklist, built from the module instead of typed lines. Awaiting the Vastra API |
| POST | `/api/picklist/pick` | `{ picks: [{ itemLocationId, qty }], dcNo?, picklistId? }` — deducts the stock. Atomic. `dcNo` rides in the body because manual entry has none; `picklistId` closes the history entry |
| GET | `/api/picklist/:id/resolve` | re-resolve a stored picklist against current stock (History → Update). **409** if it already updated the racks |
| GET | `/api/picklist/:id/pdf` | the printable sheet, `application/pdf` (pdfkit, no headless browser) |
| GET | `/api/history/putaway?limit=` | stock added to racks, newest first (from `audit_log`) |
| GET | `/api/history/picklists?limit=` | every picklist generated, with `rack_updated` |
| GET | `/api/audit-log` | history |

## Verify (matches plan)

### Auth
```bash
# 1. unauthenticated request is rejected
curl -s -i localhost:4000/api/racks | head -1          # expect 401

# 2. health stays public
curl -s localhost:4000/api/health                       # expect {"ok":true,"db":"up"}

# 3. login
curl -s -X POST localhost:4000/api/auth/send-otp \
  -H 'content-type: application/json' \
  -d '{"country_code":"+91","mobile":"9XXXXXXXXX"}'     # staging echoes the OTP

curl -s -X POST localhost:4000/api/auth/verify-otp \
  -H 'content-type: application/json' \
  -d '{"country_code":"+91","mobile":"9XXXXXXXXX","otp":"1234"}'   # → { token, org }

# 4. authenticated request works
curl -s localhost:4000/api/racks -H 'Authorization: Bearer <token>'

# 5. audit rows now carry a real user_id, not 'system'
curl -s localhost:4000/api/audit-log -H 'Authorization: Bearer <token>' | head
```

Plus a plain-node self-check (no test framework) that stubs the Vastra HTTP layer:

```bash
node server/checkAuth.js
#   ✓ status:false envelope → VastraRejection carrying Vastra's code + message
#   ✓ first login creates the org, returns a session token, leaks no Vastra token
#   ✓ second login updates the existing row and rotates the Vastra token
#   ✓ second login deletes the first session token
```
It talks to the configured MySQL (creating and removing one throwaway org), and skips the DB
assertions with a notice if the database is unreachable.

### Expired Vastra token → forced re-login

```bash
node server/checkSessionRecovery.js
#   ✓ happy path: a valid token serves normalized rows to the panel
#   ✓ auth-shaped rejection → 401, Vastra token cleared, RMS session destroyed
#   ✓ follow-up request is 401, never the stuck 409
#   ✓ non-auth refusal → 502, token and session both left intact
```
Covers the failure that used to strand a user: Vastra stops accepting the stored token, RMS
clears it, and every later request answers 409 while the browser still believes it is logged in.
The session is now destroyed alongside the token and the status is **401**, which is the one the
client acts on — it drops the session and redirects to `/login`. Needs MySQL; skips without it.

### Source-module read path

```bash
node server/checkModules.js
#   ✓ request: rack-manager path, moduleType=1, search_string passed, raw token
#   ✓ JOB-92 flattens to 2 rows (design + material) in the client row shape
#   ✓ browse mode (no query) omits search_string entirely
#   ✓ page.next followed across 3 pages, rows accumulated
#   ✓ self-referential page.next terminates instead of looping
#   ✓ all four MODULE_TYPES map to their documented moduleType numbers
#   ✓ an unknown module name is rejected instead of silently querying moduleType=undefined
#   ✓ Delivery Challan queries moduleType=5 and is excluded from MODULE_TYPES
#   ✓ a multi-line DC flattens to one row per line, all sharing the challan no
```

No database and no api-key needed — it stubs the Vastra HTTP layer with the response bodies
verbatim from the published API doc (`…:3000/vastra-custom-api-doc/` → Rack Manager).

### Rack operations
All of these need a session token from step 3 above.

```bash
T=<token>

# capacity guard — expect HTTP 409
curl -s -X POST localhost:4000/api/item-locations \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"rackId":"R01-S01-B01","item":"Saree","qty":101}'

# add (Flow B) — expect rack used=5, status Occupied
curl -s -X POST localhost:4000/api/item-locations \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"rackId":"R01-S01-B01","item":"Kurti","color":"Red","size":"M","qty":5}'

# move — atomic; check both racks after
curl -s -X POST localhost:4000/api/moves \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"itemId":1,"toRackId":"R01-S01-B02","qty":2}'

curl -s localhost:4000/api/audit-log -H "Authorization: Bearer $T"   # who/when/before/after
```

### Picklist
Same token. Item/colour/size must match stock exactly — take them from
`curl -s localhost:4000/api/item-locations -H "Authorization: Bearer $T"`.

```bash
T=<token>

# a challan's items, typed in: one design across a size run. `suggested` fills
# the largest rack first; `shortage` is > 0 when more is asked for than the
# racks hold, and an item in no rack comes back with no placements at all
curl -s -X POST localhost:4000/api/picklist/resolve \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"lines":[
        {"item":"Anarkali Kurti","color":"Red","size":"S","qty":2},
        {"item":"Anarkali Kurti","color":"Red","size":"M","qty":3},
        {"item":"Anarkali Kurti","color":"Red","size":"L","qty":1}]}'

# guard — expect 400: no lines, or every line at qty 0

# generating changed nothing: re-read the racks and compare `used` — identical
curl -s localhost:4000/api/racks -H "Authorization: Bearer $T"

# over-pick guard — expect 400 AND no partial write (the valid pick in the same
# request must roll back too)
curl -s -X POST localhost:4000/api/picklist/pick \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"picks":[{"itemLocationId":16,"qty":99999},{"itemLocationId":155,"qty":5}]}'

# the real deduction — rows decrement (deleted at zero), both racks recalc,
# and the audit rows carry source:'picklist'
curl -s -X POST localhost:4000/api/picklist/pick \
  -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"picks":[{"itemLocationId":16,"qty":10}]}'
```

### Picklist history and PDF

```bash
T=<token>

# generating writes a history entry with rack_updated = false
curl -s "localhost:4000/api/history/picklists?limit=5" -H "Authorization: Bearer $T"

# regenerating with the same picklistId must UPDATE that entry, not add another;
# after a pick the entry is closed, so a further generate starts a new one

# after POST /api/picklist/pick with that picklistId, the same row reads
#   "rack_updated": true, "picked_qty": N, "picked_at": ...

# the printable sheet — expect application/pdf and a real PDF on disk
curl -s -D - -o /tmp/picklist.pdf "localhost:4000/api/picklist/1/pdf" \
  -H "Authorization: Bearer $T" | grep -i 'content-type\|content-disposition'
file /tmp/picklist.pdf            # → PDF document

# putaway history. `qty` is what was ADDED, which for a merge into existing
# stock differs from the row total in the audit row it came from
curl -s "localhost:4000/api/history/putaway?limit=5" -H "Authorization: Bearer $T"

# History → Update: re-resolve a stored picklist against stock as it is NOW.
# Move some of that stock first and `moved: true` plus `printedRacks` should
# appear on the affected lines. Re-running it after a pick → 409
curl -s "localhost:4000/api/picklist/1/resolve" -H "Authorization: Bearer $T"
```

Delivery Challan must never appear in the inbound feed — this should list four module types
and no challan:

```bash
curl -s "localhost:4000/api/source-transactions?limit=100" -H "Authorization: Bearer $T"
```

## Troubleshooting

**"Database unavailable" toast / no data on the deployed site.**
The API cannot reach MySQL. Ask it directly:

```bash
curl -s https://<your-app>.onrender.com/api/health
# {"ok":true,"db":"up"}                                        → DB fine, look elsewhere
# {"ok":false,"db":"down","code":"ENOTFOUND","host":"…"}       → see below
```

| `code` | Meaning | Fix |
|--------|---------|-----|
| `ENOTFOUND` | Hostname doesn't resolve — the DB server no longer exists, or `DB_HOST` is wrong. Managed free tiers (Aiven, Railway, PlanetScale) delete expired instances and remove their DNS record. | Provision a new DB, update the host env vars, then seed it — see the ⚠️ note under this table before you do |
| `ECONNREFUSED` | Host resolves, nothing listening | Start MySQL / check `DB_PORT` |
| `ER_ACCESS_DENIED_ERROR` | Bad credentials | Check `DB_USER` / `DB_PASSWORD` |
| `ER_BAD_DB_ERROR` | Database missing | `npm run seed` — see the ⚠️ note under this table first |
| `HANDSHAKE_SSL_ERROR` | TLS handshake failed. Managed hosts refuse plaintext connections | Set `DB_SSL=true`, and `DB_CA` to the provider's CA cert for full verification |
| `ETIMEDOUT` | Host never answered — firewall or IP allow-list | Allow the Render outbound IPs in the DB provider's dashboard |

> ⚠️ **Two of those fixes involve `npm run seed`, which erases all racks, stock and history.**
> That is fine on a fresh or development database and catastrophic on a live one. If the
> database already holds real organizations, do **not** seed it — you almost certainly do not
> need to. Every migration is `CREATE TABLE IF NOT EXISTS` and runs at boot, so **restarting
> the server creates any missing table on its own, non-destructively.** Seeding is only for
> loading demo data into a throwaway database.
>
> The one thing a restart cannot do is create the *database* itself. If the error is
> `ER_BAD_DB_ERROR`, run `CREATE DATABASE rms CHARACTER SET utf8mb4;` by hand and restart —
> that is the whole fix, with nothing dropped.
>
> You are most likely reading this row while something is already broken, which is exactly
> when the wrong command gets run. Check which database `DB_NAME` / `DB_HOST` point at before
> you type anything.

**"Unknown column 'fk_org_id' in 'where clause'" on a deployed site.**
`/api/health` says `db: up`, but every data screen fails. The database was built before
organization scoping existed, so its tables are the old shape. The standing migrations cannot
repair it — they are all `CREATE TABLE IF NOT EXISTS`, which does nothing to a table that
already exists — and the one-time migration that *can* (`src/schemaMigrations.js`) refuses
while those tables hold rows, because rack identity changed from a text code (`R05-S02-B04`)
to a numeric id and there is no in-place conversion. The refusal is printed at startup:

```
  ✗ Could not bring the database up to date: Refusing to rebuild core tables:
    they still hold rows (rack_master=3, item_location=2, …)
```

If those rows are expendable, discard them deliberately:

1. Render dashboard → Environment → add `ALLOW_DESTRUCTIVE_MIGRATION` = `true`.
2. Redeploy. The log names every row it drops, then rebuilds the tables in the current shape.
3. **Delete the variable again** and redeploy.

Step 3 is hygiene, not safety: the `schema_migration` ledger records the migration, so it can
never run twice even if the variable is left set. Leaving it set would, however, arm the same
override for any *future* destructive migration.

If the rows must be kept, do not set the variable — write a backfill migration that stamps
each row with its owning org and maps old rack codes onto `(rack_no, shelf_no, bin_no)`.

Confirm whether a hostname is really gone with `dig +short @8.8.8.8 <host>` — empty output
means NXDOMAIN, i.e. the instance is deleted, not merely down.

### Repointing at a new managed database
1. Create a MySQL 8 instance (CHECK constraints are required, so MySQL 8+ or MariaDB 10.2+).
2. In the Render dashboard → Environment, set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`,
   `DB_NAME`, plus `DB_SSL=true` (and `DB_CA` with the provider's CA cert for full verification).
3. Seed the new database from your machine, pointing at it:
   ```bash
   DB_HOST=… DB_PORT=… DB_USER=… DB_PASSWORD=… DB_NAME=… DB_SSL=true npm run seed --prefix server
   ```
   Note `seed.js` **drops and recreates** all four tables — never run it against live data.
4. Redeploy and re-check `/api/health`.

## Deferred

**Switching Flow A to live Vastra data.** The integration itself is **done** — the endpoint,
the five module numbers (four inbound plus the Delivery Challan the picklist reads), flattening
and paging are all implemented and covered by
`checkModules.js` (see [Source modules](#source-modules-flow-a)). What's left is
operational: `USE_VASTRA_MODULES` still defaults to `false` because the whole demo dataset
lives in the `source_transaction` stub, and the live read needs a production `VASTRA_API_KEY`
and a logged-in org's token. Flip it to `true` once you're pointing at real data — the
frontend needs no changes.

**Roles.** Login answers "which Vastra organization", not "what may they do" — every
authenticated organization has full access *to its own data*. Tenancy is enforced (see
[Scope](#scope-multi-tenant-one-organization-per-warehouse)); per-person permissions within an
organization are not, because Vastra gives us no per-person identity yet. Also see
[Before production](#before-production) on CORS.
