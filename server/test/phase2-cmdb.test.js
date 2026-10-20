import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DB_PATH = path.join(os.tmpdir(), `test-phase2-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8097';
process.env.JWT_SECRET = 'test_secret_phase2';
process.env.NODE_ENV = 'test';

const { startServer, seed, loginAs, authed } = await import('./helpers.js');

let base, close, fixtures, managerToken, staffToken;

before(async () => {
  ({ base, close } = await startServer());
  fixtures = await seed(base);
  managerToken = await loginAs(base, 'manager');
  staffToken = await loginAs(base, 'staff');
});

test('POC checkpoint : check-out crée bien un CI en CMDB (pas avant)', async () => {
  const before = await fetch(`${base}/api/cmdb/items`, { headers: authed(managerToken) });
  const itemsBefore = await before.json();
  assert.equal(itemsBefore.find(i => i.source_identifier === String(fixtures.assetSerialId)), undefined,
    'aucun CI ne doit exister avant le check-out');

  await fetch(`${base}/api/assets/LT-001/check-out`, {
    method: 'POST', headers: authed(managerToken),
    body: JSON.stringify({ agent_id: fixtures.agentId }),
  });

  const after = await fetch(`${base}/api/cmdb/items`, { headers: authed(managerToken) });
  const itemsAfter = await after.json();
  const ci = itemsAfter.find(i => i.source_identifier === String(fixtures.assetSerialId));
  assert.ok(ci, 'un CI doit exister après le check-out');
  assert.equal(ci.status, 'Active');
  assert.equal(ci.source_system, 'ITAM');
  assert.equal(ci.ci_type, 'PhysicalAsset');
});

test('POC checkpoint : retrait (PATCH retired) archive le CI, ne le supprime pas', async () => {
  await fetch(`${base}/api/assets/${fixtures.assetSerialId}`, {
    method: 'PATCH', headers: authed(managerToken),
    body: JSON.stringify({ status: 'retired' }),
  });
  const res = await fetch(`${base}/api/cmdb/items`, { headers: authed(managerToken) });
  const items = await res.json();
  const ci = items.find(i => i.source_identifier === String(fixtures.assetSerialId));
  assert.ok(ci, 'le CI doit toujours exister (archivé, pas supprimé)');
  assert.equal(ci.status, 'Archived');
});

test('idempotence : rejouer le même événement ne duplique pas le CI', async () => {
  const { db } = await import('../db.js');
  const { processIntegrationEvents } = await import('../lib/cmdb-sync.js');
  // Les événements sont déjà marqués traités par les tests précédents -
  // on en réinjecte un identique à la main pour vérifier l'upsert.
  db.prepare(`INSERT INTO integration_events (event_type, entity_type, entity_id, payload) VALUES
    ('asset.activated','asset',?,?)`).run(
    fixtures.assetSerialId,
    JSON.stringify({ asset_code: 'LT-001', equipment_class: 'Nominative', department_id: fixtures.deptId })
  );
  processIntegrationEvents();
  processIntegrationEvents(); // deuxième appel - ne doit rien faire (rien de nouveau à traiter)

  const count = db.prepare(
    `SELECT COUNT(*) AS n FROM configuration_items WHERE source_system='ITAM' AND source_identifier=?`
  ).get(String(fixtures.assetSerialId));
  assert.equal(count.n, 1, 'un seul CI, jamais de doublon même après plusieurs traitements');
});

test('un asset retiré sans jamais avoir été activé ne génère aucun CI fantôme', async () => {
  await fetch(`${base}/api/assets`, {
    method: 'POST', headers: authed(managerToken),
    body: JSON.stringify({ asset_code: 'NEVER-ACTIVATED', category_id: 1, department_id: fixtures.deptId }),
  });
  const list1 = await (await fetch(`${base}/api/assets`, { headers: authed(managerToken) })).json();
  const asset = list1.find(a => a.asset_code === 'NEVER-ACTIVATED');

  await fetch(`${base}/api/assets/${asset.id}`, {
    method: 'PATCH', headers: authed(managerToken),
    body: JSON.stringify({ status: 'retired' }),
  });

  const items = await (await fetch(`${base}/api/cmdb/items`, { headers: authed(managerToken) })).json();
  assert.equal(items.find(i => i.source_identifier === String(asset.id)), undefined,
    'pas de CI créé pour un asset qui n\'a jamais été check-out/activé');
});

test('relations CMDB : création réussie entre deux CI existants', async () => {
  await fetch(`${base}/api/assets/TEST-PPE-GLOVES/check-out`, {
    method: 'POST', headers: authed(managerToken),
    body: JSON.stringify({ agent_id: fixtures.agentId }),
  });
  const items = await (await fetch(`${base}/api/cmdb/items`, { headers: authed(managerToken) })).json();
  const ciA = items.find(i => i.source_identifier === String(fixtures.assetSerialId));
  const ciB = items.find(i => i.source_identifier === String(fixtures.assetConsumableId));

  const res = await fetch(`${base}/api/cmdb/relationships`, {
    method: 'POST', headers: authed(managerToken),
    body: JSON.stringify({ source_ci_id: ciA.id, target_ci_id: ciB.id, relationship_type: 'connected_to' }),
  });
  assert.equal(res.status, 200);

  const detail = await (await fetch(`${base}/api/cmdb/items/${ciA.id}`, { headers: authed(managerToken) })).json();
  assert.equal(detail.relationships.length, 1);
  assert.equal(detail.relationships[0].relationship_type, 'connected_to');
});

test('relations CMDB : le CI cible expose la relation en entrant (incoming)', async () => {
  const items = await (await fetch(`${base}/api/cmdb/items`, { headers: authed(managerToken) })).json();
  const ciA = items.find(i => i.source_identifier === String(fixtures.assetSerialId));
  const ciB = items.find(i => i.source_identifier === String(fixtures.assetConsumableId));
  const detailB = await (await fetch(`${base}/api/cmdb/items/${ciB.id}`, { headers: authed(managerToken) })).json();
  assert.equal(detailB.incoming.length, 1);
  assert.equal(detailB.incoming[0].source_label, ciA.label);
  assert.equal(detailB.relationships.length, 0, 'B ne pointe vers rien : aucune relation sortante');
});

test('rattrapage : un asset deja in_use sans CI recoit son CI au demarrage, une seule fois', async () => {
  const { db } = await import('../db.js');
  const { backfillActiveAssets } = await import('../lib/cmdb-sync.js');
  const cat = db.prepare('SELECT id FROM categories WHERE code = ?').get('PLC'); // Infrastructure
  const ins = db.prepare(
    `INSERT INTO assets (asset_code, category_id, status, department_id, quantity) VALUES (?,?,?,?,1)`
  );
  const legacyActive = ins.run('LEGACY-ACTIVE', cat.id, 'in_use', fixtures.deptId).lastInsertRowid;
  const legacyRetired = ins.run('LEGACY-RETIRED', cat.id, 'retired', fixtures.deptId).lastInsertRowid;
  const legacyAvail = ins.run('LEGACY-AVAILABLE', cat.id, 'available', fixtures.deptId).lastInsertRowid;

  const first = backfillActiveAssets();
  const second = backfillActiveAssets();
  assert.equal(first, 1, 'seul l\'asset in_use sans CI est rattrape');
  assert.equal(second, 0, 'idempotent : rien de plus au second passage');

  const ci = db.prepare(`SELECT * FROM configuration_items WHERE source_identifier = ?`).get(String(legacyActive));
  assert.ok(ci, 'CI cree pour l\'asset en service');
  assert.equal(ci.equipment_class, 'Infrastructure', 'la classe vient de la categorie (PLC)');
  assert.equal(ci.status, 'Active');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM configuration_items WHERE source_identifier IN (?,?)`)
    .get(String(legacyRetired), String(legacyAvail)).n, 0, 'ni retire ni disponible : pas de CI fantome');
});

