# Security

## Threat model - in scope

The app is designed for an **intranet deployment** with these assumptions:

- Traffic between browsers and the server is terminated with HTTPS by a
  reverse proxy under your control.
- Only authenticated employees reach the app (via the corporate network
  and/or Entra ID).
- The database file is only accessible to the OS user running the app.

The app protects against:

- Unauthenticated access to any resource (JWT required, role-scoped).
- Password brute force at rest (bcrypt, 10 rounds - tunable).
- Privilege escalation (roles enforced server-side, not just in the UI).
- SQL injection (100% prepared statements, no string concatenation).
- Duplicate/hijacked device identity on import (IMEI unique constraint +
  conflict report).
- Session token theft after logout (JWT TTL 12h; rotating `JWT_SECRET`
  invalidates all sessions instantly).

## Threat model - out of scope

- **DDoS / rate limiting** - put a WAF or Nginx `limit_req` in front if you
  expose the app on the open internet (not recommended).
- **Endpoint compromise** - a phished admin laptop can drain the database
  regardless of app-level controls. Enforce Conditional Access and
  device-compliance policies at the tenant.
- **Physical access to the server disk** - SQLite is not encrypted at rest.
  Use full-disk encryption on the host.

---

## Hardening checklist

- [ ] `JWT_SECRET` is 32+ random bytes, unique per deployment.
- [ ] The app is only reachable via HTTPS (reverse proxy).
- [ ] The Docker volume `./data` is writable only by UID `1000` (Docker)
      or the dedicated service user (Node direct).
- [ ] Local admin passwords are 12+ chars; rotate on employee turnover.
- [ ] For SSO deployments:
  - [ ] `SSO_ALLOWED_DOMAINS` restricts the tenants that can auto-provision.
  - [ ] `SSO_DEFAULT_ROLE=pending` - admins approve every new user.
  - [ ] A Conditional Access policy enforces MFA (Yubikey / Authenticator /
        Windows Hello for Business).
  - [ ] The client secret is rotated at least 6 months before its 24-month
        expiry.
- [ ] Nightly backups run and are copied off-host (see
      [INSTALL.md](INSTALL.md#backup--update)).
- [ ] Regular tests of the restore procedure.
- [ ] Server logs (`docker compose logs` or `journalctl`) are shipped to a
      central logging system with 90-day retention or more.
- [ ] Node.js is patched to the latest 20.x LTS (rebuild the image monthly).

---

## Cryptography summary

| Purpose               | Algorithm                                                                |
|-----------------------|--------------------------------------------------------------------------|
| Password hashing      | bcrypt, 10 rounds (`bcryptjs`).                                          |
| Session tokens        | HS256 JWT signed with `JWT_SECRET`, 12h TTL, verified server-side.       |
| SSO                   | OpenID Connect (authorization code + PKCE) against Entra ID v2.0 endpoint. |
| TLS                   | Terminated by the reverse proxy - pick TLS 1.2+ with modern ciphers.     |

---

## Reporting a vulnerability

Do **not** open a public issue with a proof of concept.

- Preferred: GitHub private vulnerability reporting (repository **Security** tab > **Report a vulnerability**).
- Alternative: email **ops@phoenix-tech.be** with the subject `Phoenix-Nexus security`.
- For an internal deployment of your own: also inform your IT security team.

Please include:

- Version affected (`package.json` `version` field).
- Deployment mode (Docker / Node direct).
- Steps to reproduce.
- Impact assessment.

We aim to acknowledge within 5 business days and to give a fix or mitigation plan within 30 days for confirmed issues.
