// Migrations de schema numerotees, avec sauvegarde automatique avant toute modification.
//
// Principes :
//  - La version du schema est tracee dans la table schema_migrations (historique complet : version, nom, date, version de l'application).
//  - La version 1 est la "ligne de base" : le schema cree par server/db.js (installations existantes comprises).
//  - Une migration = { version, name, up(db) }, declaree dans server/migrations/index.js. Elle s'execute dans UNE transaction :
//    tout ou rien. En cas d'erreur, la base reste telle quelle et l'application refuse de demarrer.
//  - Avant d'appliquer des migrations, la base est copiee (VACUUM INTO) : on garde les 5 dernieres copies.
//  - Une base plus recente que le code est REFUSEE (pas de retour arriere silencieux sur un schema inconnu).
import fs from 'fs';
import path from 'path';

export const BASELINE_VERSION = 1;
const KEEP_BACKUPS = 5;

export class MigrationError extends Error {}

export function validateMigrations(migrations) {
  let expected = BASELINE_VERSION + 1;
  for (const m of migrations) {
    if (!Number.isInteger(m.version) || typeof m.up !== 'function' || !m.name) {
      throw new MigrationError(`migration invalide : ${JSON.stringify({ version: m.version, name: m.name })}`);
    }
    if (m.version !== expected) {
      throw new MigrationError(`versions de migration non contigues : attendu ${expected}, trouve ${m.version}`);
    }
    expected++;
  }
  return migrations.length ? migrations[migrations.length - 1].version : BASELINE_VERSION;
}

const hasTable = (db, name) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');

export function backupDatabase(db, dbPath, tag, log = console.log) {
  if (!dbPath || dbPath === ':memory:') return null;
  const file = `${dbPath}.pre-${tag}-${stamp()}.bak`;
  if (fs.existsSync(file)) return file;
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  log(`[db] sauvegarde avant mise a jour : ${file}`);
  const dir = path.dirname(dbPath);
  const prefix = `${path.basename(dbPath)}.pre-`;
  const all = fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith('.bak')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(dir, old), { force: true });
  return file;
}

// Installation anterieure au systeme de migrations : on la copie avant que la ligne de base ne la modifie.
export function snapshotIfUnversioned(db, dbPath, log = console.log) {
  if (hasTable(db, 'schema_migrations')) return null;
  if (!hasTable(db, 'users') && !hasTable(db, 'assets') && !hasTable(db, 'ptx')) return null; // base neuve
  return backupDatabase(db, dbPath, 'baseline', log);
}

export function currentVersion(db) {
  if (!hasTable(db, 'schema_migrations')) return 0;
  return db.prepare('SELECT COALESCE(MAX(version), 0) v FROM schema_migrations').get().v;
}

export function runMigrations(db, { dbPath, migrations = [], appVersion = 'unknown', log = console.log } = {}) {
  const latest = validateMigrations(migrations);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')), app_version TEXT)`);
  const rec = db.prepare('INSERT INTO schema_migrations (version, name, app_version) VALUES (?, ?, ?)');

  let current = currentVersion(db);
  if (current === 0) { rec.run(BASELINE_VERSION, 'baseline', appVersion); current = BASELINE_VERSION; }

  if (current > latest) {
    throw new MigrationError(
      `La base de donnees est en version ${current}, plus recente que cette application (version ${latest}). ` +
      `Mettez l'application a jour, ou restaurez une sauvegarde (${dbPath}.pre-*.bak). Demarrage refuse pour proteger les donnees.`);
  }
  const pending = migrations.filter(m => m.version > current);
  if (!pending.length) return { from: current, to: current, applied: [], backup: null };

  const backup = backupDatabase(db, dbPath, `v${pending[0].version}`, log);
  const applied = [];
  for (const m of pending) {
    try {
      db.transaction(() => { m.up(db); rec.run(m.version, m.name, appVersion); })();
    } catch (e) {
      throw new MigrationError(
        `Migration ${m.version} (${m.name}) en echec : ${e.message}. La base n'a pas ete modifiee par cette migration.` +
        (backup ? ` Sauvegarde : ${backup}` : ''));
    }
    applied.push(m.version);
    log(`[db] migration ${m.version} appliquee : ${m.name}`);
  }
  return { from: current, to: latest, applied, backup };
}
