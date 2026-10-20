# Upgrading Phoenix-Nexus

## Docker (recommended)

```bash
docker compose pull && docker compose up -d
```

Pin a version in your compose file (`image: ghcr.io/phoenixtechmsp/phoenix-nexus:2.1`) and change it when you choose to upgrade.

## What happens to your data

On startup the application compares the database schema version with its own:

- **Database older than the application**: pending migrations run, each in its own transaction (all or nothing). Before the first one, the database is copied to `ptx.db.pre-v<N>-<date>.bak` next to the database file. The last 5 copies are kept.
- **Installation from before numbered migrations**: copied once to `ptx.db.pre-baseline-<date>.bak`, then brought up to date.
- **Database newer than the application** (for example after rolling back to an older image): the application **refuses to start** and says so. Restore a `.bak` copy or run a newer version. It never guesses on a schema it does not know.
- **A migration fails**: the database is left unchanged by that migration, the application does not start, and the error names the migration and the backup file.

The history is in the `schema_migrations` table (version, name, date, application version).

## Rolling back

1. Stop the application.
2. Restore the `.bak` file you want over `ptx.db` (and delete `ptx.db-wal` / `ptx.db-shm`).
3. Start the previous image.

## For contributors

Add a migration in `server/migrations/` and register it in `server/migrations/index.js` (see the comment in that file). Never edit a published migration. Every migration needs a test.
