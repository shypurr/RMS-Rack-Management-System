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