# Configuration reference

All runtime configuration is passed via **environment variables**. In Docker
they come from `.env` (loaded by `docker-compose.yml`). In Node direct
deployments they come from the systemd `EnvironmentFile` or NSSM
`AppEnvironmentExtra`.

Starting point: copy `.env.example` to `.env` and edit.

---

## 1. Core variables

| Variable      | Required | Default            | Description                                                       |
|---------------|----------|--------------------|-------------------------------------------------------------------|
| `JWT_SECRET`  | **Yes**  | -                  | 32+ random chars, used to sign session JWTs. Generate with `openssl rand -hex 32`. Rotating this invalidates all sessions. |
| `PORT`        | No       | `8080`             | HTTP port the Express server listens on.                          |
| `DB_PATH`     | No       | `./data/ptx.db`    | Absolute path to the SQLite file. Parent directory is auto-created. |
| `TZ`          | No       | `Europe/Brussels`  | Time zone used for daily aggregation and log timestamps in the UI. |
| `NODE_ENV`    | No       | `production`       | Set to `development` to enable verbose logging.                   |

---

## 2. Microsoft Entra ID SSO

SSO is optional. When `SSO_ENABLED=false` (the default), only local
email/password login is available. Local login always remains active as a
break-glass path even when SSO is on.

| Variable                | Required if `SSO_ENABLED=true`               | Description                                                                                                    |
|-------------------------|----------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| `SSO_ENABLED`           | -                                            | `true` or `false`.                                                                                             |
| `SSO_TENANT_ID`         | Yes                                          | Directory (tenant) ID from the App registration overview page.                                                 |
| `SSO_CLIENT_ID`         | Yes                                          | Application (client) ID.                                                                                        |
| `SSO_CLIENT_SECRET`     | Yes                                          | Client secret value (not the ID). Max lifetime 24 months - rotate before expiry.                                |
| `SSO_REDIRECT_URI`      | Yes                                          | Must match the redirect URI registered in Entra **byte-for-byte**. Example: `https://ptx.intranet.local/api/sso/callback`. |
| `SSO_ALLOWED_DOMAINS`   | No                                           | Comma-separated allowlist of email domains (e.g. `company.com,partner.com`). Empty means "any".                 |
| `SSO_DEFAULT_ROLE`      | No (default `pending`)                       | Role assigned to a user on first SSO login: `pending`, `staff`, `manager`, `admin`. `pending` requires admin approval before the user can log in. |

### Microsoft Entra ID SSO - setup walkthrough

1. Open **Entra admin center** → *App registrations* → **New registration**.
2. Name: `Phoenix-Nexus`.
3. Supported account types: *Accounts in this organizational directory only
   (single tenant)*.
4. Redirect URI: type **Web**, value = the URL you will set as
   `SSO_REDIRECT_URI`. In production this **must be HTTPS**; Entra only
   allows plain HTTP for `http://localhost`.
5. Click **Register**.
6. Copy **Application (client) ID** and **Directory (tenant) ID** from the
   overview page.
7. Go to **Certificates & secrets** → *New client secret* → copy the
   **Value** immediately (it becomes unreadable after leaving the page).
8. Under **API permissions**, keep `User.Read` (Microsoft Graph, delegated).
   Click **Grant admin consent** if the tenant requires it.
9. Fill the `SSO_*` variables in `.env` and restart the service.

### Enforcing MFA / phishing-resistant auth

The app **does not implement MFA itself**. Enforce it in Microsoft Entra:

- **Protection → Conditional Access → New policy**.
- Target the Phoenix-Nexus app (or a group of users).
- Grant: *Require multi-factor authentication*, and for high-assurance
  environments *Require authentication strength: Phishing-resistant MFA*
  (Yubikey / FIDO2 / Windows Hello for Business).

---

## 3. Behaviour matrix - SSO_DEFAULT_ROLE

| Value      | First-time SSO login behaviour                                                     |
|------------|------------------------------------------------------------------------------------|
| `pending`  | Account created with role `pending` / status `pending`. Admin must approve.        |
| `staff`    | Account created with role `staff` / status `active`. Immediate access, scan only.  |
| `manager`  | Account created active, with manager rights (scan + agents + dashboard).           |
| `admin`    | **Not recommended.** Full admin on first login. Only use with a strict allowlist.  |

The safe default is `pending`. Combine with `SSO_ALLOWED_DOMAINS` to prevent
external tenants from provisioning accounts.

---

## 4. Persistence layout

```text
data/
├── ptx.db            # SQLite database (WAL + SHM files live next to it)
└── backups/          # created by scripts/backup.sh
    └── ptx-YYYYMMDD-HHMMSS.db.gz
```

- The container mounts `./data` at `/data`.
- Do **not** copy `ptx.db` while the app is running; use
  `scripts/backup.sh` (SQLite `.backup` command, safe under concurrency).

---

## 5. Rotating secrets

- **`JWT_SECRET`** - replace the value and restart. All active sessions are
  invalidated; users must sign in again.
- **`SSO_CLIENT_SECRET`** - generate a new secret in Entra (keep the old one
  active until the app is restarted), swap `.env`, restart, then delete the
  old secret in Entra.
- **User passwords** - reset from **Admin → Users → Reset password** or via
  `scripts/first-admin.js` for the admin account itself.

---

## 6. Time zone and daily aggregation

Daily dashboard buckets are computed in the `TZ` time zone at query time.
Change `TZ` and restart to shift the day boundary - historic events are not
rewritten (their `created_at` is stored in UTC ISO 8601).
