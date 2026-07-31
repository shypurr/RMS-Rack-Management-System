# RMS — Rack Management System

Rack Management module for Vastra (textile WMS). React + Vite frontend, Node/Express API,
MySQL. Implements the SRS: add / update / move items across rack bins with a shared-capacity
guard, atomic moves, and a full audit trail.

- `wms/` — design reference from the senior dev (static mockup). **Not run, not modified.**
- `server/` — Express + MySQL API.
- `client/` — Vite + React app (reproduces the `wms/` look).
- `docs/` — SRS.

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
| `USE_VASTRA_MODULES` | `false` | `true` reads Flow A from the real Vastra modules instead of the `source_transaction` stub. Leave off until the endpoints land — see [Deferred](#deferred). |

`server/src/vastraClient.js` is the only module that talks to Vastra. Two notes on that API:
every endpoint answers **HTTP 200** and puts success/failure in the body (read `status`, not
the HTTP code), and the `authorization` header takes the **raw** access token — no `Bearer`
prefix.

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
  rack (shared pool).
- `audit_log(entity_type, entity_id, action, before_json, after_json, user_id, created_at)` —
  `user_id` is the logged-in org's `vastra_org_id`.
- `source_transaction(...)` — stub feeding Flow A until real Vastra integration.
- `organization(id, vastra_org_id UNIQUE, name, mobile, vastra_access_token, blocked)` —
  mirrored from Vastra on OTP login. `vastra_org_id` is the identity key; matching on mobile
  or name would be wrong, both change.
- `session(token PK, org_id → organization)` — one active row per org.

## API
Everything except `/api/health` and `/api/auth/*` requires `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/send-otp` | Vastra texts an OTP (rate-limited per IP) |
| POST | `/api/auth/verify-otp` | verify → `{ token, org }` |
| POST | `/api/auth/logout` | kill the session + the stored Vastra token |
| GET | `/api/auth/me` | `{ id, name }` — restore a session on refresh |
| GET | `/api/racks` | rack list |
| GET | `/api/racks/:id` | rack + items (report) |
| POST | `/api/racks` | create rack |
| POST | `/api/item-locations` | add item (Flow A/B) |
| PATCH | `/api/item-locations/:id` | update qty (0 = remove) |
| POST | `/api/moves` | atomic move |
| GET | `/api/source-transactions?moduleType=` | Flow A feed |
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

**Real Vastra source-module data** (replaces the `source_transaction` stub). Everything is
wired except four strings: the endpoint paths for `Purchase Inward`, `Job Slip`,
`Pack Design` and `Sales Return` are not published anywhere and have **not been guessed** —
the only confirmed authenticated Vastra path so far is `GET /design/get-design-ids`. Ask the
Vastra team, then fill in `MODULE_PATHS` in `src/vastraClient.js` (the `TODO(vastra-team)`
marker), confirm the response field names against `normalize()` right below it, and flip
`USE_VASTRA_MODULES=true`. The route already handles the rest: no stored token → 409, an
expired token → 502 plus the stored token is cleared, and responses are normalized to the
same `{ id, module_type, item, color, size, qty }` shape the stub returns, so the frontend
needs no changes either way.

**Roles.** Login answers "which Vastra org", not "what may they do" — every authenticated org
has full access. Also see [Scope](#scope-one-warehouse-per-deployment) on multi-tenancy and
[Before production](#before-production) on CORS.
