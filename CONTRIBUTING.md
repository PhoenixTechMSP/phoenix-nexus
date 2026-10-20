# Contributing

Thank you for maintaining and extending Phoenix-Nexus. This guide keeps
future changes coherent with the rest of the codebase.

---

## 1. Development setup

```bash
# Clone / extract the project
cd phoenix-nexus

# Install dependencies (backend + frontend share package.json)
npm install

# Copy env template
cp .env.example .env
# Edit .env - at minimum set JWT_SECRET. Keep SSO_ENABLED=false in dev.

# Terminal 1 - API
npm run dev:server        # Node --watch, port 8080

# Terminal 2 - Frontend
npm run dev:client        # Vite dev server, port 5173, proxies /api → :8080

# Create a local admin
node scripts/first-admin.js dev@local.test "dev12345" "Dev Admin"
```

Open <http://localhost:5173>. The Vite proxy forwards every `/api/*` call
to the backend at `:8080`, so both hot reload and API changes work.

---

## 2. Conventions

### Language

- **All code, comments, commit messages, docs, and API contracts are in English.**
- The UI supports EN / FR / NL translations via `client/src/i18n/`.
  English (`en.json`) is the source of truth - add or rename keys there
  first, then translate.

### Backend

- ES modules (`"type": "module"` in `package.json`) - use `import`/`export`.
- Keep routers thin: validation → SQL → response. No ORM.
- Use **prepared statements** (`db.prepare(...).run(...)`). Never concatenate
  user input into SQL.
- Wrap multi-statement changes in `db.transaction(() => { ... })()`.
- Every mutation of `ptx` writes a row to `ptx_events` - the log must remain
  the source of truth for reporting.

### Frontend

- Function components, hooks only. No class components.
- Fetch through `client/src/lib/api.js` - it handles the JWT header and
  error unwrapping.
- Every user-visible string goes through `useTranslation()`. No hard-coded
  labels in JSX.
- Role-gated UI: check `user.role` from `localStorage.ptx_user` (parsed
  once at layout mount).

### Naming

- Files: `kebab-case.js` for backend, `PascalCase.jsx` for React pages/components.
- SQL identifiers: `snake_case`.
- HTTP paths: `/api/<plural-noun>` for collections, `/:id/<verb>` for actions.

---

## 3. Adding a feature - checklist

1. **Design first**: sketch the API contract in [API.md](API.md).
2. **Schema**: if new columns/tables are needed, add them in `server/db.js`
   with an idempotent `CREATE TABLE IF NOT EXISTS` and, for existing tables,
   an `ALTER TABLE` guarded by a `PRAGMA table_info` check (see the existing
   migration block for the pattern).
3. **Backend route**: add a router in `server/routes/`, mount it in
   `server/index.js`. Apply `requireRole(...)` explicitly.
4. **Frontend page/component**: use `lib/api.js`, gate by role, add i18n
   keys.
5. **Docs**: update [API.md](API.md), [ARCHITECTURE.md](ARCHITECTURE.md)
   (if the flow changes), [CHANGELOG.md](CHANGELOG.md).
6. **Manual test**: check-out and check-in flows must still work
   end-to-end; run a fresh Docker build and start.
7. **Backup compatibility**: restore a v1.x backup on top of the new
   schema - migrations must be non-destructive.

---

## 4. Database migrations

The project keeps migrations **idempotent and in-code** rather than using a
separate migration tool, so upgrades stay a `docker compose up -d --build`
away. Pattern:

```js
const cols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
if (!cols.includes('language')) {
  db.exec(`ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en'`);
}
```

Rules:

- **Additive only** across minor versions. Column drops require a major
  version bump and a documented data migration.
- New CHECK constraints on existing columns must be introduced by creating
  a new table, copying data, dropping the old table, renaming - SQLite does
  not support `ALTER TABLE … ADD CONSTRAINT`.
- Never delete existing rows in a migration.

---

## 5. Testing

The project ships without an automated test suite (intentional - keeps the
runtime footprint tiny). Before releasing:

- Manual smoke test of every page (Login, Scan, Inventory, Logs, Dashboard,
  Agents, Admin/Users, Admin/Import).
- SSO login when `SSO_ENABLED=true`.
- Excel import with a duplicate-IMEI file - confirm the conflict report.
- Restore a backup taken on the previous version.

Contributors are welcome to add a Vitest + Supertest suite; keep it in a
top-level `tests/` folder and wire it to `npm test`.

---

## 6. Commit / PR checklist

- [ ] Code is in English (identifiers, comments, log messages).
- [ ] i18n keys added to `en.json` **and** translated in `fr.json` /
      `nl.json` (empty translations are acceptable if flagged in the PR).
- [ ] `docker compose up -d --build` starts cleanly on a fresh volume.
- [ ] `docker compose up -d --build` also starts cleanly on top of an
      existing v1.x volume (migration path).
- [ ] `CHANGELOG.md` updated.
- [ ] `API.md` / `ARCHITECTURE.md` reflect any contract changes.
- [ ] No new external service dependency without discussion - the "single
      container, single file" property is a core value of the project.

---

## 7. Release process

1. Bump `version` in `package.json` and image tag in `docker-compose.yml`.
2. Update `CHANGELOG.md` with the release date and highlights.
3. Tag: `git tag v1.x.y && git push --tags`.
4. Publish the zip / tarball or Docker image per your organization's
   distribution channel.


---

## Licence of contributions

Phoenix-Nexus Community is released under AGPL-3.0-only, and Phoenix Tech MSP also offers it under a commercial licence (see COMMERCIAL.md).
By opening a pull request you confirm that you wrote the code (or have the right to submit it) and you grant Phoenix Tech MSP the right to distribute your contribution under the AGPL-3.0 and under the commercial licence. If you cannot agree to this, open an issue instead and describe the change.
