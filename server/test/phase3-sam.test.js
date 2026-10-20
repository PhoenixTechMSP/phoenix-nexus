import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DB_PATH = path.join(os.tmpdir(), `test-sam-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8102';
process.env.JWT_SECRET = 'test_secret_sam';
process.env.NODE_ENV = 'test';

const { startServer, seed, loginAs, authed } = await import('./helpers.js');
const { statusFor, upcomingRenewals } = await import('../lib/sam.js');

let base, close, db, mgr, staff, f;
const post = (url, token, body) => fetch(`${base}${url}`, { method: 'POST', headers: authed(token), body: JSON.stringify(body) });
const get = async (url, token = mgr) => (await fetch(`${base}${url}`, { headers: authed(token) })).json();
const isoIn = days => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

// Jeu de donnees controle : tous les chiffres attendus sont calcules A LA MAIN
// (pas recopies de la sortie du code), pour que le test puisse reellement echouer.
const ids = {};
async function mkProduct(key, name, metric) {
  const r = await post('/api/sam/products', mgr, { name, vendor: 'TestVendor', metric });
  ids[key] = (await r.json()).id;
}
async function mkEntitlement(key, quantity, annual_cost, renewal_date) {
  await post('/api/sam/entitlements', mgr, { product_id: ids[key], quantity, annual_cost, renewal_date });
}
const agentIds = [];
const assetIds = [];

before(async () => {
  ({ base, close } = await startServer());
  f = await seed(base);
  ({ db } = await import('../db.js'));
  mgr = await loginAs(base, 'manager');
  staff = await loginAs(base, 'staff');

  // 10 agents et 10 assets dedies a ces scenarios
  for (let i = 0; i < 10; i++) {
    agentIds.push(db.prepare(`INSERT INTO agents (matricule, first_name, last_name, department_id) VALUES (?,?,?,?)`)
      .run(`S-A${i}`, 'Agent', `N${i}`, f.deptId).lastInsertRowid);
    assetIds.push(db.prepare(`INSERT INTO assets (asset_code, category_id, status, department_id, quantity) VALUES (?,1,'in_use',?,1)`)
      .run(`S-AS${i}`, f.deptId).lastInsertRowid);
  }
  await mkProduct('over', 'P1 Over', 'named_user');
  await mkProduct('oversized', 'P2 Oversized', 'device');
  await mkProduct('limit', 'P3 Limit', 'device');
  await mkProduct('ok', 'P4 Ok', 'named_user');
  await mkProduct('unlic', 'P5 Unlicensed', 'named_user');

  await mkEntitlement('over', 4, 400, isoIn(20));        // 100 EUR / licence, renouvellement dans 20 j
  await mkEntitlement('oversized', 10, 1000, isoIn(60)); // 100 EUR / licence, dans 60 j
  await mkEntitlement('limit', 2, 200, isoIn(200));      // hors fenetre 90 j
  await mkEntitlement('ok', 10, 500, null);

  const inst = async (key, body) => (await post('/api/sam/installations', mgr, { product_id: ids[key], ...body })).status;
  for (let i = 0; i < 6; i++) assert.equal(await inst('over', { agent_id: agentIds[i] }), 200);
  for (let i = 0; i < 3; i++) assert.equal(await inst('oversized', { asset_id: assetIds[i] }), 200);
  for (let i = 0; i < 2; i++) assert.equal(await inst('limit', { asset_id: assetIds[i] }), 200);
  for (let i = 0; i < 8; i++) assert.equal(await inst('ok', { agent_id: agentIds[i] }), 200);
  assert.equal(await inst('unlic', { agent_id: agentIds[0] }), 200);
});

test('statusFor : les 5 cas, y compris les bornes', () => {
  assert.equal(statusFor(0, 1), 'unlicensed');
  assert.equal(statusFor(4, 6), 'over_deployed');
  assert.equal(statusFor(2, 2), 'limit_reached');
  assert.equal(statusFor(10, 3), 'oversized');
  assert.equal(statusFor(10, 6), 'oversized', '60 % : sous le seuil de 70 %');
  assert.equal(statusFor(10, 7), 'compliant', 'borne : 70 % exactement n\'est PAS en dessous du seuil');
  assert.equal(statusFor(10, 8), 'compliant');
  assert.equal(statusFor(0, 0), 'compliant', 'produit sans droit ni usage : rien a signaler');
});

test('position : statut, ecart, utilisation, economie et exposition par produit', async () => {
  const pos = await get('/api/sam/position');
  const by = name => pos.find(p => p.name === name);

  const over = by('P1 Over');
  assert.deepEqual([over.entitled, over.consumed, over.gap, over.status], [4, 6, -2, 'over_deployed']);
  assert.equal(over.exposure, 200);          // 2 licences manquantes x 100 EUR

  const big = by('P2 Oversized');
  assert.deepEqual([big.entitled, big.consumed, big.gap, big.status], [10, 3, 7, 'oversized']);
  assert.equal(big.utilisation, 0.3);
  assert.equal(big.potential_saving, 700);   // 7 licences inutilisees x 100 EUR

  assert.equal(by('P3 Limit').status, 'limit_reached');
  assert.equal(by('P4 Ok').status, 'compliant');
  assert.equal(by('P4 Ok').potential_saving, 0, 'conforme : pas de gaspillage chiffre');
  assert.equal(by('P5 Unlicensed').status, 'unlicensed');
});

test('synthese : chaque KPI correspond au calcul manuel', async () => {
  const s = await get('/api/sam/summary');
  assert.equal(s.products, 5);
  assert.equal(s.annual_cost, 2100);          // 400 + 1000 + 200 + 500
  assert.equal(s.savings_identified, 700);    // seul P2 est surdimensionne
  assert.equal(s.releasable_licences, 7);
  assert.equal(s.exposures, 2);               // P1 (sur-deploiement) + P5 (sans droit)
  assert.equal(s.exposure_amount, 200);
  // utilisation = consommation COUVERTE / droits = (4 + 3 + 2 + 8 + 0) / (4 + 10 + 2 + 10 + 0) = 17/26
  assert.equal(s.utilisation, 0.65);
  assert.equal(s.renewals_90d, 2);            // P1 (20 j) et P2 (60 j) ; P3 (200 j) exclu, P4 sans date
  assert.equal(s.renewals_90d_amount, 1400);  // 400 + 1000
});

test('renouvellements : fenetre de jours respectee, tri par date', async () => {
  const r90 = await get('/api/sam/renewals?days=90');
  assert.deepEqual(r90.map(r => r.product_name), ['P1 Over', 'P2 Oversized']);
  const r365 = await get('/api/sam/renewals?days=365');
  assert.deepEqual(r365.map(r => r.product_name), ['P1 Over', 'P2 Oversized', 'P3 Limit']);
  assert.equal(upcomingRenewals(90, '2030-01-01').length, 0, 'aucune echeance dans 90 j autour de 2030');
});

test('regle de metrique : contrat par utilisateur refuse un asset, contrat par appareil refuse un agent', async () => {
  const r1 = await post('/api/sam/installations', mgr, { product_id: ids.ok, asset_id: assetIds[9] });
  assert.equal(r1.status, 400);
  assert.match((await r1.json()).error, /counted per agent/);
  const r2 = await post('/api/sam/installations', mgr, { product_id: ids.limit, agent_id: agentIds[9] });
  assert.equal(r2.status, 400);
  assert.match((await r2.json()).error, /counted per asset/);
});

test('installation : agent ET asset, ou aucun des deux, est refuse', async () => {
  const both = await post('/api/sam/installations', mgr, { product_id: ids.ok, agent_id: agentIds[9], asset_id: assetIds[9] });
  const none = await post('/api/sam/installations', mgr, { product_id: ids.ok });
  assert.equal(both.status, 400);
  assert.equal(none.status, 400);
});

test('installation en double : 409 avec message propre, la consommation ne bouge pas', async () => {
  const before = (await get('/api/sam/position')).find(p => p.name === 'P4 Ok').consumed;
  const r = await post('/api/sam/installations', mgr, { product_id: ids.ok, agent_id: agentIds[0] });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'This licence is already assigned to that agent/asset');
  assert.equal((await get('/api/sam/position')).find(p => p.name === 'P4 Ok').consumed, before);
});

test('validation : quantite negative, cout negatif, date invalide, produit inconnu', async () => {
  assert.equal((await post('/api/sam/entitlements', mgr, { product_id: ids.ok, quantity: -1 })).status, 400);
  assert.equal((await post('/api/sam/entitlements', mgr, { product_id: ids.ok, quantity: 1, annual_cost: -5 })).status, 400);
  assert.equal((await post('/api/sam/entitlements', mgr, { product_id: ids.ok, quantity: 1, renewal_date: '2026-13-45' })).status, 400);
  assert.equal((await post('/api/sam/entitlements', mgr, { product_id: 99999, quantity: 1 })).status, 404);
  assert.equal((await post('/api/sam/products', mgr, { name: 'X', vendor: 'Y', metric: 'bogus' })).status, 400);
});

test('liberer une licence (supprimer une installation) fait baisser la consommation', async () => {
  const detail = await get(`/api/sam/products/${ids.over}`);
  assert.equal(detail.counted_by, 'agent');
  assert.equal(detail.installations.length, 6);
  const del = await fetch(`${base}/api/sam/installations/${detail.installations[0].id}`, { method: 'DELETE', headers: authed(mgr) });
  assert.equal(del.status, 200);
  const p = (await get('/api/sam/position')).find(x => x.name === 'P1 Over');
  assert.deepEqual([p.consumed, p.gap, p.exposure], [5, -1, 100]);
});

test('RBAC : staff lit la position mais ne peut rien creer ni supprimer', async () => {
  assert.equal((await fetch(`${base}/api/sam/position`, { headers: authed(staff) })).status, 200);
  assert.equal((await post('/api/sam/products', staff, { name: 'Z', vendor: 'Z', metric: 'device' })).status, 403);
  assert.equal((await post('/api/sam/entitlements', staff, { product_id: ids.ok, quantity: 1 })).status, 403);
  assert.equal((await post('/api/sam/installations', staff, { product_id: ids.ok, agent_id: agentIds[9] })).status, 403);
  assert.equal((await fetch(`${base}/api/sam/entitlements/1`, { method: 'DELETE', headers: authed(staff) })).status, 403);
});

test('sans jeton : 401', async () => {
  assert.equal((await fetch(`${base}/api/sam/summary`)).status, 401);
});

after(async () => { await close(); });
