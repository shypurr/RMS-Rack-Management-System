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

## Run

```bash
# 1. Backend
cd server
npm install
npm run seed        # creates DB `rms`, applies schema, seeds 100 racks + fake source txns
npm run dev         # http://localhost:4000

# 2. Frontend (new terminal)
cd client
npm install
npm run dev         # http://localhost:5173  (proxies /api → :4000)
```

## Data model
- `rack_master(rack_id PK, capacity, used, status)` — `used` = SUM(item qty), `status` derived
  Vacant/Occupied. DB CHECK enforces `used <= capacity`.
- `item_location(id, item, color, size, qty, fk_rack_id, module_id, module_type)` — many rows per
  rack (shared pool).
- `audit_log(entity_type, entity_id, action, before_json, after_json, user_id, created_at)`.
- `source_transaction(...)` — stub feeding Flow A until real Vastra integration.

## API
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/racks` | rack list |
| GET | `/api/racks/:id` | rack + items (report) |
| POST | `/api/racks` | create rack |
| POST | `/api/item-locations` | add item (Flow A/B) |
| PATCH | `/api/item-locations/:id` | update qty (0 = remove) |
| POST | `/api/moves` | atomic move |
| GET | `/api/source-transactions?moduleType=` | Flow A feed |
| GET | `/api/audit-log` | history |

## Verify (matches plan)
```bash
# capacity guard — expect HTTP 409
curl -s -X POST localhost:4000/api/item-locations \
  -H 'content-type: application/json' \
  -d '{"rackId":"R01-S01-B01","item":"Saree","qty":101}'

# add (Flow B) — expect rack used=5, status Occupied
curl -s -X POST localhost:4000/api/item-locations \
  -H 'content-type: application/json' \
  -d '{"rackId":"R01-S01-B01","item":"Kurti","color":"Red","size":"M","qty":5}'

# move — atomic; check both racks after
curl -s -X POST localhost:4000/api/moves \
  -H 'content-type: application/json' \
  -d '{"itemId":1,"toRackId":"R01-S01-B02","qty":2}'

curl -s localhost:4000/api/audit-log        # who/when/before/after
```

## Deferred
- Real Vastra source-module data (replaces `source_transaction` stub) + integration mode.
- Auth/roles — `audit_log.user_id` is stubbed `'system'`.
