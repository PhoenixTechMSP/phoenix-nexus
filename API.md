# REST API reference

All endpoints are prefixed with `/api`. Unless noted, requests require the
`Authorization: Bearer <jwt>` header obtained from `POST /api/auth/login`
or the SSO callback.

Content type is `application/json` except for `/api/import/*` which accepts
`multipart/form-data`.

Error responses use HTTP status codes with a JSON body
`{ "error": "message" }`.

---

## Health

### `GET /api/health`

Public. Liveness probe used by Docker healthcheck.

```json
{ "ok": true, "ts": "2026-07-16T09:12:00.000Z" }
```

---

## Auth

### `POST /api/auth/login`

Public. Local email/password login.

```json
Request:  { "email": "admin@company.local", "password": "…" }
Response: {
  "token": "<jwt>",
  "user":  { "id": 1, "email": "…", "full_name": "…", "role": "admin",
             "department_id": null, "language": "en" }
}
```

### `GET /api/auth/me`

Authenticated. Returns the current user profile.

---

## SSO (Entra ID)

### `GET /api/sso/status` - public
```json
{ "enabled": true }
```

### `GET /api/sso/login` - public
302 redirect to Microsoft's authorization endpoint.

### `GET /api/sso/callback` - public
Called by Microsoft. On success, redirects to
`/login?sso=ok&data=<url-encoded JSON>` where the payload contains
`{ token, user }` shaped like `/api/auth/login`. On pending accounts:
`/login?sso=pending`.

---

## Users (admin only)

| Method   | Path                        | Body                                                            |
|----------|-----------------------------|-----------------------------------------------------------------|
| `GET`    | `/api/users`                | -                                                               |
| `POST`   | `/api/users`                | `{ email, full_name, role, department_id?, password? }`         |
| `PATCH`  | `/api/users/:id`            | Any of `role`, `department_id`, `status`, `full_name`, `language` |
| `POST`   | `/api/users/:id/reset-password` | `{ password }`                                              |
| `DELETE` | `/api/users/:id`            | The last active admin cannot be deleted.                        |

---

## Departments

### `GET /api/departments` - authenticated
Returns the 7 seeded departments (editable via the admin UI).

---

## Agents

| Method   | Path                | Role      | Body / query                                                  |
|----------|---------------------|-----------|---------------------------------------------------------------|
| `GET`    | `/api/agents`       | staff+    | `?q=<name-or-matricule>` for autocomplete                     |
| `POST`   | `/api/agents`       | manager+  | `{ matricule, first_name, last_name, department_id }`         |
| `PATCH`  | `/api/agents/:id`   | manager+  | Any field                                                     |
| `DELETE` | `/api/agents/:id`   | admin     | Soft delete - sets `active = 0`                               |

---

## PTX devices

| Method   | Path                        | Role      | Body / query                                     |
|----------|-----------------------------|-----------|--------------------------------------------------|
| `GET`    | `/api/ptx`                  | staff+    | `?q=`, `?status=`, `?department_id=`             |
| `GET`    | `/api/ptx/:id`              | staff+    | -                                                |
| `POST`   | `/api/ptx`                  | admin     | `{ ptx_code, imei, department_id?, status? }`    |
| `PATCH`  | `/api/ptx/:id`              | admin     | Any editable field                               |
| `POST`   | `/api/ptx/:id/check-out`    | staff+    | `{ agent_id, notes? }`                           |
| `POST`   | `/api/ptx/:id/check-in`     | staff+    | `{ status: "available"\|"defective"\|"lost"\|"stolen", notes? }` |

Every mutation appends a row to `ptx_events`.

### QR label format

The QR encodes the string printed on the device label:

```text
PTX-0536 / 356966281334294
└─ ptx_code ┘   └─ imei ─┘
```

Parsed client-side by `client/src/lib/qr.js` (`parseQr(str)`).

---

## Events / logs

