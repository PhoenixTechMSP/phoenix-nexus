# Contributing

Thank you for helping with Phoenix-Nexus Community. Bug reports, test results, fixes and small features are all welcome.

## What you can do

| You want to | Do this |
|---|---|
| Try it and tell us what breaks | Run it ([README, Get started](README.md#get-started)), then open a **bug report** with the version, steps and logs (remove secrets) |
| Report a security problem | **Do not open an issue.** See [SECURITY.md](SECURITY.md) |
| Fix a bug | Fork, branch, fix, add a test, open a pull request (details below) |
| Propose a feature | Open a **feature request** first, so we can agree on the scope before you write code |
| Improve the docs or a translation | Pull request directly. Typos and wording are welcome |

Pull requests are reviewed on a best-effort basis. Nobody pushes directly to `main`: every change goes through a pull request and a green CI.

## Scope

This repository is the Community edition (AGPL-3.0). We do not move a shipped Community feature out of Community ([ROADMAP.md](ROADMAP.md)). We do not add telemetry: an instance never sends data anywhere unless the administrator configures it.

## 1. Development setup

Node.js 22 is required (see [PREREQUISITES.md](PREREQUISITES.md)).

```bash
git clone https://github.com/<your-fork>/phoenix-nexus.git && cd phoenix-nexus
npm ci

# Option A: the whole app with sample data in one command (Docker or Podman)
docker run --rm -p 8080:8080 -e SEED_SAMPLE=1 $(docker build -q .)
# the administrator email and password are printed once in the output

# Option B: hot reload
cp .env.example .env   # set JWT_SECRET (openssl rand -hex 32)
npm run dev:server     # API on :8080 (Node --watch)
npm run dev:client     # Vite on :5173, proxies /api to :8080
npm run first-admin -- dev@local.test 'a-long-password' 'Dev Admin'
```

For a quick tour without an account of your own, run the demo setup: `DB_PATH=/tmp/nx.db DEMO_PASSWORD=demo12345 node scripts/demo-setup.js`, then start the server with `DEMO_MODE=1` and the same `DB_PATH` and `DEMO_PASSWORD`.

## 2. Tests: required for every fix

```bash
npm test               # server tests (API, security, migrations, first start, repository rules), no browser needed
npm run build && npm run test:e2e   # browser scenarios (needs python3 and Playwright with Chromium)
node scripts/smoke.mjs http://localhost:8080   # smoke test against a running instance
```

- **A bug fix comes with a test that fails without the fix.** Check it: revert your fix and confirm the test fails.
- Tests are hermetic: each one uses its own temporary database and a free port (see `server/test/helpers.js` and `clean-env.js`). Do not depend on your shell environment.
- The CI runs the same commands on every pull request. It must be green.

## 3. Conventions

- **Language**: code, comments, commit messages and API contracts are in English. The interface has English, French and Dutch (`client/src/i18n/`): add the key to `en.json` first, then translate `fr.json` and `nl.json` (flag empty translations in the pull request).
- **Backend**: ES modules, thin routers (validation, SQL, response), no ORM, **prepared statements only** (never concatenate user input into SQL), `db.transaction(...)` for multi-statement changes, roles enforced with `requireRole(...)`.
- **Frontend**: function components and hooks, fetch through `client/src/lib/api.js`, every visible string through `useTranslation()`. Colours come from the theme tokens in `client/src/styles.css` (no hard-coded light backgrounds: a test checks contrast in both themes).
- **Audit trail**: every asset mutation writes a row to `asset_events`. The log is the source of truth for reporting.
- **ITAM to CMDB** is one-way (see [ARCHITECTURE.md](ARCHITECTURE.md)). Do not write back from the CMDB to the inventory.
- **No new external service** without discussion: one container and one SQLite file is a core property.
- Naming: `kebab-case.js` (backend), `PascalCase.jsx` (React), `snake_case` (SQL), `/api/<plural-noun>` (HTTP).

## 4. Database changes

Schema changes use **numbered migrations**: add `server/migrations/00N_name.js`, register it in `server/migrations/index.js` and add a test in `server/test/migrations.test.js`. Each migration runs in one transaction, after an automatic backup. Never edit a migration that has been released. Rules: additive across minor versions, never delete existing rows, and tables with new constraints are rebuilt (SQLite has no `ADD CONSTRAINT`). See [UPGRADING.md](UPGRADING.md).

## 5. Adding a feature: checklist

1. Agree on the scope in an issue. Sketch the API contract in [API.md](API.md).
2. Migration if the schema changes (section 4).
3. Backend route in `server/routes/`, mounted in `server/index.js`.
4. Frontend page or component, with roles and translations.
5. Tests (server, and a browser scenario if the user flow changes).
6. Update `API.md`, `ARCHITECTURE.md` if the flow changes, and `CHANGELOG.md`.

## 6. Pull request checklist

- [ ] `npm test` passes locally, and the new test fails without the change.
- [ ] No secret, `.env` or database file is included (the repository tests fail if git tracks one).
- [ ] Translations added in `en`, `fr` and `nl`.
- [ ] `CHANGELOG.md` updated, documentation updated.
- [ ] A fresh start works (`docker run ... -e SEED_SAMPLE=1`).

## 7. Releases

Maintainers only: see [RELEASING.md](RELEASING.md).

## Licence of contributions

Phoenix-Nexus Community is released under AGPL-3.0-only, and Phoenix Tech MSP also offers it under a commercial licence (see [COMMERCIAL.md](COMMERCIAL.md)).
By opening a pull request you confirm that you wrote the code (or have the right to submit it) and you grant Phoenix Tech MSP the right to distribute your contribution under the AGPL-3.0 and under the commercial licence. If you cannot agree to this, open an issue instead and describe the change.
