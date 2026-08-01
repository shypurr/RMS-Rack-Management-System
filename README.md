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

## Run

```bash
# 1. Backend
cd server
npm install
npm run seed        # creates DB `rms`, applies schema, loads the full demo dataset
npm run dev         # http://localhost:4000

# 2. Frontend (new terminal)
cd client
npm install
npm run dev         # http://localhost:5173  (proxies /api → :4000)
```

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

Failure handling is in `routes/sourceTransactions.js`: no stored Vastra token → **409**; a
token Vastra rejects → **502** and the stored token is cleared so our state stays honest.

### Auth tables and migrations
`migrations/schema.sql` **drops and recreates** its four tables and `npm run seed` applies
it — so the auth tables deliberately live in `migrations/auth.sql` instead, all
`CREATE TABLE IF NOT EXISTS`, applied at boot from `src/index.js`. A demo reseed therefore
never deletes a login.

### Scope: one warehouse per deployment
`rack_master.rack_id` is a global primary key and `item_location` / `audit_log` /
`source_transaction` have **no organization column**. Confirmed intentional: every Vastra org
that logs in is staff of the *same* warehouse, so login is purely "who are you" for the audit
trail and the Vastra API token. **Multi-tenancy is not implemented** — if two unrelated orgs
ever need to share one deployment, every business table needs an `org_id`, `rack_master`'s PK
becomes `(org_id, rack_id)`, and every query in `rackService.js`, `dashboardService.js` and
the route files needs a tenancy filter. That is a separate migration.

### Before production
- `cors()` in `src/app.js` is wide open. The session token travels in an `Authorization`
  header rather than a cookie, so this is not a CSRF hole, but lock it to a known origin.
- `audit_log.user_id` is `VARCHAR(60)` and stores `vastra_org_id` (`VARCHAR(64)`). Fine for
  the short ids Vastra issues today; widen the column if that ever changes.

## Sample data
`npm run seed` drops and rebuilds the schema, then loads a demo warehouse so every screen has
something to show. It is idempotent — re-run it any time to get back to a clean state.

| Table | Rows | Shape |
|-------|------|-------|
| `rack_master` | 100 | `R{1-5}-S{1-4}-B{1-5}`. Capacity varies by shelf (150/120/100/60) so the utilisation report isn't uniform. ~24 Vacant, ~58 partial, ~18 at 85%+ — one rack per dashboard bucket. |
| `item_location` | ~220 | 16-product textile catalogue with per-item colour/size runs. ~4,700 units. ~70% carry a `module_type` (Flow A), the rest are Manual. |
| `audit_log` | ~425 | add / update / move / remove over the last 21 days, weighted recent. Every one of the last 7 days has activity (fills the trend chart) and today has both adds and moves (fills the "today" tiles). `user_id` varies across 5 stub users. |
| `source_transaction` | 72 | 18 per module, ids like `PI-2026-0007` — searchable in the Add Item box. |

Invariants the seed respects, same as the API: `used = SUM(item qty)`, `used <= capacity`,
`status` derived from `used`, and no duplicate `(item, color, size)` within a rack.

```bash
npm run seed -- --empty   # schema + 100 empty racks + source txns only, no stock/history
```

## Data model
- `rack_master(rack_id PK, capacity, used, status)` — `used` = SUM(item qty), `status` derived
  Vacant/Occupied. DB CHECK enforces `used <= capacity`.
- `item_location(id, item, color, size, qty, fk_rack_id, module_id, module_type)` — many rows per
  rack (shared pool). `module_id` is the source document code the stock arrived on (`SGR-1`,
  `JOB-92`) and `module_type` which module produced it; both are `NULL` for stock added by
  hand, which every screen renders as **Manual**. This pair is the provenance the warehouse
  searches by — see [Finding stock](#finding-stock-by-source-module).
- `audit_log(entity_type, entity_id, action, before_json, after_json, user_id, created_at)` —
  `user_id` is the logged-in org's `vastra_org_id`.
- `source_transaction(...)` — stub feeding Flow A until real Vastra integration.
- `organization(id, vastra_org_id UNIQUE, name, mobile, vastra_access_token, blocked)` —
  mirrored from Vastra on OTP login. `vastra_org_id` is the identity key; matching on mobile
  or name would be wrong, both change.
- `session(token PK, org_id → organization)` — one active row per org.

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
| Reports | One search box filters every report, matching against all rendered columns |
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
| GET | `/api/source-transactions?moduleType=&q=&limit=` | Flow A feed. No `q` → latest `limit` (default 10, max 100); with `q` → every match |
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
| `ENOTFOUND` | Hostname doesn't resolve — the DB server no longer exists, or `DB_HOST` is wrong. Managed free tiers (Aiven, Railway, PlanetScale) delete expired instances and remove their DNS record. | Provision a new DB, update the host env vars, re-run the seed |
| `ECONNREFUSED` | Host resolves, nothing listening | Start MySQL / check `DB_PORT` |
| `ER_ACCESS_DENIED_ERROR` | Bad credentials | Check `DB_USER` / `DB_PASSWORD` |
| `ER_BAD_DB_ERROR` | Database missing | `npm run seed` |

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
the four module numbers, flattening and paging are all implemented and covered by
`checkModules.js` (see [Source modules](#source-modules-flow-a)). What's left is
operational: `USE_VASTRA_MODULES` still defaults to `false` because the whole demo dataset
lives in the `source_transaction` stub, and the live read needs a production `VASTRA_API_KEY`
and a logged-in org's token. Flip it to `true` once you're pointing at real data — the
frontend needs no changes.

**Roles.** Login answers "which Vastra org", not "what may they do" — every authenticated org
has full access. Also see [Scope](#scope-one-warehouse-per-deployment) on multi-tenancy and
[Before production](#before-production) on CORS.