| Method | Path                             | Role     | Description                                          |
|--------|----------------------------------|----------|------------------------------------------------------|
| `GET`  | `/api/events`                    | staff+   | Query with `?from=`, `?to=`, `?department_id=`, `?type=`, `?limit=`. |
| `GET`  | `/api/events/export.xlsx`        | manager+ | Same filters - returns a streamed `.xlsx` file.      |
| `GET`  | `/api/events/stats/kpis`         | staff+   | Totals + unreturned count.                           |
| `GET`  | `/api/events/stats/daily`        | staff+   | 30-day activity per day.                             |
| `GET`  | `/api/events/stats/by-department`| staff+   | Per-department counts.                               |
| `GET`  | `/api/events/stats/status`       | staff+   | Fleet status distribution.                           |

---

## Import

### `POST /api/import/ptx` - admin
`multipart/form-data`, field name `file`. Accepts `.xlsx` or `.csv`.
Expected columns (case-insensitive, spaces allowed):

- `ptx_code` (required) - e.g. `PTX-0536`.
- `imei` (required) - 15 digits.
- `department_code` (optional) - must exist in `departments.code`.
- `status` (optional) - one of the allowed statuses.

Response:
```json
{
  "inserted": 250,
  "updated": 12,
  "skipped": [
    { "row": 34, "ptx_code": "PTX-0102", "imei": "…", "reason": "duplicate imei in file" },
    { "row": 41, "ptx_code": "PTX-0103", "imei": "…", "reason": "imei already assigned to PTX-0034" }
  ]
}
```

### `POST /api/import/agents` - admin
Same shape. Expected columns: `matricule`, `first_name`, `last_name`,
`department_code`.

---

## CMDB

All routes require authentication. Writes require `admin` or `manager`.

| Route | Description |
|---|---|
| `GET /api/cmdb/items?status=Active\|Archived` | List configuration items |
| `GET /api/cmdb/items/:id` | One item with `relationships` (outgoing) and `incoming` |
| `POST /api/cmdb/relationships` | `{ source_ci_id, target_ci_id, relationship_type }`, `409` on duplicate |
| `DELETE /api/cmdb/relationships/:id` | Remove a relationship |

Items are created and archived by the asset lifecycle only (check-out, edit to `in_use`, import,
retirement). There is no route to create an item by hand: the flow is ITAM to CMDB, never the reverse.

## SAM

All routes require authentication. Writes require `admin` or `manager`.

| Route | Description |
|---|---|
| `GET /api/sam/summary` | KPIs: annual cost, utilisation, savings, exposures, renewals within 90 days |
| `GET /api/sam/position` | Per product: entitled, consumed, gap, utilisation, status, saving, exposure |
| `GET /api/sam/renewals?days=90` | Entitlements renewing within the window (1 to 730 days) |
| `GET /api/sam/products/:id` | Product with its entitlements and assignments |
| `POST /api/sam/products` | `{ name, vendor, metric, category? }`, metric: `named_user`, `device`, `core`, `subscription` |
| `POST /api/sam/entitlements` | `{ product_id, quantity, annual_cost, contract_ref?, renewal_date? }` |
| `DELETE /api/sam/entitlements/:id` | Remove an entitlement |
| `POST /api/sam/installations` | `{ product_id, agent_id \| asset_id, units?, last_used_at? }` |
| `DELETE /api/sam/installations/:id` | Release a licence |

`named_user` and `subscription` are counted per agent, `device` and `core` per asset: the wrong
target is rejected with `400`. Statuses: `unlicensed` (consumption without entitlement),
`over_deployed` (consumed above entitled), `limit_reached`, `oversized` (below 70 % used), `compliant`.

## Error semantics

| Status | Meaning                                                       |
|--------|---------------------------------------------------------------|
| `400`  | Validation error - see `error` field.                          |
| `401`  | Missing / invalid / expired JWT.                              |
| `403`  | Authenticated but role too low, or account `pending`/`disabled`. |
| `404`  | Resource not found or filtered out by role scope.             |
| `409`  | Unique constraint violation (email, ptx_code, imei, matricule). |
| `413`  | Payload too large - check reverse proxy limits for imports.   |
| `500`  | Unhandled error - check server logs.                          |
