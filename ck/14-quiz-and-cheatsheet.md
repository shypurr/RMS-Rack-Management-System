# 14 — Quiz & Cheatsheet

[← How To Add A Feature](13-how-to-add-a-feature.md) · [Back to Start](00-START-HERE.md)

---

# Part 1 — "Where is that code?"

Cover the right column. Someone points at the app and asks where something lives.

| Question | Answer |
|----------|--------|
| Where's the login screen? | [`client/src/pages/Login.jsx`](../client/src/pages/Login.jsx) |
| Where does the OTP actually get sent? | [`server/src/vastraClient.js:63`](../server/src/vastraClient.js#L63) `sendLoginOtp()` |
| Where's the session token created? | [`server/src/routes/auth.js:125`](../server/src/routes/auth.js#L125) |
| Where's the token checked on every request? | [`server/src/middleware/requireAuth.js`](../server/src/middleware/requireAuth.js) |
| Where's the token stored in the browser? | [`client/src/api/client.js:3-6`](../client/src/api/client.js#L3-L6) — `localStorage['wms-token']` |
| Where's the list of URLs the app has? | [`client/src/main.jsx:33-50`](../client/src/main.jsx#L33-L50) |
| Where's the list of API endpoints? | [`server/src/app.js:39-49`](../server/src/app.js#L39-L49) |
| Where's every server call the browser makes? | [`client/src/api/client.js`](../client/src/api/client.js) |
| Where are the sidebar links defined? | [`client/src/components/Layout.jsx:6-19`](../client/src/components/Layout.jsx#L6-L19) |
| Where's the code that adds stock to a rack? | [`server/src/services/rackService.js:91`](../server/src/services/rackService.js#L91) `addItem()` |
| Where's the capacity check? | [`server/src/services/rackService.js:41`](../server/src/services/rackService.js#L41) `assertCapacity()` |
| Where's `rack_master.used` recalculated? | [`server/src/services/rackService.js:29`](../server/src/services/rackService.js#L29) `recalcRack()` |
| Where's the move logic? | [`server/src/services/rackService.js:232`](../server/src/services/rackService.js#L232) `moveItem()` |
| Where's the stock deduction for a picklist? | [`server/src/services/rackService.js:161`](../server/src/services/rackService.js#L161) `pickItems()` |
| Where's "which racks hold this item"? | [`server/src/services/rackService.js:76`](../server/src/services/rackService.js#L76) `findPlacements()` |
| Where's the picklist rack allocation? | [`server/src/routes/picklist.js:24`](../server/src/routes/picklist.js#L24) `allocate()` |
| Where's the picklist resolution logic? | [`server/src/routes/picklist.js:62`](../server/src/routes/picklist.js#L62) `resolveLines()` |
| Where's the PDF drawn? | [`server/src/services/picklistPdf.js`](../server/src/services/picklistPdf.js) |
| Where's picklist history saved? | [`server/src/services/picklistStore.js:15`](../server/src/services/picklistStore.js#L15) `savePicklist()` |
| Where's `rack_updated` set to 1? | [`server/src/services/picklistStore.js:61`](../server/src/services/picklistStore.js#L61) `markRackUpdated()` |
| Where are all the dashboard numbers computed? | [`server/src/services/dashboardService.js`](../server/src/services/dashboardService.js) |
| Where's the audit row written? | [`server/src/services/audit.js`](../server/src/services/audit.js) |
| Where's the database connection? | [`server/src/db.js:6`](../server/src/db.js#L6) |
| Where's the transaction helper? | [`server/src/db.js:80`](../server/src/db.js#L80) `withTransaction()` |
| Where are the tables defined? | [`server/migrations/`](../server/migrations/) — 3 files |
| Where's the error → HTTP status mapping? | [`server/src/app.js:64-77`](../server/src/app.js#L64-L77) |
| Where's the only file that calls Vastra? | [`server/src/vastraClient.js`](../server/src/vastraClient.js) |
| Where's the live-vs-fake data switch? | [`server/src/services/sourceModules.js`](../server/src/services/sourceModules.js) |
| Where's the demo data generated? | [`server/seed.js`](../server/seed.js) |
| Where's the CSV export? | [`client/src/pages/Reports.jsx:63`](../client/src/pages/Reports.jsx#L63) |
| Where's the rack occupancy colour rule? | [`client/src/lib/rack.js:3`](../client/src/lib/rack.js#L3) `occupancyBucket()` |
| Where's the shared search helper? | [`client/src/lib/items.js`](../client/src/lib/items.js) |
| Where's dark mode? | [`client/src/lib/useTheme.js`](../client/src/lib/useTheme.js) + [`style.css:33`](../client/src/styles/style.css#L33) |
| Where's the dev proxy config? | [`client/vite.config.js`](../client/vite.config.js) |
| Where are the tests? | [`server/checkAuth.js`](../server/checkAuth.js), [`server/checkModules.js`](../server/checkModules.js) |
| Where's the "already stored in N racks" hint? | [`client/src/pages/AddItem.jsx:119-146`](../client/src/pages/AddItem.jsx#L119-L146) |
| Where's the size-run entry grid? | [`client/src/pages/Picklist.jsx:336-366`](../client/src/pages/Picklist.jsx#L336-L366) |
| Where's the "stock has moved" warning? | [`client/src/pages/History.jsx:261-267`](../client/src/pages/History.jsx#L261-L267) |
| Where's the popup-blocker workaround? | [`client/src/pages/Picklist.jsx:127`](../client/src/pages/Picklist.jsx#L127) `openPdf()` |

---

# Part 2 — Checkpoint answers

### From [01 — The Big Picture](01-the-big-picture.md)

**1. Why can't the browser query MySQL directly?**
Because anything in the browser is under the user's control. A database password shipped to the browser is a password given away, and a rule enforced only in the browser can be bypassed with dev tools. The server is the only place a rule can actually hold.

**2. Difference between Flow A and Flow B?**
Both put stock into a rack. Flow A auto-fills from a Vastra source document and records `module_id` + `module_type`; Flow B is typed by hand and leaves both `NULL`. Everything downstream is identical.

**3. Why is Delivery Challan kept out of `MODULE_TYPES`?**
It's outbound. It describes goods *leaving*, so it can never be the reason goods are *stored*. Enforced in four places: `vastraClient.js`, the `item_location` ENUM, `lib/rack.js`, and a test in `checkModules.js`.

**4. What does "generating a picklist changes nothing" mean?**
`GET`/`resolve` only reads stock and returns rack suggestions. Only `POST /api/picklist/pick` deducts. The picker walks the warehouse between the two, and during that time the system must still report the truth.

**5. What is `rack_updated` for?**
Because generating writes no stock change, a picklist that was generated and then abandoned would be invisible. A `picklist` row is written at generation with `rack_updated = 0`; it flips to 1 only after a successful pick. Rows still at 0 are exactly where a stock discrepancy hides.

**6. Ports in development?**
5173 = Vite (serves the React app, proxies `/api`). 4000 = Express. Always open 5173.

---

### From [03 — The Database](03-the-database.md)

**1. Which tables survive `npm run seed`?**
`organization`, `session`, `picklist`, `picklist_line`. They're in `auth.sql` and `picklist.sql`, applied at boot with `CREATE TABLE IF NOT EXISTS`. `schema.sql` drops and recreates its four, so a reseed must never delete logins or operational history.

**2. Why is `color` `''` rather than `NULL`?**
Because `NULL = NULL` is not true in SQL. `findPlacements` matches on `color = ? AND size = ?`, so NULLs would silently never match — breaking both the putaway hint and the whole picklist.

**3. Why does qty 0 delete the row?**
`CHECK (qty > 0)` — a row with 0 doesn't mean "none here", it means the row shouldn't exist. Keeping the table meaning exactly "stock that exists" removes the need for `WHERE qty > 0` everywhere.

**4. What does `FOR UPDATE` do?**
Locks the selected rows until the transaction ends. Without it, two simultaneous adds could both read `used = 95`, both conclude their 4 units fit, and both write 99 — losing 4 units.

**5. Why does `picklist_line` store rack names as text?**
Because the `item_location` rows it describes get deducted, merged and deleted. A foreign key would dangle; copied text stays readable forever. **History stores facts, not pointers.**

**6. Why does `history.js` subtract `before.qty` from `after.qty`?**
On a merged add, `after_json.qty` is the running total, not what was added. Add 10 to a row holding 30 and it reads 40. The difference against `before_json` is the real amount. `before_json` is `null` for a fresh row, which the ternary handles.

---

### From [04 — Login & Auth](04-login-and-auth.md)

**1. The two tokens?**
`vastra_access_token` (Vastra's, server-only, for calling Vastra) and the RMS `session.token` (64 random hex, in the browser's localStorage, for calling RMS). The browser holds only the second.

**2. Why look up by `vastra_org_id`?**
Mobile and name both change on Vastra's side. Identity has to be the one thing that doesn't.

**3. What makes single-active-session work?**
`DELETE FROM session WHERE org_id = ?` then `INSERT`, inside `withTransaction`. The transaction prevents a crash between them leaving the org with zero sessions.

**4. Why check `blocked` in `requireAuth` rather than at login?**
So it takes effect immediately. Set `blocked = 1` and the org is out on its next request. Checking only at login would leave an existing session alive indefinitely. **This is precisely what a JWT cannot do.**

**5. Why is `RequireAuth` a component?**
An inline `getToken() ? … : …` evaluates once when `main.jsx` renders and freezes. You'd log in, the token would save, and you'd still bounce to `/login` until a manual reload. As a component it re-reads every render.

**6. Why doesn't a Vastra rejection clear the token by default?**
Vastra returns `status: false` for everything it refuses, so an expired token and a module it won't serve look identical. Clearing on the wrong one logs the org out of *every* feature because one module misbehaved. The destructive branch requires positive evidence — the message must match `/token|unauthor|expire|session|login|forbidden|denied/i`.

---

### From [05 — Server Anatomy](05-server-anatomy.md)

**1. Why start when MySQL is down?**
So `/api/health` still answers and you can diagnose it. Refusing to start would leave nothing to inspect.

**2. Why is the error handler last?**
Express runs middleware in registration order. The handler catches errors from everything registered *before* it.

**3. What does `HttpError` solve?**
It lets a service say "this should be a 404" without knowing HTTP exists. The service labels the problem; the error handler translates the label.

**4. Why `next(err)` not `throw`?**
Express 4 can't catch errors thrown from async functions. An uncaught throw leaves the request hanging with no response at all.

**5. What does sorting picks by id prevent?**
Deadlock. Two transactions taking the same locks in different orders can wait on each other forever. Everyone locking in ascending id order makes that impossible.

**6. Why must `/:id/resolve` come before `/:dcNo`?**
Express matches in registration order and stops at the first hit. `/:dcNo` matches any single segment, so registering it first would make more specific routes unreachable.

**7. Why format `doc_date` to a string in SQL?**
mysql2 returns a `DATE` as a JS `Date` at *local* midnight. `JSON.stringify` uses UTC, so in India every date would serialize one day early.

---

### From [06 — Client Anatomy](06-client-anatomy.md)

**1. What does `useState` give you?**
A current value and a setter. Only the setter tells React to redraw — direct assignment changes the variable but React never finds out, so nothing updates.

**2. What does `[]` mean in `useEffect`?**
Run once, when the component first appears. `[x]` re-runs whenever `x` changes; omitting it runs after every render.

**3. Why `onMouseDown` in comboboxes?**
Clicking an option fires `blur` on the input before `click` on the option — the dropdown would close and the click would land on nothing. `mousedown` fires before blur.

**4. What does `<Outlet />` do?**
Marks where a nested route's page renders. Sidebar and topbar stay; only that region changes.

**5. Why does every call go through `api/client.js`?**
So auth headers, error shaping and the global 401-redirect are written once. One edit changes behaviour everywhere.

**6. How does `sevenDayTrend` handle quiet days?**
The server only returns days that had activity. It walks all 7 days and fills the gaps with 0, so the chart always has exactly 7 points.

**7. What makes `Reports.jsx` render four reports with one code path?**
The `REPORTS` config object. Each entry supplies its own `fetch` and `row` functions; every report reduces to an array of strings, so search and CSV export work for all of them for free.

---

### From [07 — Flow A](07-flow-A-putaway.md)

**1. Only difference between Flow A and B in storage?**
Whether `module_id` and `module_type` are filled or `NULL`.

**2. Why is quantity editable when the rest is locked?**
The document says what the goods *are* — that must match exactly or rack lookup fails. But it may say 100 when 60 arrived. The person at the dock is the authority on quantity.

**3. What does `findPlacements` do?**
Returns every rack holding an exact variant, biggest first. Powers the putaway hint, MoveItem step 2, **and** the entire picklist resolution.

**4. Adding a variant already in that rack?**
It merges — the existing row's qty increases. No duplicate row is created.

**5. Why is `before_json` null for a new row?**
Because there was no previous state. The pattern is: created → `before: null`, changed → both, deleted → `after: null`. It's also what lets History compute the real added amount.

**6. Why `Number(form.qty)`?**
HTML inputs produce strings even with `type="number"`. `Number.isInteger("40")` is `false`, so the server would reject it with a 400.

**7. Why does changing a React `key` reset the combobox?**
React treats a new key as a different component — it unmounts the old one and mounts a fresh one, discarding all internal state.

---

### From [08 — Move & Edit](08-flow-B-move-and-edit.md)

**1. Why group by variant in Step 1?**
The API returns one row per rack. You think "move some Blue L kurtis", not "move row #4471". Product first, location second.

**2. Why copy `module_id` / `module_type` on a move?**
Moving goods doesn't change where they came from. Without it, a move would silently turn documented stock into "Manual".

**3. Why recalculate both racks?**
Source got emptier, destination fuller. Doing only one leaves the other permanently wrong.

**4. Why `used − before.qty + qty`?**
You're replacing a value, not adding one. If the rack holds 90 and this line is 40 of it, changing to 60 gives 110, not 150.

**5. Why does `updateItemQty` allow 0?**
Zero is the delete signal. Every other function needs `> 0`.

**6. Picklist deduction vs manual edit in the audit log?**
Both use `update`/`remove`. `after_json.source === 'picklist'` is what distinguishes them. The challan number is added only when known.

**7. Why no capacity check in `pickItems`?**
It only deducts. If `used` can only fall, it can never exceed capacity — the constraint is unreachable.

---

### From [09 — Flow C](09-flow-C-picklist.md)

**1. Why two steps?**
The picker walks the warehouse between generating and confirming. During that time the system must still report the truth, and an abandoned pick must not have already deducted.

**2. What is a size run?**
One design, one colour, spread across several sizes with a quantity each — how garment challans print. It reaches RMS as one line per size, so the UI lets you enter the design once and fill a row of size boxes.

**3. Why warn on over-request but clamp the allocation boxes?**
Different meanings. Step 2 records **what the customer asked for** — clamping would quietly rewrite their order. The allocation box records **what you're taking off a shelf** — you physically cannot take 15 from a shelf holding 12.

**4. What does `allocate()` optimise for?**
Fewest racks visited. Largest-first means a line is usually covered from one shelf. Walking is the expensive part of picking.

**5. Why `rack_updated = 0 AND user_id = ?` before reusing a row?**
`rack_updated = 0` — a completed picklist is history; a new generate is a genuinely new pick. `user_id = ?` — a **security check**: without it, sending someone else's picklist id would overwrite their record.

**6. Why `markRackUpdated` after `pickItems`?**
If the deduction throws, execution never reaches it and `rack_updated` stays 0 — correctly reporting "generated but not acted on". The other order would mark failed picks as complete.

**7. Why clear the screen after a pick?**
Double-deduction guard built out of UI design. Leaving the list up invites clicking "Update Rack" again; the server wouldn't stop you, because the quantities are still valid.

**8. Why is `/:dcNo` registered last?**
It matches any single segment, including `challans`. Registered earlier, it would swallow the more specific routes.

**9. Why does History's Update re-resolve instead of replaying?**
The stored `racks` text is a snapshot from generation time. Stock may have moved. Re-resolving gives the truth; comparing against the snapshot produces the "stock has moved since this was printed" warning.

---

### From [10 — Vastra](10-vastra-integration.md)

**1. Why one file?**
One place to change when Vastra changes, one place to fake in tests, one place to translate their errors into ours. It's the Adapter pattern.

**2. The two quirks?**
(a) Everything is HTTP 200 — read `body.status`, not the status code. `if (!res.ok)` would treat every error as success. (b) The `authorization` header takes the **raw** token, no `Bearer` prefix.

**3. Why no fallback URL?**
A stale hardcoded IP could send credentials to whoever owns that address now. With the variable unset, every call fails closed.

**4. What does `flatten()` do?**
Turns one nested Vastra document into flat rows — one per `designDetails` or `materialDetails` entry — in the same shape the stub table returns. `line_id` exists because `id` (the document number) repeats across lines, and React needs unique keys.

**5. Two guards against infinite pagination?**
`next !== path` catches a self-referential link immediately; `MAX_PAGES = 20` backstops any longer cycle. Both are tested.

**6. Why alias `doc_date` to `date`?**
So the stub returns exactly the shape live Vastra does. The fake bends to match the real API, so switching over changes nothing downstream.

**7. What if Delivery Challan were in `MODULE_TYPES`?**
Putaway would offer outbound documents as a reason to *store* stock, and the `item_location.module_type` ENUM would reject the insert at the database level. A test asserts it stays out.

---

# Part 3 — The one-page cheatsheet

## The system

```
Browser (React :5173) → Express API (:4000) → MySQL (:3306)
                              ↓
                        Vastra API (external)
```

## The three flows

| Flow | Screen | Direction |
|------|--------|-----------|
| A | Putaway → source module tab | stock in |
| B | Putaway → manual tab | stock in |
| C | Picklist | stock out |

## The eight tables

`rack_master` · `item_location` · `audit_log` · `source_transaction` *(wiped on seed)*
`organization` · `session` · `picklist` · `picklist_line` *(survive seed)*

## The server layers

```
routes/*.js    → HTTP only, thin
services/*.js  → business rules, transactions
db.js          → pool + withTransaction
```

## The invariant

> **Every write to `item_location` must, in one transaction:
> change the row → `recalcRack()` → `writeAudit()`**

## Key files

| File | Why it matters |
|------|---------------|
| `server/src/services/rackService.js` | All stock logic |
| `server/src/routes/picklist.js` | The biggest feature |
| `server/src/vastraClient.js` | The only external door |
| `server/src/app.js` | The URL map |
| `client/src/api/client.js` | Every server call |
| `client/src/main.jsx` | Every URL |

## Commands

```bash
cd server && npm run dev        # API, auto-restart
cd client && npm run dev        # UI, hot reload  → open :5173
cd server && npm run seed       # rebuild demo data
cd server && node makeChallans.js  # add sample challans
cd server && node checkAuth.js && node checkModules.js   # the tests
npm run build && npm start      # production, single port
```

## Status codes

`200` ok · `201` created · `400` bad input · `401` no session · `403` blocked
`404` not found · `409` conflict/capacity · `429` rate limited · `502` Vastra down · `503` DB down

## Traps

- MySQL `SUM()` returns a **string** → `Number()` it
- Express 4 can't catch async throws → always `next(err)`
- Register specific routes before `/:param`
- `.env` is read once at startup → restart after editing
- `NULL = NULL` is not true → use `''` for optional text
- pdfkit silently **drops** unmappable characters → ASCII only
- `''` and `0` are falsy → use `??` not `||` when they're valid values

---

# Part 4 — Explain it out loud

The real test. Try these without notes.

### Beginner
1. What does this application do, in one sentence?
2. What's the difference between the client and the server?
3. What is a rack, and what is a variant?
4. Why is there no password?

### Intermediate
5. Walk me through what happens when someone clicks "Add to rack".
6. Why does the picklist have two separate steps?
7. What's in `audit_log` and why does it exist?
8. How does the app know you're logged in?
9. What happens when you add stock that's already in that rack?

### Advanced
10. Why is `rack_master.used` stored when it could be computed? What stops it drifting?
11. Explain the two-speed migration system and the problem it solves.
12. Why does `pickItems` sort its picks by id?
13. Why does the size-run grid warn instead of clamping, when the allocation boxes do clamp?
14. What could a JWT not do that this session design can?
15. Why is `findPlacements` the most important function in the codebase?

### Architecture
16. Why is `vastraClient.js` the only file allowed to call Vastra?
17. What's the biggest weakness in this codebase?
18. If you had to add per-user attribution, what would change?
19. Why is there no ORM, and what does that cost and buy?
20. Which single function, if it had a bug, would do the most damage?

<details>
<summary><b>Model answers to the hard ones</b></summary>

**10.** It's a cache so the rack list doesn't run 100 `SUM()`s per page load. It can't drift because exactly one function writes it — `recalcRack()` — and that function **recounts from scratch** rather than incrementing. Every write path calls it inside the same transaction. You can verify with the invariant query in [12](12-running-and-testing.md#useful-database-queries).

**17.** `rackService.js` — the most business-critical code in the project — has **no automated tests**. Verification is manual. The two existing check scripts (`checkAuth.js`, `checkModules.js`) show exactly the pattern a `checkRacks.js` would follow. Secondary gaps: sessions never expire; the rate limiter is per-process; `moveItem` doesn't sort its locks the way `pickItems` does.

**18.** `session.org_id` points at an `organization`, and the audit trail records `req.org.vastra_org_id`. Per-user attribution needs a `user` table, `session` pointing at a user instead, `requireAuth` loading both, and `userId` throughout the services becoming a user identifier. It's a schema change, not a small feature — worth flagging before anyone assumes otherwise.

**19.** Cost: more code, hand-written SQL, no compile-time safety on queries. Buys: nothing is hidden — you can see exactly what runs, `FOR UPDATE` and transaction boundaries are explicit rather than fought with, and there's no ORM version to upgrade. For an app whose correctness depends on precise locking, explicit SQL is arguably the right call.

**20.** `recalcRack()`. Every write path calls it. A bug there silently corrupts occupancy for every rack, and nothing would error — the numbers would just quietly stop matching reality. Runner-up: `withTransaction`, because a broken rollback would leave half-applied writes everywhere.

</details>

---

## Where to go next

You've read the guide. To make it stick:

1. **Run the app** and click every screen with the browser's Network tab open. Watch the requests you've just read about.
2. **Break something on purpose** — comment out `recalcRack()` in `addItem`, add stock, watch the rack occupancy go wrong. Then put it back.
3. **Read one file a day** in full, comments included. Start with `rackService.js`.
4. **Trace one feature end to end** without this guide, using only `grep`.
5. **Make a tiny change** — a label, a colour, a sort order — and ship it.

The comments in this codebase are unusually good. When this guide and the code disagree, **the code is right** — and the comment next to it will usually tell you why.

---

[← Back to Start](00-START-HERE.md)
