import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import Database from 'better-sqlite3';

process.env.DB_PATH = path.join(os.tmpdir(), `test-phase1-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8094';
process.env.JWT_SECRET = 'test_secret_phase1';
process.env.NODE_ENV = 'test';

const { startServer, seed, loginAs, authed } = await import('./helpers.js');

let base, close, fixtures, managerToken;

before(async () => {
  ({ base, close } = await startServer());
  fixtures = await seed(base);
  managerToken = await loginAs(base, 'manager');
});

test('equipment_class: catégories OT par défaut classées Infrastructure', async () => {
  const { db } = await import('../db.js');
  const plc = db.prepare(`SELECT equipment_class FROM categories WHERE code = 'PLC'`).get();
  const cctv = db.prepare(`SELECT equipment_class FROM categories WHERE code = 'CCTV'`).get();
  assert.equal(plc.equipment_class, 'Infrastructure');
  assert.equal(cctv.equipment_class, 'Infrastructure');
});

test('equipment_class: NETWORK classé Infrastructure malgré kind=IT (cas explicite ADR-001)', async () => {
  const { db } = await import('../db.js');
  const network = db.prepare(`SELECT equipment_class, kind FROM categories WHERE code = 'NETWORK'`).get();
  assert.equal(network.kind, 'IT');
  assert.equal(network.equipment_class, 'Infrastructure');
});

test('equipment_class: catégories nominatives usuelles (laptop) restent Nominative', async () => {
  const { db } = await import('../db.js');
  const laptop = db.prepare(`SELECT equipment_class FROM categories WHERE code = 'LAPTOP'`).get();
  assert.equal(laptop.equipment_class, 'Nominative');
});

test('check-out: émet un événement outbox asset.activated avec equipment_class dans le payload', async () => {
  const { db } = await import('../db.js');
  await fetch(`${base}/api/assets/LT-001/check-out`, {
    method: 'POST', headers: authed(managerToken),
    body: JSON.stringify({ agent_id: fixtures.agentId }),
  });
  const ev = db.prepare(
    `SELECT * FROM integration_events WHERE entity_type='asset' AND event_type='asset.activated' ORDER BY id DESC LIMIT 1`
  ).get();
  assert.ok(ev, 'aucun événement outbox trouvé après check-out');
  const payload = JSON.parse(ev.payload);
  assert.equal(payload.asset_code, 'LT-001');
  assert.equal(payload.equipment_class, 'Nominative'); // catégorie TESTLT du fixture, défaut Nominative
  // Phase 1 : aucun worker ne consommait encore (processed_at restait null).
  // Phase 2 a câblé processIntegrationEvents() juste après check-out (voir
  // routes/assets.js) - l'événement est donc désormais traité quasi
  // immédiatement. Assertion mise à jour en conséquence, pas une régression.
  assert.notEqual(ev.processed_at, null);
});

test('PATCH retired: émet un événement outbox asset.retired', async () => {
  const { db } = await import('../db.js');
  await fetch(`${base}/api/assets/${fixtures.assetConsumableId}`, {
    method: 'PATCH', headers: authed(managerToken),
    body: JSON.stringify({ status: 'retired' }),
  });
  const ev = db.prepare(
    `SELECT * FROM integration_events WHERE entity_type='asset' AND entity_id=? AND event_type='asset.retired'`
  ).get(fixtures.assetConsumableId);
  assert.ok(ev, 'aucun événement asset.retired trouvé après PATCH status=retired');
});

test('PATCH vers un statut non-retired n\'émet PAS d\'événement retired (pas de faux positif)', async () => {
  const { db } = await import('../db.js');
  const countBefore = db.prepare(`SELECT COUNT(*) AS n FROM integration_events WHERE event_type='asset.retired'`).get().n;
  await fetch(`${base}/api/assets/${fixtures.assetSerialId}`, {
    method: 'PATCH', headers: authed(managerToken),
    body: JSON.stringify({ notes: 'simple mise à jour de notes' }),
  });
  const countAfter = db.prepare(`SELECT COUNT(*) AS n FROM integration_events WHERE event_type='asset.retired'`).get().n;
  assert.equal(countAfter, countBefore);
});

after(async () => { await close(); });

// ---------------------------------------------------------------------------
// Test de migration séparé : simule une VRAIE instance existante (schéma
// d'avant Phase 1, sans equipment_class ni integration_events) pour vérifier
// que le démarrage de l'app migre proprement sans perte de données - pas
// juste "ça marche sur une base neuve".
// ---------------------------------------------------------------------------
test('migration: une base pré-Phase 1 est mise à niveau sans perte de données', async () => {
  const legacyDbPath = path.join(os.tmpdir(), `test-legacy-${Date.now()}-${process.pid}.db`);
  const legacyDb = new Database(legacyDbPath);

  // Reproduit un schéma minimal "avant Phase 1" : categories SANS equipment_class.
  legacyDb.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'IT' CHECK(kind IN ('IT','OT','BUSINESS')),
      consumable INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  legacyDb.prepare(`INSERT INTO categories (code, name, kind) VALUES ('LEGACY_PLC','Legacy PLC','OT')`).run();
  const beforeCount = legacyDb.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  legacyDb.close();

  // Démarre l'app réelle sur CETTE base "existante" - déclenche la migration idempotente.
  // Import frais nécessaire (module cache) - on passe par un vrai fichier .mjs temporaire
  // exécuté en sous-process (plus fiable qu'un eval inline multi-lignes échappé).
  const { execFileSync } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  const scriptPath = path.join(os.tmpdir(), `migration-check-${Date.now()}.mjs`);
  // pathToFileURL gère correctement la différence Windows (file:///C:/...)
  // vs Linux/macOS (file:///home/...) - jamais de concaténation de chemin
  // manuelle pour construire une URL de module (trouvé en se relisant après
  // la remarque sur le support multi-plateforme).
  const dbJsUrl = pathToFileURL(path.resolve('server/db.js')).href;
  fs.writeFileSync(scriptPath, [
    `process.env.DB_PATH = ${JSON.stringify(legacyDbPath)};`,
    `const { db } = await import(${JSON.stringify(dbJsUrl)});`,
    `const cols = db.prepare("PRAGMA table_info(categories)").all().map(c => c.name);`,
    `const row = db.prepare("SELECT * FROM categories WHERE code='LEGACY_PLC'").get();`,
    `const count = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;`,
    `console.log(JSON.stringify({ hasEquipmentClass: cols.includes('equipment_class'), row, count }));`,
  ].join('\n'));

  const out = execFileSync('node', [scriptPath], { encoding: 'utf8' });
  const result = JSON.parse(out.trim().split('\n').pop());
  fs.rmSync(scriptPath, { force: true });

  assert.equal(result.hasEquipmentClass, true, 'la colonne equipment_class doit apparaître après migration');
  assert.ok(result.row, 'la catégorie LEGACY_PLC pré-existante doit avoir survécu à la migration');
  assert.equal(result.row.equipment_class, 'Infrastructure', 'la catégorie OT existante doit être backfillée en Infrastructure');
  // La migration déclenche aussi le seed normal des 18 catégories par défaut sur
  // cette base "legacy" qui ne les avait pas encore - comportement attendu de
  // l'appli (seed idempotent à chaque démarrage), pas une perte de données :
  // ce qui compte est que LEGACY_PLC (vérifié ci-dessus) n'a pas disparu.
  assert.ok(result.count >= beforeCount, 'le nombre de catégories ne doit jamais diminuer pendant une migration');

  fs.rmSync(legacyDbPath, { force: true });
});
