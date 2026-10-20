# Installation guide

> **Naming note.** The product was renamed from Site Asset Manager to Phoenix-Nexus. A few
> technical identifiers keep their historical name on purpose, so that existing installations
> upgrade without any migration: the database file `ptx.db`, the Windows service `PTXFleet`
> (`UPDATE-WINDOWS.bat` uses it to find the installation) and the `ptx` system user. When
> upgrading a Docker install from a version before 2.0, run `docker compose down` first: the
> container is now called `phoenix-nexus`.

> **Windows, sans compétence technique ?** Utilisez l'installateur en un clic :
> [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md) (`INSTALL-WINDOWS.bat` installe
> Node.js, les dépendances, le service et le pare-feu automatiquement).

Deployment paths supported by this repository:


1. [Docker (recommended)](#1-docker-recommended)
2. [Node.js direct - Linux + systemd](#2-nodejs-direct--linux--systemd)
3. [Node.js direct - Windows Server + NSSM](#3-nodejs-direct--windows-server--nssm)
4. [Reverse proxy - Nginx](#4-reverse-proxy--nginx)
5. [Reverse proxy - IIS](#5-reverse-proxy--iis)
6. [First login & bootstrapping users](#6-first-login--bootstrapping-users)
7. [Backup & update](#7-backup--update)
8. [Troubleshooting](#8-troubleshooting)

Before you start, complete [PREREQUISITES.md](PREREQUISITES.md) and
[CONFIGURATION.md](CONFIGURATION.md) (env vars, SSO).

---

## 1. Docker (recommended)

```bash
unzip phoenix-nexus.zip && cd phoenix-nexus
cp .env.example .env
# Edit .env - required: JWT_SECRET (32+ random chars).
# Generate one with:  openssl rand -hex 32

docker compose up -d --build
docker compose logs -f
```

The container:

- exposes port `8080`,
- persists SQLite to `./data/ptx.db` on the host,
- runs as a non-root user (`ptx`).

Create the first admin:

```bash
docker exec -it phoenix-nexus node scripts/first-admin.js \
  admin@company.local "StrongPassword123!" "System Admin"
```

Open <http://localhost:8080>. For LAN / production, put an HTTPS reverse
proxy in front (see §4).

---

## 2. Node.js direct - Linux + systemd

Use this path when Docker is not permitted on the target VM.

```bash
sudo apt install -y nodejs npm build-essential python3
sudo useradd -r -s /usr/sbin/nologin ptx
sudo mkdir -p /opt/phoenix-nexus && sudo chown ptx:ptx /opt/phoenix-nexus
sudo -u ptx tar -xzf phoenix-nexus.tar.gz -C /opt/phoenix-nexus --strip-components=1

cd /opt/phoenix-nexus
sudo -u ptx npm install
sudo -u ptx npm run build
sudo -u ptx cp .env.example .env
sudo -u ptx nano .env         # set JWT_SECRET (and SSO_* if used)

# Create the first admin
sudo -u ptx node scripts/first-admin.js admin@company.local "Password!" "Admin"
```

Create `/etc/systemd/system/phoenix-nexus.service`:

```ini
[Unit]
Description=Phoenix-Nexus
After=network.target

[Service]
Type=simple
User=ptx
WorkingDirectory=/opt/phoenix-nexus
EnvironmentFile=/opt/phoenix-nexus/.env
Environment=NODE_ENV=production
Environment=DB_PATH=/opt/phoenix-nexus/data/ptx.db
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now phoenix-nexus
sudo journalctl -u phoenix-nexus -f
```

---

## 3. Node.js direct - Windows Server + NSSM

1. Install **Node.js 20 LTS** and the Visual Studio Build Tools ("Desktop
   development with C++").
2. Extract the archive to `C:\phoenix-nexus`.
3. PowerShell as Administrator:

   ```powershell
   cd C:\phoenix-nexus
   npm install
   npm run build
   Copy-Item .env.example .env
   notepad .env    # set JWT_SECRET (and SSO_* if used)

   node scripts/first-admin.js admin@company.local "Password!" "Admin"
   ```

4. Install as a Windows service with **NSSM** (<https://nssm.cc>):

   ```powershell
   nssm install PTXFleet "C:\Program Files\nodejs\node.exe" `
     "C:\phoenix-nexus\server\index.js"
   nssm set PTXFleet AppDirectory "C:\phoenix-nexus"
   nssm set PTXFleet AppEnvironmentExtra `
     "NODE_ENV=production" `
     "PORT=8080" `
     "DB_PATH=C:\phoenix-nexus\data\ptx.db" `
     "JWT_SECRET=<secret>" `
     "SSO_ENABLED=true" `
     "SSO_TENANT_ID=..." "SSO_CLIENT_ID=..." "SSO_CLIENT_SECRET=..." `
     "SSO_REDIRECT_URI=https://ptx.intranet.local/api/sso/callback"
   nssm set PTXFleet AppStdout "C:\phoenix-nexus\logs\stdout.log"
   nssm set PTXFleet AppStderr "C:\phoenix-nexus\logs\stderr.log"
   nssm start PTXFleet
   ```

---

## 4. Reverse proxy - Nginx

Minimal HTTPS configuration:

```nginx
server {
  listen 443 ssl http2;
  server_name ptx.intranet.local;

  ssl_certificate     /etc/ssl/ptx.crt;
  ssl_certificate_key /etc/ssl/ptx.key;

  client_max_body_size 10M;   # allow Excel imports

  location / {
    proxy_pass         http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto https;
  }
}

server {
  listen 80;
  server_name ptx.intranet.local;
  return 301 https://$host$request_uri;
}
```

Reload: `sudo nginx -t && sudo systemctl reload nginx`.

---

## 5. Reverse proxy - IIS

1. Install **URL Rewrite** and **Application Request Routing (ARR)**.
2. In IIS Manager → server node → **Application Request Routing Cache** →
   *Server Proxy Settings* → check **Enable proxy**.
3. Create a site bound to `https://ptx.intranet.local` with your certificate.
4. Add a URL Rewrite inbound rule:
   - Pattern: `(.*)`
   - Action: **Rewrite** → `http://localhost:8080/{R:1}`
   - Server variables: `HTTP_X_FORWARDED_PROTO = https`.
5. Increase `maxAllowedContentLength` in `web.config` to `10485760`
   (10 MB) for Excel imports.

---

## 6. First login & bootstrapping users

1. Sign in with the local admin created by `scripts/first-admin.js`.
2. Go to **Admin → Departments** and adjust the 7 seeded departments if
   needed (codes: `OPS SEC MNT LOG ADM CTL SUP`).
3. Go to **Admin → Import** and upload:
   - the PTX spreadsheet (device code + IMEI + department),
   - the agents spreadsheet.
4. Go to **Admin → Users** to create additional local accounts, or enable
   SSO (see [CONFIGURATION.md](CONFIGURATION.md#microsoft-entra-id-sso)).

### First SSO login (when `SSO_DEFAULT_ROLE=pending`)

1. The user clicks *Sign in with Microsoft 365* and completes MFA.
2. An account is auto-created with role `pending` / status `pending` - no
   app access yet.
3. An admin opens **Admin → Users**, assigns a role + department, sets
   status `active`.
4. The user signs in again - access granted.

---

## 7. Backup & update

Manual backup:

```bash
docker exec phoenix-nexus sh -c 'bash /app/scripts/backup.sh'
# or on Node direct:
bash scripts/backup.sh
```

Nightly cron on the host:

```cron
0 2 * * * cd /opt/phoenix-nexus && bash scripts/backup.sh >> /var/log/ptx-backup.log 2>&1
```

Restore:

```bash
docker compose stop ptx
gunzip -c data/backups/ptx-20260716-0200.db.gz > data/ptx.db
docker compose start ptx
```

Update to a new version:

```bash
bash scripts/backup.sh
# Replace the source files (keep ./data/ intact)
docker compose up -d --build
```

Schema migrations are **idempotent** (`server/db.js` uses
`CREATE TABLE IF NOT EXISTS` and additive `ALTER TABLE` guards). No manual
migration command.

---

## 8. Troubleshooting

| Symptom                                                     | Fix                                                                                                              |
|-------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| `AADSTS50011: redirect URI mismatch`                        | `SSO_REDIRECT_URI` must match the App registration byte-for-byte (scheme, host, port, path).                     |
| `AADSTS7000215: Invalid client secret`                      | Secret expired or copied with trailing spaces. Regenerate in Entra → Certificates & secrets.                     |
| SSO button not shown on `/login`                            | `GET /api/sso/status` should return `{ enabled: true }`. Check `SSO_ENABLED=true` and restart the service.       |
| After SSO login: "Account pending"                          | Expected with `SSO_DEFAULT_ROLE=pending`. Approve the user in **Admin → Users**.                                 |
| `better-sqlite3` build errors                               | Install Python 3 + a C/C++ toolchain (`build-essential` / Visual Studio Build Tools).                            |
| Camera does not start on the Scan page                      | The browser requires HTTPS (except on `localhost`). Put the app behind an HTTPS reverse proxy.                   |
| Locked out (no admin access)                                | Re-run `node scripts/first-admin.js` with the same email - the script UPSERTs and resets the admin's password.   |
| `EACCES` on `/data`                                         | Ensure the mounted volume is writable by UID `1000` (Docker) or by the `ptx` service user (Node direct).         |
| Excel import returns 413 / "payload too large"              | Raise `client_max_body_size` (Nginx) or `maxAllowedContentLength` (IIS) to at least 10 MB.                       |

For anything else, collect logs (`docker compose logs ptx` or
`journalctl -u phoenix-nexus`) and open an issue with the exact error message.
