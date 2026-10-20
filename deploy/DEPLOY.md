# Deploying the public demo

One Linux server, Docker, and a (sub)domain: about 15 minutes. The result is `https://demo.your-domain` with a valid
certificate (issued and renewed automatically), fictional data reset every night, and the shared demo accounts shown on the
login page.

```
visitor --HTTPS--> Caddy (ports 80/443)  --internal network-->  Phoenix-Nexus (not published on the host)
                   certificates, gzip, HSTS                      DEMO_MODE=1, TRUST_PROXY=1
```

## 1. What you need

| | |
|---|---|
| A Linux server | 1 vCPU and 1 GB of RAM are enough. Any VPS or VM with a public IP address. |
| Docker with the Compose plugin | See step 3. |
| Ports 80 and 443 open | In the provider's firewall **and** on the server. Port 80 is needed to obtain the certificate. |
| A subdomain | For example `demo.phoenix-tech.be`. The existing website is untouched: it only needs a link to the demo. |

A shared WordPress hosting plan usually cannot run Docker or Node. If the website lives on one, keep it there and point only
the subdomain at the server (step 2).

## 2. DNS

At the registrar or DNS host of the domain, add one record:

| Type | Name | Value |
|---|---|---|
| `A` | `demo` | the server's public IPv4 address |

Check that it has propagated before going further (it can take a few minutes):

```bash
getent hosts demo.phoenix-tech.be    # must print the server's IP address
```

If it prints nothing or another address, **wait**. Starting Caddy earlier makes the certificate request fail, and Let's Encrypt
rate-limits repeated failures.

## 3. Prepare the server (once)

The official Docker script supports Debian, Ubuntu, Fedora and RHEL alike:
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"      # log out and back in afterwards
docker compose version               # must print a version: the Compose plugin is installed by the script
```
Debian and Ubuntu may also need `sudo apt-get install -y git`; Fedora and RHEL `sudo dnf install -y git`.

Open the ports (skip what your system does not use):
```bash
sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp              # Ubuntu with ufw
sudo firewall-cmd --permanent --add-service={http,https} && sudo firewall-cmd --reload   # Fedora with firewalld
```

## 4. Deploy

Get the code onto the server. Once the repository is public:
```bash
sudo git clone https://github.com/PhoenixTechMSP/phoenix-nexus.git /opt/phoenix-nexus
sudo chown -R "$USER": /opt/phoenix-nexus
```
While it is still **private**, the server has no credentials to clone it. Either add a read-only deploy key (repository
`Settings`, `Deploy keys`) and clone with the `git@github.com:...` address, or copy the folder from your computer:
```bash
rsync -a --exclude node_modules --exclude .git --exclude data --exclude .env ./ user@SERVER:/opt/phoenix-nexus/
```
(`deploy/update.sh` then skips the `git pull` and only rebuilds: copy the new files again before each update.)
```bash
cd /opt/phoenix-nexus/deploy
cp .env.demo.example .env
```
Edit `.env` (it is ignored by git):

| Variable | Value |
|---|---|
| `DOMAIN` | `demo.phoenix-tech.be` |
| `ACME_EMAIL` | an address that receives certificate-expiry warnings |
| `JWT_SECRET` | the output of `openssl rand -hex 32` |
| `DEMO_PASSWORD` | the password of the shared demo accounts. **It is public** (shown on the login page): use nothing you use elsewhere. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | your **private** administrator account (12+ characters). Optional but recommended. |

```bash
docker compose -f docker-compose.demo.yml up -d --build
docker compose -f docker-compose.demo.yml ps        # both services "running", nexus "healthy"
```
The first build takes a few minutes. The server refuses to start with a missing, short or placeholder `JWT_SECRET`: if
`nexus` keeps restarting, read `docker compose -f docker-compose.demo.yml logs nexus`.

## 5. Verify (from your own computer, not the server)

```bash
node scripts/smoke.mjs https://demo.phoenix-tech.be
```
It must end with `29/29 controles OK, 0 FAIL`. It checks the page, the assets, HTTPS headers, both demo logins, every screen's
API, both Excel exports, the demo data, and that imports are disabled. It changes nothing (reads only, plus one deliberately
refused login). Run it after **every** deployment: it is the difference between "it started" and "it works".

Then open the URL in a browser, pick a demo account on the login page, and click through the screens once.

## 6. Reset the data every night

Visitors can change data. `DEMO_RESET_ON_START=1` wipes and refills the database each time the application starts, so a nightly
restart restores the demo:
```bash
sudo tee /etc/cron.d/nexus-demo-reset <<'EOF'
0 4 * * * root /opt/phoenix-nexus/deploy/reset-demo.sh >> /var/log/nexus-demo-reset.log 2>&1
EOF
```

## 7. Update

```bash
/opt/phoenix-nexus/deploy/update.sh        # pulls, rebuilds, restarts
node scripts/smoke.mjs https://demo.phoenix-tech.be    # from your computer
```
**Roll back** to a known good version: `git -C /opt/phoenix-nexus checkout <tag-or-commit>` then `deploy/update.sh`.

## 8. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Browser shows a certificate error or no HTTPS | DNS not propagated or port 80/443 closed. `docker compose -f docker-compose.demo.yml logs caddy` shows the ACME error. Fix the cause, then `docker compose -f docker-compose.demo.yml restart caddy`. |
| `nexus` restarts in a loop | `docker compose ... logs nexus`: usually a missing, short or placeholder `JWT_SECRET`, or a `DEMO_PASSWORD` under 8 characters. |
| `502 Bad Gateway` | The application is still starting (the first start seeds the data: up to ~30 s) or crashed. Check `ps` and `logs nexus`. |
| Everybody gets "Too many failed attempts" | The proxy is not trusted. The compose file sets `TRUST_PROXY=1`: do not publish the `nexus` port on the host, and do not remove that variable. |
| Smoke test fails on one line | The line names the endpoint. The same endpoint is covered by `npm test`: run it locally to reproduce. |

## 9. What is public, and what is protected

- **Public by design**: the two demo accounts and their password. They cannot administer users.
- **Private**: your administrator account. It is never listed on the login page, and the public password does not open it.
- **File imports are disabled** on the demo. The spreadsheet library used for imports has a known high-severity vulnerability with
  no fix on npm (see `CHANGELOG.md`, Security): on an instance anybody can log in to, uploads must not be possible.
- **Login attempts are limited** (8 failures per account and address, 40 per address, every 15 minutes).
- **Not covered**: there is no web application firewall, no Content-Security-Policy, and the limiter does not stop an attacker spread
  over many addresses. That is acceptable for a demo holding fictional data. It is not enough for a production instance holding
  customer data: harden it before hosting any.
