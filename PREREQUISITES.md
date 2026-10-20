# Prerequisites

This document lists everything you need before installing Phoenix-Nexus.
For step-by-step deployment instructions, see [INSTALL.md](INSTALL.md).

---

## 1. Hardware / VM sizing

The app is deliberately lightweight. A single small VM is enough for the
expected load (7 departments, ~277 devices, ~1,400 events/day).

| Resource | Minimum          | Recommended       |
|----------|------------------|-------------------|
| CPU      | 1 vCPU           | 2 vCPU            |
| RAM      | 512 MB           | 1–2 GB            |
| Disk     | 2 GB free        | 10 GB (logs+bkp)  |
| OS       | Any Linux, Windows Server 2019+, or macOS (dev only) |

SQLite scales well below ~1M events/table. Plan a data archival strategy if
you keep more than 2–3 years of event history online.

---

## 2. Software

### Option A - Docker (recommended)

- Docker Engine **20.10+** or Docker Desktop.
- `docker compose` v2 (bundled with recent Docker installs).
- Nothing else - the container ships all runtime dependencies.

### Option B - Node.js direct (no Docker)

- **Node.js 20 LTS** or newer.
- Native build toolchain for `better-sqlite3`:
  - Linux (Debian/Ubuntu): `apt install build-essential python3`
  - RHEL/Alma: `dnf groupinstall "Development Tools" && dnf install python3`
  - Windows: `npm install --global --production windows-build-tools`
    (or install "Desktop development with C++" via Visual Studio Build Tools).
- Optional: `systemd` (Linux) or `NSSM` (Windows) to run as a service.

### Reverse proxy (production)

Required as soon as the app is exposed beyond `localhost`:

- **HTTPS is mandatory** for the QR camera (`getUserMedia` refuses HTTP
  origins other than `localhost`) and for Entra ID SSO redirect URIs.
- Any reverse proxy works: **Nginx**, **Caddy**, **Traefik**, or **IIS**
  with URL Rewrite + ARR on Windows.

---

## 3. Network

| Direction     | Port | Purpose                                                       |
|---------------|------|---------------------------------------------------------------|
| Inbound LAN   | 443  | End-user access via the reverse proxy                         |
| Inbound LAN   | 8080 | Direct app port (behind the proxy; can be firewalled off)     |
| Outbound      | 443  | **Only if SSO is enabled** - reach `login.microsoftonline.com` and `graph.microsoft.com` |

The app itself makes **no other outbound calls**. It is safe to run in a
fully air-gapped intranet if SSO is disabled.

---

## 4. TLS certificate

For intranet deployments you have three options:

1. **Internal CA** (recommended in enterprise): issue a certificate for the
   chosen hostname (e.g. `ptx.intranet.local`) from your AD CS / PKI, and
   push the CA root to client machines via GPO.
2. **Let's Encrypt** with DNS-01 challenge if the hostname is publicly
   resolvable.
3. **Self-signed** for a quick pilot - expect browser warnings; not suitable
   for SSO because Entra ID rejects untrusted certs on redirect URIs.

---

## 5. DNS

Pick one intranet hostname and point it at the server's LAN IP:

```text
ptx.intranet.local    A    10.0.0.42
```

Use the same hostname for:
- the reverse proxy's `server_name` / IIS binding,
- the `SSO_REDIRECT_URI` env var,
- the redirect URI registered on the Entra ID App registration.

---

## 6. Microsoft Entra ID (only if SSO is enabled)

- A Microsoft 365 tenant.
- **Global Administrator** or **Application Administrator** role - required
  to create an App registration and grant admin consent for `User.Read`.
- (Recommended) **Conditional Access** license (Entra ID P1 or higher) to
  enforce MFA / phishing-resistant authentication on the app.

Values you will need to collect once the App registration is created:

- Directory (tenant) ID
- Application (client) ID
- A client secret (max lifetime 24 months - rotate before expiry)
- The exact redirect URI (must match `SSO_REDIRECT_URI` byte-for-byte)

Full walkthrough in [CONFIGURATION.md](CONFIGURATION.md#microsoft-entra-id-sso).

---

## 7. Data you will import

Before the first productive use, prepare two spreadsheets. Exact column
names accepted by the importer are documented in [API.md](API.md#import).

- **PTX list**: `ptx_code`, `imei`, `department_code`, `status` (optional).
- **Agents list**: `matricule`, `first_name`, `last_name`, `department_code`.

Import happens from the **Admin → Import** page after the first admin login.

---

## 8. Backup destination

The app writes to `data/ptx.db` inside the mounted volume. Provide either:

- a scheduled task that copies `data/backups/*.db.gz` off-host (SFTP, SMB,
  S3-compatible), or
- a host-level snapshot of the volume.

`scripts/backup.sh` produces gzipped hot backups and prunes files older
than 30 days. See [INSTALL.md](INSTALL.md#backup--update).