test('relations CMDB : un doublon renvoie 409 avec un message propre, sans fuite SQL', async () => {
  const items = await (await fetch(`${base}/api/cmdb/items`, { headers: authed(managerToken) })).json();
  const ciA = items.find(i => i.source_identifier === String(fixtures.assetSerialId));
  const ciB = items.find(i => i.source_identifier === String(fixtures.assetConsumableId));
  const res = await fetch(`${base}/api/cmdb/relationships`, {
    method: 'POST', headers: authed(managerToken),
    body: JSON.stringify({ source_ci_id: ciA.id, target_ci_id: ciB.id, relationship_type: 'connected_to' }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'This relationship already exists');
  assert.ok(!/constraint|ci_relationships|sqlite/i.test(body.error), 'aucun detail interne SQLite ne doit fuiter');
});

test('relations CMDB : refuse une relation d\'un CI vers lui-même', async () => {
  const items = await (await fetch(`${base}/api/cmdb/items`, { headers: authed(managerToken) })).json();
  const ci = items[0];
  const res = await fetch(`${base}/api/cmdb/relationships`, {
    method: 'POST', headers: authed(managerToken),
    body: JSON.stringify({ source_ci_id: ci.id, target_ci_id: ci.id, relationship_type: 'self' }),
  });
  assert.equal(res.status, 400);
});

test('RBAC CMDB : staff peut lire les CI mais pas créer de relation', async () => {
  const read = await fetch(`${base}/api/cmdb/items`, { headers: authed(staffToken) });
  assert.equal(read.status, 200);
  const write = await fetch(`${base}/api/cmdb/relationships`, {
    method: 'POST', headers: authed(staffToken),
    body: JSON.stringify({ source_ci_id: 1, target_ci_id: 2, relationship_type: 'x' }),
  });
  assert.equal(write.status, 403);
});

after(async () => { await close(); });
