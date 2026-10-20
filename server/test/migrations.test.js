import './clean-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations, validateMigrations, snapshotIfUnversioned, currentVersion, MigrationError } from '../lib/migrate.js';
import { migrations as realMigrations } from '../migrations/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const quiet = () => {};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-mig-'));
const open = dir => { const p = path.join(dir, 'ptx.db'); return { p, db: new Database(p) }; };
const baks = dir => fs.readdirSync(dir).filter(f => f.endsWith('.bak'));
const m2 = { version: 2, name: 'add_note', up: db => db.exec('ALTER TABLE t ADD COLUMN note TEXT') };
const m3 = { version: 3, name: 'add_tag', up: db => db.exec('ALTER TABLE t ADD COLUMN tag TEXT') };

test('migrations : base neuve = ligne de base enregistree, aucune sauvegarde inutile', () => {
  const dir = tmp(); const { p, db } = open(dir);
  const r = runMigrations(db, { dbPath: p, migrations: [], log: quiet });
  assert.deepEqual(r.applied, []); assert.equal(currentVersion(db), 1);
  assert.equal(db.prepare('SELECT name FROM schema_migrations WHERE version = 1').get().name, 'baseline');
  assert.equal(baks(dir).length, 0);
});

test('migrations : appliquees dans l\'ordre, historique tenu, sauvegarde AVANT modification', () => {
  const dir = tmp(); const { p, db } = open(dir);
  db.exec('CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (7)');
  runMigrations(db, { dbPath: p, migrations: [], log: quiet });
  const r = runMigrations(db, { dbPath: p, migrations: [m2, m3], appVersion: '9.9.9', log: quiet });
  assert.deepEqual(r.applied, [2, 3]); assert.equal(currentVersion(db), 3);
  assert.equal(db.prepare('SELECT app_version FROM schema_migrations WHERE version = 3').get().app_version, '9.9.9');
  assert.deepEqual(db.prepare('PRAGMA table_info(t)').all().map(c => c.name), ['id', 'note', 'tag']);
  const bak = new Database(path.join(dir, baks(dir)[0]), { readonly: true });
  assert.deepEqual(bak.prepare('PRAGMA table_info(t)').all().map(c => c.name), ['id'], 'la copie doit etre l\'etat d\'AVANT');
  assert.equal(bak.prepare('SELECT id FROM t').get().id, 7, 'les donnees sont dans la copie');
});

test('migrations : une migration en echec est annulee en entier, non enregistree, et l\'erreur le dit', () => {
  const dir = tmp(); const { p, db } = open(dir);
  db.exec('CREATE TABLE t (id INTEGER)');
  runMigrations(db, { dbPath: p, migrations: [], log: quiet });
  const bad = { version: 2, name: 'half_done', up: d => { d.exec('ALTER TABLE t ADD COLUMN a TEXT'); d.exec('SELECT * FROM table_inexistante'); } };
  assert.throws(() => runMigrations(db, { dbPath: p, migrations: [bad], log: quiet }), e => e instanceof MigrationError && /half_done/.test(e.message) && /Sauvegarde/.test(e.message));
  assert.equal(currentVersion(db), 1, 'non enregistree');
  assert.deepEqual(db.prepare('PRAGMA table_info(t)').all().map(c => c.name), ['id'], 'ALTER partiel annule');
  assert.equal(baks(dir).length, 1);
});

test('migrations : une base plus recente que le code est refusee et laissee intacte', () => {
  const dir = tmp(); const { p, db } = open(dir);
  db.exec('CREATE TABLE t (id INTEGER)');
  runMigrations(db, { dbPath: p, migrations: [], log: quiet });
  runMigrations(db, { dbPath: p, migrations: [m2], log: quiet });
  assert.throws(() => runMigrations(db, { dbPath: p, migrations: [], log: quiet }), /plus recente que cette application/);
  assert.equal(currentVersion(db), 2);
});

test('migrations : relance = aucune action ni nouvelle sauvegarde', () => {
  const dir = tmp(); const { p, db } = open(dir);
  db.exec('CREATE TABLE t (id INTEGER)');
  runMigrations(db, { dbPath: p, migrations: [m2], log: quiet });
  const n = baks(dir).length;
  const r = runMigrations(db, { dbPath: p, migrations: [m2], log: quiet });
  assert.deepEqual(r.applied, []); assert.equal(baks(dir).length, n);
});

test('migrations : seules les 5 dernieres sauvegardes sont gardees', () => {
  const dir = tmp(); const { p, db } = open(dir);
  db.exec('CREATE TABLE t (id INTEGER)');
  runMigrations(db, { dbPath: p, migrations: [], log: quiet });
  for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(dir, `ptx.db.pre-old${i}-2020010${i}T000000.bak`), 'x');
  const cols = ['a', 'b'].map((c, i) => ({ version: i + 2, name: c, up: d => d.exec(`ALTER TABLE t ADD COLUMN ${c} TEXT`) }));
  runMigrations(db, { dbPath: p, migrations: cols, log: quiet });
  assert.equal(baks(dir).length, 5);
});

test('migrations : registre valide (versions contigues, doublons et trous refuses)', () => {
  assert.doesNotThrow(() => validateMigrations(realMigrations));
  assert.throws(() => validateMigrations([m3]), /non contigues/);
  assert.throws(() => validateMigrations([m2, m2]), /non contigues/);
  assert.throws(() => validateMigrations([{ version: 2, name: '', up() {} }]), /invalide/);
});

test('migrations : installation anterieure (sans historique) copiee avant la ligne de base', () => {
  const dir = tmp(); const { p, db } = open(dir);
  db.exec('CREATE TABLE users (id INTEGER); INSERT INTO users VALUES (1)');
  const b = snapshotIfUnversioned(db, p, quiet);
  assert.ok(b && fs.existsSync(b));
  const fresh = open(tmp());
  assert.equal(snapshotIfUnversioned(fresh.db, fresh.p, quiet), null, 'base neuve : rien a copier');
});

test('db.js reel : une base de l\'ancienne version est mise a niveau, sauvegardee, versionnee, et redemarre sans rien refaire', () => {
  const dir = tmp(); const dbPath = path.join(dir, 'ptx.db');
  const old = new Database(dbPath);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT, name TEXT, role TEXT);
            INSERT INTO users (email, name, role) VALUES ('old@example.org', 'Ancien', 'admin');`);
  old.close();
  const script = path.join(dir, 'boot.mjs');
  fs.writeFileSync(script, `
    const { db } = await import(${JSON.stringify(path.join(ROOT, 'server', 'db.js'))});
    const v = db.prepare('SELECT MAX(version) v FROM schema_migrations').get().v;
    const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    console.log(JSON.stringify({ v, hasLang: cols.includes('language'), user: db.prepare('SELECT email FROM users').get().email }));
  `);
  const run = () => spawnSync(process.execPath, [script], { cwd: ROOT, env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' }, encoding: 'utf8' });
  const r1 = run(); assert.equal(r1.status, 0, r1.stderr);
  const out = JSON.parse(r1.stdout.split('\n').find(l => l.startsWith('{')));
  assert.deepEqual(out, { v: 1, hasLang: true, user: 'old@example.org' });
  assert.equal(baks(dir).length, 1, 'une copie avant la mise a niveau');
  const r2 = run(); assert.equal(r2.status, 0, r2.stderr);
  assert.equal(baks(dir).length, 1, 'le 2e demarrage ne copie pas a nouveau');
});
