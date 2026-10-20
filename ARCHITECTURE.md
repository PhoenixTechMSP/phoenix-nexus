# Architecture

This document is aimed at developers who will maintain and extend the
project. For usage, see the [README](README.md). For deployment, see
[INSTALL.md](INSTALL.md).

---

## 1. High-level diagram

```text
┌────────────────────────────┐          ┌────────────────────────────┐
│  Browser (intranet client) │          │   Microsoft Entra ID       │
│  React + Vite build        │  OIDC    │   (optional, SSO only)     │
└──────────────┬─────────────┘◄────────►└────────────────────────────┘
               │ HTTPS (reverse proxy)
               ▼
┌────────────────────────────────────────────────────────────────────┐
│  Node.js 20 process (single container)                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Express app  (server/index.js)                               │  │
│  │   /api/auth   /api/sso   /api/users   /api/agents            │  │
│  │   /api/ptx    /api/events   /api/import   /api/departments   │  │
│  │   static: /  → dist/ (Vite build)                            │  │
│  └───────────────────────┬──────────────────────────────────────┘  │
│                          │ better-sqlite3 (in-process)              │
│                          ▼                                          │
│                    /data/ptx.db  (WAL, FK ON)                       │
└────────────────────────────────────────────────────────────────────┘
```

One process, one database file, zero external services (SSO excluded).

---

## 2. Source tree

```text
server/
├── index.js               # Express bootstrap, static hosting, router mount
├── db.js                  # better-sqlite3 handle, schema, idempotent migrations, seeds
├── middleware/
│   └── auth.js            # JWT sign/verify, requireAuth, requireRole
└── routes/
    ├── auth.js            # POST /login, GET /me - local email/password
    ├── sso.js             # /login, /callback, /status - Entra ID OIDC
    ├── users.js           # Admin CRUD + role/password management
    ├── agents.js          # CRUD + autocomplete
    ├── ptx.js             # CRUD + check-in/check-out state machine
    ├── events.js          # Event log query + Excel export
    └── import.js          # xlsx upload → dedupe → insert

client/
├── vite.config.js         # Proxies /api → :8080 in dev
└── src/
    ├── main.jsx           # BrowserRouter, i18n init, layout mount
    ├── lib/api.js         # fetch helper: JWT header, JSON parse, error unwrap
    ├── components/
    │   ├── Layout.jsx          # nav bar with role-gated links
    │   └── LanguageSwitcher.jsx
    ├── i18n/
    │   ├── index.js       # i18next config (default lang = en)
    │   ├── en.json | fr.json | nl.json
    └── pages/
        ├── Login.jsx      # local login + SSO button (when enabled)
        ├── Scan.jsx       # QR camera + manual entry + autocomplete
        ├── Inventory.jsx  # PTX list + filters + status transitions
        ├── Logs.jsx       # Event history + Excel export
        ├── Dashboard.jsx  # KPIs + Recharts
        ├── Agents.jsx     # Agent CRUD
        └── Admin.jsx      # Users, departments, imports
```

---

## 3. Data model

Full schema in [`server/db.js`](server/db.js). Summary:

| Table        | Purpose                                            | Notable columns / constraints                                          |
|--------------|----------------------------------------------------|------------------------------------------------------------------------|
| `departments`| 7 seeded on first boot; editable via API           | `code` UNIQUE                                                          |
| `users`      | App accounts (local + SSO)                         | `role IN (admin, manager, staff, pending)`, `status`, `oid`, `language`|
| `agents`     | Field agents receiving PTX devices                 | `matricule` UNIQUE, `(last_name, first_name)` indexed                  |
| `ptx`        | Fleet devices                                      | `ptx_code` UNIQUE, `imei` UNIQUE, `status` CHECK, `current_agent_id`   |
| `ptx_events` | Immutable audit trail                              | `event_type IN (check_out, check_in, status_change, import, note)`     |

### PTX status state machine

```text
                 check_out (agent assigned)
   available  ─────────────────────────────────►  in_use
       ▲                                           │
       │ check_in (return OK)                      │
       │                                           │ mark defective / lost / stolen
       │                                           ▼
       │                                       defective / lost / stolen
       │                                           │
       │ mark repaired / recovered                 │
       └───────────────────────────────────────────┘
                                       │
                                       ▼ send to workshop
                                    repair ─── repaired ──► available
                                       │
                                       └── decommission ──► retired
```

Enforced in `server/routes/ptx.js`. Every transition writes a `ptx_events`
row with the previous and new status; the log is append-only.

---

## 4. Authentication & authorization

### Local login

