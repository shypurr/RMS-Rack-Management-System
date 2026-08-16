# 02 — The File Map

[← Big Picture](01-the-big-picture.md) · [Next: The Database →](03-the-database.md)

---

> **This is the most important file in the guide for your stated goal.**
> Someone asks "where is the code that does X?" — you look it up here, open the file, and explain it.
>
> Bookmark this page.

---

## The whole tree at a glance

```
RMS-Rack-Management-System/
│
├── package.json                    ← top-level shortcuts (build, start, seed)
├── README.md                       ← official project documentation
├── ck/                             ← this guide
│
├── client/                         ═══ THE BROWSER PROGRAM ═══
│   ├── package.json                ← React, Vite, Chart.js, router
│   ├── vite.config.js              ← dev server port + /api proxy
│   ├── index.html                  ← the single HTML page everything renders into
│   └── src/
│       ├── main.jsx                ← ⭐ entry point: routes + login gate
│       ├── api/
│       │   └── client.js           ← ⭐ EVERY server call in the app
│       ├── components/
│       │   ├── Layout.jsx          ← sidebar, topbar, logout, org name
│       │   ├── Toast.jsx           ← the popup notifications
│       │   └── RackCard.jsx        ← one coloured rack tile
│       ├── lib/
│       │   ├── rack.js             ← occupancy colours, rack sorting, module list
│       │   ├── items.js            ← search helpers, "Manual" label
│       │   ├── charts.js           ← Chart.js setup + 7-day trend builder
│       │   └── useTheme.js         ← light/dark mode
│       ├── pages/                  ← one file per screen (10 of them)
│       │   ├── Login.jsx
│       │   ├── Dashboard.jsx
│       │   ├── RackList.jsx
│       │   ├── ItemManagement.jsx
│       │   ├── AddItem.jsx
│       │   ├── MoveItem.jsx
│       │   ├── Picklist.jsx        ← biggest file in the project (655 lines)
│       │   ├── History.jsx
│       │   ├── Reports.jsx
│       │   ├── RackReport.jsx
│       │   └── AuditLog.jsx
│       └── styles/
│           ├── style.css           ← all the visual design (798 lines)
│           └── responsive.css      ← phone/tablet/print adjustments
│
└── server/                         ═══ THE API PROGRAM ═══
    ├── package.json                ← Express, mysql2, pdfkit, dotenv, cors
    ├── .env                        ← 🔐 REAL secrets (never committed to git)
    ├── .env.example                ← the template, safe to share
    ├── seed.js                     ← builds the demo warehouse
    ├── makeChallans.js             ← adds sample challans to a live database
    ├── challanFixtures.js          ← shared challan generator
    ├── checkAuth.js                ← self-test for login
    ├── checkModules.js             ← self-test for the Vastra reader
    ├── migrations/
    │   ├── schema.sql              ← 4 tables, DROPPED and rebuilt on seed
    │   ├── auth.sql                ← 2 tables, survives a reseed
    │   └── picklist.sql            ← 2 tables, survives a reseed
    └── src/
        ├── index.js                ← ⭐ the thing you actually run
        ├── app.js                  ← ⭐ wires routes together, error handler
        ├── db.js                   ← MySQL pool, transactions, migrations
        ├── vastraClient.js         ← ⭐ the ONLY file that calls Vastra
        ├── middleware/
        │   └── requireAuth.js      ← 🔒 the security guard
        ├── routes/                 ← thin HTTP handlers (9 files)
        │   ├── auth.js             ← login / logout / me
        │   ├── racks.js
        │   ├── itemLocations.js
        │   ├── moves.js
        │   ├── sourceTransactions.js
        │   ├── picklist.js
        │   ├── history.js
        │   ├── audit.js
        │   └── dashboard.js
        └── services/               ← the real business rules (6 files)
            ├── rackService.js      ← ⭐ all stock movement logic
            ├── sourceModules.js    ← Vastra-vs-stub switch
            ├── picklistStore.js    ← picklist history save/load
            ├── picklistPdf.js      ← PDF drawing
            ├── dashboardService.js ← the big aggregation query
            └── audit.js            ← writes one audit row
```

