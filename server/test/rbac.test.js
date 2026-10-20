import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DB_PATH = path.join(os.tmpdir(), `test-rbac-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8092';
process.env.JWT_SECRET = 'test_secret_rbac';
process.env.NODE_ENV = 'test';

const { startServer, seed, loginAs, authed } = await import('./helpers.js');

let base, close, fixtures, tokens = {};

before(async () => {
  ({ base, close } = await startServer());
  fixtures = await seed(base);
  for (const role of ['admin', 'manager', 'staff']) {
    tokens[role] = await loginAs(base, role);
  }
});

test('RBAC: staff NE PEUT PAS créer un asset (403)', async () => {
  const res = await fetch(`${base}/api/assets`, {
    method: 'POST', headers: authed(tokens.staff),
    body: JSON.stringify({ asset_code: 'LT-999', category_id: 1, department_id: fixtures.deptId }),
  });
  assert.equal(res.status, 403);
});

test('RBAC: manager PEUT créer un asset', async () => {
  const res = await fetch(`${base}/api/assets`, {
    method: 'POST', headers: authed(tokens.manager),
    body: JSON.stringify({ asset_code: 'LT-998', category_id: 1, department_id: fixtures.deptId }),
  });
  assert.equal(res.status, 200);
});

test('RBAC: staff NE PEUT PAS supprimer un asset (403) - admin seulement', async () => {
  const res = await fetch(`${base}/api/assets/${fixtures.assetSerialId}`, {
    method: 'DELETE', headers: authed(tokens.staff),
  });
  assert.equal(res.status, 403);
});

test('RBAC: manager NE PEUT PAS supprimer un asset (403) - admin seulement', async () => {
  const res = await fetch(`${base}/api/assets/${fixtures.assetSerialId}`, {
    method: 'DELETE', headers: authed(tokens.manager),
  });
  assert.equal(res.status, 403);
});

test('RBAC: staff NE PEUT PAS faire un restock (403)', async () => {
  const res = await fetch(`${base}/api/assets/TEST-PPE-GLOVES/restock`, {
    method: 'POST', headers: authed(tokens.staff),
    body: JSON.stringify({ quantity: 5 }),
  });
  assert.equal(res.status, 403);
});

test('RBAC: staff NE PEUT PAS envoyer un asset en réparation (403)', async () => {
  const res = await fetch(`${base}/api/assets/LT-001/repair-send`, {
    method: 'POST', headers: authed(tokens.staff),
    body: JSON.stringify({ repair_ticket: 'TCK-1', repair_vendor: 'ACME Repair' }),
  });
  assert.equal(res.status, 403);
});

test('RBAC: check-out/check-in restent ouverts à staff (choix de design intentionnel, pas un oubli)', async () => {
  const out = await fetch(`${base}/api/assets/LT-001/check-out`, {
    method: 'POST', headers: authed(tokens.staff),
    body: JSON.stringify({ agent_id: fixtures.agentId }),
  });
  assert.equal(out.status, 200);
  const back = await fetch(`${base}/api/assets/LT-001/check-in`, {
    method: 'POST', headers: authed(tokens.staff),
    body: JSON.stringify({ status: 'available' }),
  });
  assert.equal(back.status, 200);
});

test('RBAC: sans token du tout -> 401 partout', async () => {
  const res = await fetch(`${base}/api/assets`, { method: 'GET' });
  assert.equal(res.status, 401);
});

test('RBAC: token invalide/forgé -> 401', async () => {
  const res = await fetch(`${base}/api/assets`, {
    headers: { Authorization: 'Bearer ceci-nest-pas-un-vrai-token' },
  });
  assert.equal(res.status, 401);
});

after(async () => { await close(); });
