import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DB_PATH = path.join(os.tmpdir(), `test-consrep-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8093';
process.env.JWT_SECRET = 'test_secret_consrep';
process.env.NODE_ENV = 'test';

const { startServer, seed, loginAs, authed } = await import('./helpers.js');

let base, close, fixtures, staffToken, managerToken;

before(async () => {
  ({ base, close } = await startServer());
  fixtures = await seed(base);
  staffToken = await loginAs(base, 'staff');
  managerToken = await loginAs(base, 'manager');
});

test('consume: réduit bien la quantité en stock', async () => {
  const res = await fetch(`${base}/api/assets/TEST-PPE-GLOVES/consume`, {
    method: 'POST', headers: authed(staffToken),
    body: JSON.stringify({ quantity: 3 }),
  });
  assert.equal(res.status, 200);
  const check = await fetch(`${base}/api/assets/lookup/TEST-PPE-GLOVES`, { headers: authed(staffToken) });
  const asset = await check.json();
  assert.equal(asset.quantity, 7); // 10 initial - 3
});

test('consume: quantité demandée > stock disponible -> 409', async () => {
  const res = await fetch(`${base}/api/assets/TEST-PPE-GLOVES/consume`, {
    method: 'POST', headers: authed(staffToken),
    body: JSON.stringify({ quantity: 999 }),
  });
  assert.equal(res.status, 409);
});

test('consume: quantité négative ou nulle rejetée (400)', async () => {
  const res = await fetch(`${base}/api/assets/TEST-PPE-GLOVES/consume`, {
    method: 'POST', headers: authed(staffToken),
    body: JSON.stringify({ quantity: -5 }),
  });
  assert.equal(res.status, 400);
});

test('restock: manager peut réapprovisionner, quantité augmente bien', async () => {
  const res = await fetch(`${base}/api/assets/TEST-PPE-GLOVES/restock`, {
    method: 'POST', headers: authed(managerToken),
    body: JSON.stringify({ quantity: 20 }),
  });
  assert.equal(res.status, 200);
  const check = await fetch(`${base}/api/assets/lookup/TEST-PPE-GLOVES`, { headers: authed(managerToken) });
  const asset = await check.json();
  assert.equal(asset.quantity, 27); // 7 restant + 20
});

test('repair-send: manager peut envoyer un asset en réparation, statut passe à repair', async () => {
  const res = await fetch(`${base}/api/assets/LT-001/repair-send`, {
    method: 'POST', headers: authed(managerToken),
    body: JSON.stringify({ repair_ticket: 'TCK-42', repair_vendor: 'ACME Repair', notes: 'écran HS' }),
  });
  assert.equal(res.status, 200);
  const check = await fetch(`${base}/api/assets/lookup/LT-001`, { headers: authed(managerToken) });
  const asset = await check.json();
  assert.equal(asset.status, 'repair');
  assert.equal(asset.repair_ticket, 'TCK-42');
  assert.equal(asset.repair_vendor, 'ACME Repair');
});

test('repair-return: asset revient de réparation avec un statut final valide', async () => {
  const res = await fetch(`${base}/api/assets/LT-001/repair-return`, {
    method: 'POST', headers: authed(managerToken),
    body: JSON.stringify({ status: 'available', notes: 'réparé' }),
  });
  assert.equal(res.status, 200);
  const check = await fetch(`${base}/api/assets/lookup/LT-001`, { headers: authed(managerToken) });
  const asset = await check.json();
  assert.equal(asset.status, 'available');
});

after(async () => { await close(); });