1. `POST /api/auth/login` with `{ email, password }`.
2. `bcrypt.compare` against `users.password_hash`.
3. On success, sign a JWT `{ id, role, dept, name }` (12h TTL).
4. Client stores it in `localStorage.ptx_token` and sends
   `Authorization: Bearer <token>` on every request.

### SSO login (Entra ID)

1. `GET /api/sso/login` builds an authorization URL with PKCE (`openid-client`).
2. Entra ID redirects to `SSO_REDIRECT_URI`.
3. `GET /api/sso/callback` exchanges the code, validates the ID token,
   upserts the user by `oid` (fallback: email), then signs the same JWT
   as local login.
4. The user is redirected to `/login?sso=ok&data=<encoded>`; the SPA reads
   the token, stores it, navigates to `/scan`.

MFA is out of scope for the app - it is enforced by Entra Conditional
Access. Any user who reaches the callback with valid tokens has already
completed the tenant's MFA requirements.

### Role guards

Middleware `requireRole('admin' | 'manager' | 'staff')` in
`server/middleware/auth.js`. Rule of thumb:

- `admin` - full CRUD, imports, user management.
- `manager` - scan, agents, dashboard.
- `staff` - scan + read-only inventory/logs.
- `pending` - cannot obtain a session token (blocked at login).

---

## 5. Request flow - check-out example

```text
Scan.jsx
  │ 1. QR camera → onDecoded("PTX-0536 / 356966281334294")
  │ 2. parseQr(str)  →  { code: "PTX-0536", imei: "356966281334294" }
  │ 3. GET /api/ptx?q=PTX-0536      (autocomplete)
  │ 4. GET /api/agents?q=doe        (autocomplete)
  │ 5. POST /api/ptx/:id/check-out  { agent_id }
  ▼
server/routes/ptx.js
  │ requireRole('staff')
  │ BEGIN TRANSACTION
  │   UPDATE ptx SET status='in_use', current_agent_id=?, updated_at=NOW WHERE id=?
  │   INSERT INTO ptx_events (ptx_id, agent_id, user_id, event_type, status_after, department_id)
  │        VALUES (?, ?, ?, 'check_out', 'in_use', ?)
  │ COMMIT
  ▼
Response { ptx, event }
```

The reverse flow (`check-in`) resets `current_agent_id` to NULL and sets
`status` to `available`, `defective`, `lost`, or `stolen` depending on the
button pressed.

---

## 6. Frontend conventions

- **State**: React hooks + `lib/api.js`. No Redux, no React Query - the
  dataset is small enough for direct fetches with local state.
- **Routing**: React Router 6 in `main.jsx`. Auth guard by reading
  `localStorage.ptx_token` on mount and redirecting to `/login` when
  missing.
- **i18n**: `useTranslation()` in every page. Strings live in
  `client/src/i18n/{en,fr,nl}.json`. **English is the source of truth** -
  add keys there first, then translate.
- **QR scanning**: `html5-qrcode` mounted on a `<div id="qr-reader">`
  and torn down on unmount. Camera permission is prompted by the browser.
- **Charts**: Recharts. Data pre-aggregated server-side in
  `/api/events/stats/*` - the client never groups raw events.

---

## 7. Extension points

| I want to…                          | Where to edit                                                                     |
|-------------------------------------|-----------------------------------------------------------------------------------|
| Add a new PTX status                | `server/db.js` CHECK constraint, `server/routes/ptx.js` transitions, i18n labels. |
| Add a UI language                   | Create `client/src/i18n/<code>.json`, register it in `i18n/index.js`, add option to `LanguageSwitcher.jsx`, extend the `language` CHECK constraint in `db.js`. |
| Add a role                          | Update `users.role` CHECK, `requireRole` calls, UI role selectors, README table.  |
| Add a new report                    | Add an aggregation SQL query in `server/routes/events.js`, expose it under `/api/events/stats/…`, render with Recharts in `Dashboard.jsx`. |
| Replace SQLite with Postgres        | Swap `better-sqlite3` for `pg`, rewrite `db.js`, adapt raw SQL (mostly ANSI, but watch `AUTOINCREMENT` → `SERIAL` and date functions). |
| Add another SSO provider (Google…)  | Add a new router modeled after `server/routes/sso.js` using `openid-client` with a different `Issuer.discover(...)` URL. |

Guidelines in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 8. Known limitations

- **Single-node**. Not designed to run behind a load balancer - SQLite lives
  on the local filesystem. For HA, migrate to Postgres and externalize
  sessions.
- **No push notifications** for unreturned devices at shift end. Roadmap.
- **No offline mode**. The Scan page requires network. PWA support is a
  planned enhancement.
- **Excel import is admin-only** and synchronous - files up to a few MB
  work well; beyond that, chunk the file.