---

## "Where is the code that…" — the lookup table

### Authentication & sessions

| Question | File |
|----------|------|
| Draws the login screen with mobile + OTP boxes | [`client/src/pages/Login.jsx`](../client/src/pages/Login.jsx) |
| Sends the OTP and verifies it | [`server/src/routes/auth.js`](../server/src/routes/auth.js) |
| Actually calls Vastra to send the SMS | [`server/src/vastraClient.js:63`](../server/src/vastraClient.js#L63) `sendLoginOtp()` |
| Creates the session token | [`server/src/routes/auth.js:125`](../server/src/routes/auth.js#L125) |
| Checks the token on every request | [`server/src/middleware/requireAuth.js`](../server/src/middleware/requireAuth.js) |
| Stores the token in the browser | [`client/src/api/client.js:3-6`](../client/src/api/client.js#L3-L6) |
| Redirects to /login when the session dies | [`client/src/api/client.js:21-24`](../client/src/api/client.js#L21-L24) |
| Blocks pages when not logged in | [`client/src/main.jsx:25`](../client/src/main.jsx#L25) `RequireAuth` |
| Logs out | [`client/src/components/Layout.jsx:38`](../client/src/components/Layout.jsx#L38) + [`server/src/routes/auth.js:139`](../server/src/routes/auth.js#L139) |
| Rate-limits OTP requests | [`server/src/routes/auth.js:25-41`](../server/src/routes/auth.js#L25-L41) |
| The `organization` and `session` tables | [`server/migrations/auth.sql`](../server/migrations/auth.sql) |

### Racks

| Question | File |
|----------|------|
| The rack grid screen | [`client/src/pages/RackList.jsx`](../client/src/pages/RackList.jsx) |
| One coloured rack tile | [`client/src/components/RackCard.jsx`](../client/src/components/RackCard.jsx) |
| The colour thresholds (green/yellow/red) | [`client/src/lib/rack.js:3-17`](../client/src/lib/rack.js#L3-L17) |
| The popup showing what's inside a rack | [`client/src/pages/RackList.jsx:138`](../client/src/pages/RackList.jsx#L138) `RackModal` |
| Listing all racks (server) | [`server/src/services/rackService.js:51`](../server/src/services/rackService.js#L51) |
| One rack plus its items (server) | [`server/src/services/rackService.js:59`](../server/src/services/rackService.js#L59) |
| Recalculating `used` and Vacant/Occupied | [`server/src/services/rackService.js:29`](../server/src/services/rackService.js#L29) `recalcRack()` |
| Refusing to overfill a rack | [`server/src/services/rackService.js:41`](../server/src/services/rackService.js#L41) `assertCapacity()` |
| The rack-by-rack printable report | [`client/src/pages/RackReport.jsx`](../client/src/pages/RackReport.jsx) |
| The `rack_master` table | [`server/migrations/schema.sql:14-21`](../server/migrations/schema.sql#L14-L21) |

### Stock (adding, moving, editing)

| Question | File |
|----------|------|
| The Putaway screen | [`client/src/pages/AddItem.jsx`](../client/src/pages/AddItem.jsx) |
| The searchable transaction dropdown | [`client/src/pages/AddItem.jsx:200`](../client/src/pages/AddItem.jsx#L200) `TxnCombobox` |
| Adding stock to a rack (the rules) | [`server/src/services/rackService.js:91`](../server/src/services/rackService.js#L91) `addItem()` |
| Merging with an identical existing row | [`server/src/services/rackService.js:102-113`](../server/src/services/rackService.js#L102-L113) |
| The Move Item screen | [`client/src/pages/MoveItem.jsx`](../client/src/pages/MoveItem.jsx) |
| Moving stock between racks (the rules) | [`server/src/services/rackService.js:232`](../server/src/services/rackService.js#L232) `moveItem()` |
| Changing / removing a quantity | [`server/src/services/rackService.js:130`](../server/src/services/rackService.js#L130) `updateItemQty()` |
| Finding which racks hold a variant | [`server/src/services/rackService.js:76`](../server/src/services/rackService.js#L76) `findPlacements()` |
| The full stock listing screen | [`client/src/pages/ItemManagement.jsx`](../client/src/pages/ItemManagement.jsx) |
| The `item_location` table | [`server/migrations/schema.sql:24-39`](../server/migrations/schema.sql#L24-L39) |

### Picklist (Flow C)

| Question | File |
|----------|------|
| The Picklist screen | [`client/src/pages/Picklist.jsx`](../client/src/pages/Picklist.jsx) |
| The size-run entry grid | [`client/src/pages/Picklist.jsx:336-366`](../client/src/pages/Picklist.jsx#L336-L366) |
| The item picker with substring matching | [`client/src/pages/Picklist.jsx:537`](../client/src/pages/Picklist.jsx#L537) `ItemCombobox` |
| The challan picker (module tab) | [`client/src/pages/Picklist.jsx:571`](../client/src/pages/Picklist.jsx#L571) `DcCombobox` |
| Turning challan lines into rack suggestions | [`server/src/routes/picklist.js:62`](../server/src/routes/picklist.js#L62) `resolveLines()` |
| The largest-rack-first allocation | [`server/src/routes/picklist.js:24`](../server/src/routes/picklist.js#L24) `allocate()` |
| Deducting the stock | [`server/src/services/rackService.js:161`](../server/src/services/rackService.js#L161) `pickItems()` |
| Saving picklist history | [`server/src/services/picklistStore.js:15`](../server/src/services/picklistStore.js#L15) `savePicklist()` |
| Marking a picklist as acted-on | [`server/src/services/picklistStore.js:61`](../server/src/services/picklistStore.js#L61) `markRackUpdated()` |
| Drawing the printable PDF | [`server/src/services/picklistPdf.js`](../server/src/services/picklistPdf.js) |
| Re-checking a stored picklist against today's stock | [`server/src/routes/picklist.js:131`](../server/src/routes/picklist.js#L131) |
| The `picklist` / `picklist_line` tables | [`server/migrations/picklist.sql`](../server/migrations/picklist.sql) |

### History, audit, reports, dashboard

| Question | File |
|----------|------|
| The History screen (2 tabs) | [`client/src/pages/History.jsx`](../client/src/pages/History.jsx) |
| The "Update racks" popup in History | [`client/src/pages/History.jsx:200`](../client/src/pages/History.jsx#L200) `UpdateRackModal` |
| Putaway history query | [`server/src/routes/history.js:17`](../server/src/routes/history.js#L17) |
| Picklist history query | [`server/src/services/picklistStore.js:69`](../server/src/services/picklistStore.js#L69) `listPicklists()` |
| The raw Audit Log screen | [`client/src/pages/AuditLog.jsx`](../client/src/pages/AuditLog.jsx) |
| Writing one audit row | [`server/src/services/audit.js`](../server/src/services/audit.js) |
| The Reports screen with CSV export | [`client/src/pages/Reports.jsx`](../client/src/pages/Reports.jsx) |
| The CSV export logic | [`client/src/pages/Reports.jsx:63`](../client/src/pages/Reports.jsx#L63) `exportCSV()` |
| The Dashboard screen | [`client/src/pages/Dashboard.jsx`](../client/src/pages/Dashboard.jsx) |
| All the dashboard numbers (one big query) | [`server/src/services/dashboardService.js`](../server/src/services/dashboardService.js) |
| Chart.js setup + 7-day trend | [`client/src/lib/charts.js`](../client/src/lib/charts.js) |
| The `audit_log` table | [`server/migrations/schema.sql:42-52`](../server/migrations/schema.sql#L42-L52) |

### Vastra integration

| Question | File |
|----------|------|
| **Every** call to Vastra | [`server/src/vastraClient.js`](../server/src/vastraClient.js) |
| The module name → number mapping | [`server/src/vastraClient.js:102-108`](../server/src/vastraClient.js#L102-L108) |
| Flattening a Vastra document into rows | [`server/src/vastraClient.js:117`](../server/src/vastraClient.js#L117) `flatten()` |
| Following pagination | [`server/src/vastraClient.js:156-164`](../server/src/vastraClient.js#L156-L164) |
| Switching between live Vastra and fake data | [`server/src/services/sourceModules.js`](../server/src/services/sourceModules.js) |
| Vastra URLs and keys | [`server/.env`](../server/.env) (real) / [`server/.env.example`](../server/.env.example) (template) |

### Infrastructure & plumbing

| Question | File |
|----------|------|
| The thing you actually run | [`server/src/index.js`](../server/src/index.js) |
| Which URLs need a login | [`server/src/app.js:39-49`](../server/src/app.js#L39-L49) |
| Turning errors into HTTP status codes | [`server/src/app.js:64-77`](../server/src/app.js#L64-L77) |
| The database connection pool | [`server/src/db.js:6-17`](../server/src/db.js#L6-L17) |
| The transaction helper | [`server/src/db.js:80`](../server/src/db.js#L80) `withTransaction()` |
| Applying auth + picklist migrations at boot | [`server/src/db.js:70`](../server/src/db.js#L70) `applyAuthSchema()` |
| Serving the built React app in production | [`server/src/app.js:54-61`](../server/src/app.js#L54-L61) |
| The dev proxy from 5173 → 4000 | [`client/vite.config.js`](../client/vite.config.js) |
| All the CSS | [`client/src/styles/style.css`](../client/src/styles/style.css) |
| Dark mode | [`client/src/lib/useTheme.js`](../client/src/lib/useTheme.js) + [`style.css:33`](../client/src/styles/style.css#L33) |

### Demo data & tests

| Question | File |
|----------|------|
| Building the whole demo warehouse | [`server/seed.js`](../server/seed.js) |
| The 16-item clothing catalogue | [`server/seed.js:18-35`](../server/seed.js#L18-L35) |
| Generating the 100 racks | [`server/seed.js:94`](../server/seed.js#L94) `buildRacks()` |
| Generating fake sample challans | [`server/challanFixtures.js`](../server/challanFixtures.js) |
| Adding challans without wiping the database | [`server/makeChallans.js`](../server/makeChallans.js) |
| Testing the login path | [`server/checkAuth.js`](../server/checkAuth.js) |
| Testing the Vastra reader | [`server/checkModules.js`](../server/checkModules.js) |

---

## Every server file, explained in one paragraph

### `server/src/index.js` — 38 lines
The **starting pistol**. Runs `pingDb()` to check the database is reachable, prints a genuinely helpful error if it isn't (it decodes error codes like `ENOTFOUND` into English), applies the standing migrations, then starts listening on port 4000. Notice at [line 25](../server/src/index.js#L25) it **starts anyway** even when the database is down — so `/api/health` still works and you can diagnose the problem.

### `server/src/app.js` — 80 lines
The **wiring diagram**. Creates the Express application, mounts every route file at its URL prefix, and decides which ones need `requireAuth`. Also holds the `/api/health` endpoint and the central error handler at the bottom. If you want to know what URLs exist, read this file top to bottom.

### `server/src/db.js` — 93 lines
The **database plumbing**. Creates the connection pool, defines `withTransaction()` (the all-or-nothing helper every write uses), lists the driver error codes that mean "database unreachable" so they can be handled separately, and applies `auth.sql` + `picklist.sql` at boot.

### `server/src/vastraClient.js` — 166 lines
The **embassy**. The only file allowed to talk to Vastra. Contains the generic `call()` function, the two login functions, the module-number map, and `flatten()` which converts Vastra's nested document format into the flat rows the rest of the app expects. Its header comment lists the two Vastra quirks that will bite you (always HTTP 200; raw token, no "Bearer").

### `server/src/middleware/requireAuth.js` — 28 lines
The **security guard**. Pulls the token out of the `Authorization` header, looks it up with one SQL JOIN, rejects if missing or blocked, and attaches `req.org` for every route downstream. Small file, enormous responsibility.

### The 9 route files
Each maps one URL prefix to handlers. All follow the identical shape: `try { ...; res.json(x) } catch (err) { next(err) }`. They should stay thin — if a route file grows past ~60 lines of logic, that logic belongs in a service.

| Route file | Mounted at | Lines |
|---|---|---|
| `auth.js` | `/api/auth` | 154 |
| `picklist.js` | `/api/picklist` | 205 |
| `history.js` | `/api/history` | 61 |
| `itemLocations.js` | `/api/item-locations` | 48 |
| `racks.js` | `/api/racks` | 39 |
| `audit.js` | `/api/audit-log` | 26 |
| `sourceTransactions.js` | `/api/source-transactions` | 19 |
| `moves.js` | `/api/moves` | 17 |
| `dashboard.js` | `/api/dashboard` | 13 |

### `server/src/services/rackService.js` — 280 lines ⭐
The **heart of the application**. Everything that changes stock lives here: `addItem`, `updateItemQty`, `pickItems`, `moveItem`, plus the read helpers `listRacks`, `getRackWithItems`, `findPlacements`. Also defines `HttpError`, the small class that lets a service say "this should be a 404" without knowing anything about HTTP. If you only ever read one server file, read this one.

### `server/src/services/sourceModules.js` — 102 lines
The **switch**. Answers "give me transaction rows for a module" from *either* live Vastra *or* the local fake `source_transaction` table, depending on environment flags. Also contains the careful logic that decides whether a Vastra rejection means "your session died" (clear the token) or "I won't serve that module" (keep the token) — see [lines 44-62](../server/src/services/sourceModules.js#L44-L62).

### `server/src/services/picklistStore.js` — 96 lines
Saving, updating and reading **picklist history**. The clever bit is that regenerating a picklist *updates the same row* rather than creating a new one, so History shows one entry per picklist instead of one per button click.

### `server/src/services/picklistPdf.js` — 150 lines
Draws the **printable sheet** with pdfkit — headers, table grid, page breaks, shortage warnings. Contains a great comment at [line 38](../server/src/services/picklistPdf.js#L38) about why every dash in the file is a plain ASCII hyphen (pdfkit silently *deletes* characters it can't encode).

### `server/src/services/dashboardService.js` — 83 lines
**Six SQL queries in one function**, returning everything the dashboard needs in a single HTTP call. Every number is wrapped in `Number()` because MySQL returns `SUM()` and `COUNT()` as strings.

### `server/src/services/audit.js` — 16 lines
One function, `writeAudit()`. Inserts a row into `audit_log`. Takes a *connection* rather than the pool, so it always runs inside the caller's transaction — if the change rolls back, the audit entry rolls back with it.

---

## Every client file, explained in one paragraph

### `client/src/main.jsx` — 54 lines
The **entry point**. Defines every URL the app has and which page component renders it. Wraps everything in `ToastProvider` (so any page can pop a notification) and `BrowserRouter`. The `RequireAuth` component here is the client-side login gate.

### `client/src/api/client.js` — 95 lines ⭐
**The only file in the browser that talks to the server.** Every page imports `api` from here. It holds the token helpers, one shared `request()` wrapper (which attaches the auth header and handles 401 globally), and then a flat list of named methods: `api.listRacks()`, `api.addItem()`, `api.pickItems()`, etc. **If you want a list of everything the browser can ask the server, read this file.**

### `client/src/components/Layout.jsx` — 113 lines
The **frame** around every logged-in page: sidebar navigation, org name, avatar, dark-mode toggle, fullscreen button, logout. The `NAV` array at the top is where you add a new sidebar link. Renders `<Outlet />`, which is react-router's "put the current page here" marker.

### `client/src/components/Toast.jsx` — 37 lines
The **notification system**. A React Context providing a `toast(message, type)` function to every component. Notifications auto-dismiss after 4 seconds.

### `client/src/components/RackCard.jsx` — 17 lines
One rack tile: name, used/capacity, coloured progress bar.

### `client/src/lib/rack.js` — 36 lines
Shared rack rules: `occupancyBucket()` (the 4-way colour), `pct()`, `pctColorClass()`, the client's copy of `MODULE_TYPES`, and `sortByEmptiness()` which orders racks for placement (empty first, then most free space).

### `client/src/lib/items.js` — 24 lines
Shared search rules. `searchText(row)` builds the string a stock row can be found by; `matches(text, query)` does the comparison. Used by RackList, ItemManagement, MoveItem, History, Reports and AuditLog — **one definition of "searchable", six screens**.

### `client/src/lib/charts.js` — 32 lines
Registers the Chart.js pieces once, sets default colours that work in both light and dark mode, re-exports the chart components, and provides `sevenDayTrend()` which fills gaps in sparse data so the graph always has exactly 7 points.

### `client/src/lib/useTheme.js` — 14 lines
Light/dark mode. Stores the choice in `localStorage` and sets `data-theme` on the `<html>` element; the CSS does the rest.

### The 11 page files

| Page | Route | Lines | What it does |
|------|-------|-------|--------------|
| `Login.jsx` | `/login` | 103 | Two-step mobile → OTP form |
| `Dashboard.jsx` | `/` | 164 | 6 stat cards, 3 charts, recent activity |
| `RackList.jsx` | `/racks` | 222 | Grid of 100 rack tiles + detail modal with inline qty editing |
| `ItemManagement.jsx` | `/items` | 182 | Stock grouped by source document + item |
| `AddItem.jsx` | `/add` | 281 | Putaway — Flows A and B |
| `MoveItem.jsx` | `/move` | 235 | Three-step move wizard |
| `Picklist.jsx` | `/picklist` | 655 | Flow C — the big one |
| `History.jsx` | `/history` | 331 | Putaway + picklist history, with the re-pick modal |
| `Reports.jsx` | `/reports` | 170 | 4 report types + charts + CSV export |
| `RackReport.jsx` | `/report` | 92 | One rack, printable |
| `AuditLog.jsx` | `/audit` | 79 | Raw change log, searchable |

---

## Naming conventions you'll notice

| Pattern | Meaning |
|---------|---------|
| `*.jsx` | A React file containing screen markup |
| `*.js` in `client/` | Plain logic, no markup |
| `PascalCase.jsx` | A React component (`AddItem.jsx`, `Layout.jsx`) |
| `camelCase.js` | Everything else (`rackService.js`, `useTheme.js`) |
| `use*` | A React hook (`useTheme`, `useState`, `useEffect`) |
| `snake_case` | Comes from the database (`rack_id`, `module_type`, `fk_rack_id`) |
| `fk_*` | A foreign key — a pointer to another table's row |
| `check*.js` | A self-test you run by hand |
| `*Service.js` / `services/*` | Business logic, no HTTP |

> **A genuinely useful tell:** if a variable is `snake_case` it came straight out of MySQL; if it's `camelCase` some JavaScript built it. You can often tell where a value originated just from its shape.

---

## How to find something that isn't on this page

```bash
# Find which files mention a word
grep -rn "pickItems" --include="*.js" --include="*.jsx" client/src server/src

# Find a file by name
find . -name "*picklist*" -not -path "*/node_modules/*"

# List every API endpoint the server defines
grep -rn "router\.\(get\|post\|patch\|delete\)" server/src/routes/

# List every method the browser can call
grep -n "=>" client/src/api/client.js
```

That last one is worth remembering — it prints the complete API surface in about 40 lines.

---

Next: **[03 — The Database](03-the-database.md)** — because everything else is just moving data in and out of these tables.
