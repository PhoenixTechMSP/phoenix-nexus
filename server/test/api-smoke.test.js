import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DB_PATH = path.join(os.tmpdir(), `test-apismoke-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8110';
process.env.JWT_SECRET = 'test_secret_apismoke';
process.env.NODE_ENV = 'test';

const { startServer, seed, loginAs, authed } = await import('./helpers.js');

let base, close, fixtures, tokens = {};

before(async () => {
  ({ base, close } = await startServer());
  fixtures = await seed(base);
  for (const role of ['admin', 'manager', 'staff']) tokens[role] = await loginAs(base, role);
  // Des donnees REELLES dans les journaux : un 500 de SQL (colonne ambigue, jointure) n'apparait souvent
  // qu'avec des evenements, et la page Previsions affichait un ecran vide sans le moindre message.
  const m = tokens.manager;
  await fetch(`${base}/api/assets/LT-001/check-out`, { method: 'POST', headers: authed(m), body: JSON.stringify({ agent_id: fixtures.agentId }) });
  await fetch(`${base}/api/assets/LT-001/check-in`, { method: 'POST', headers: authed(m), body: JSON.stringify({ status: 'available' }) });
  await fetch(`${base}/api/assets/TEST-PPE-GLOVES/consume`, { method: 'POST', headers: authed(m), body: JSON.stringify({ quantity: 2 }) });
});

// Toute route que l'interface appelle en lecture. Un 500 ici est un ecran casse en production.
const READ_ENDPOINTS = [
  '/api/health', '/api/demo', '/api/auth/me', '/api/departments', '/api/categories', '/api/assets', '/api/agents',
  '/api/events', '/api/events/stats', '/api/events/stats?days=7', '/api/events/fleet-snapshot',
  '/api/events/forecast', '/api/events/forecast?days=14', '/api/events/forecast?days=365&kind=IT',
  '/api/cmdb/items', '/api/sam/summary', '/api/sam/position', '/api/sam/renewals',
];

for (const url of READ_ENDPOINTS) {
  test(`GET ${url} : 200 et du JSON (jamais une page d'erreur)`, async () => {
    const res = await fetch(`${base}${url}`, { headers: authed(tokens.manager) });
    const text = await res.text();
    assert.equal(res.status, 200, `statut ${res.status} : ${text.slice(0, 160)}`);
    assert.doesNotThrow(() => JSON.parse(text), 'la reponse doit etre du JSON, pas du HTML');
  });
}

test('previsions : filtrer par departement fonctionne aussi (le filtre ajoute une clause SQL)', async () => {
  const res = await fetch(`${base}/api/events/forecast?department_id=${fixtures.deptId}`, { headers: authed(tokens.manager) });
  assert.equal(res.status, 200);
});

test('previsions : la forme de la reponse correspond a ce que la page lit', async () => {
  const d = await (await fetch(`${base}/api/events/forecast`, { headers: authed(tokens.manager) })).json();
  for (const key of ['byHour', 'byWeekday', 'daily', 'weekly']) assert.ok(Array.isArray(d[key]), `${key} doit etre un tableau`);
  assert.ok(d.daily.length >= 1, 'les evenements crees dans before() doivent apparaitre');
});

for (const url of ['/api/events/export.xlsx', '/api/events/fleet-export.xlsx']) {
  test(`export ${url} : un vrai fichier Excel (archive zip), pas une erreur`, async () => {
    const res = await fetch(`${base}${url}`, { headers: authed(tokens.manager) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /spreadsheet|octet-stream/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString(), 'PK', 'un .xlsx est une archive zip : doit commencer par PK');
    assert.ok(buf.length > 1000);
  });
}

test('administration : /api/users reserve a admin (200 admin, 403 manager et staff)', async () => {
  assert.equal((await fetch(`${base}/api/users`, { headers: authed(tokens.admin) })).status, 200);
  assert.equal((await fetch(`${base}/api/users`, { headers: authed(tokens.manager) })).status, 403);
  assert.equal((await fetch(`${base}/api/users`, { headers: authed(tokens.staff) })).status, 403);
});

test('une route inconnue sous /api ne renvoie jamais de HTML d\'erreur serveur', async () => {
  const res = await fetch(`${base}/api/ceci-nexiste-pas`, { headers: authed(tokens.manager) });
  assert.notEqual(res.status, 500);
});

after(async () => { await close(); });
