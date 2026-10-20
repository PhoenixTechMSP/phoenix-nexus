import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DB_PATH = path.join(os.tmpdir(), `test-checkout-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8091';
process.env.JWT_SECRET = 'test_secret_checkout';
process.env.NODE_ENV = 'test';

const { startServer, seed, loginAs, authed } = await import('./helpers.js');

let base, close, fixtures, staffToken;

before(async () => {
  ({ base, close } = await startServer());
  fixtures = await seed(base);
  staffToken = await loginAs(base, 'staff');
});

test('check-out: happy path - asset passe de available à in_use', async () => {
  const res = await fetch(`${base}/api/assets/LT-001/check-out`, {
    method: 'POST',
    headers: authed(staffToken),
    body: JSON.stringify({ agent_id: fixtures.agentId, notes: 'test' }),
  });
  assert.equal(res.status, 200);

  const check = await fetch(`${base}/api/assets/lookup/LT-001`, { headers: authed(staffToken) });
  const asset = await check.json();
  assert.equal(asset.status, 'in_use');
});

test('check-out: un asset déjà en_use ne peut pas être re-sorti (409)', async () => {
  const res = await fetch(`${base}/api/assets/LT-001/check-out`, {
    method: 'POST',
    headers: authed(staffToken),
    body: JSON.stringify({ agent_id: fixtures.agentId }),
  });
  assert.equal(res.status, 409);
});

test('check-out: agent inexistant rejeté (400)', async () => {
  const res = await fetch(`${base}/api/assets/TEST-PPE-GLOVES/check-out`, {
    method: 'POST',
    headers: authed(staffToken),
    body: JSON.stringify({ agent_id: 999999 }),
  });
  assert.equal(res.status, 400);
});

test('check-out: asset inexistant rejeté (404)', async () => {
  const res = await fetch(`${base}/api/assets/DOES-NOT-EXIST/check-out`, {
    method: 'POST',
    headers: authed(staffToken),
    body: JSON.stringify({ agent_id: fixtures.agentId }),
  });
  assert.equal(res.status, 404);
});

test('check-in: statut de retour invalide rejeté (400)', async () => {
  const res = await fetch(`${base}/api/assets/LT-001/check-in`, {
    method: 'POST',
    headers: authed(staffToken),
    body: JSON.stringify({ status: 'not_a_real_status' }),
  });
  assert.equal(res.status, 400);
});

test('check-in: happy path - asset repasse available, agent détaché', async () => {
  const res = await fetch(`${base}/api/assets/LT-001/check-in`, {
    method: 'POST',
    headers: authed(staffToken),
    body: JSON.stringify({ status: 'available', notes: 'retour ok' }),
  });
  assert.equal(res.status, 200);

  const check = await fetch(`${base}/api/assets/lookup/LT-001`, { headers: authed(staffToken) });
  const asset = await check.json();
  assert.equal(asset.status, 'available');
});

test('check-in: un asset déjà available ne peut pas être re-rentré (409)', async () => {
  const res = await fetch(`${base}/api/assets/LT-001/check-in`, {
    method: 'POST',
    headers: authed(staffToken),
    body: JSON.stringify({ status: 'available' }),
  });
  assert.equal(res.status, 409);
});

test('check-in: un asset rendu "defective" garde ce statut (pas auto-remis available)', async () => {
  await fetch(`${base}/api/assets/TEST-PPE-GLOVES/check-out`, {
    method: 'POST', headers: authed(staffToken),
    body: JSON.stringify({ agent_id: fixtures.agentId }),
  });
  const res = await fetch(`${base}/api/assets/TEST-PPE-GLOVES/check-in`, {
    method: 'POST', headers: authed(staffToken),
    body: JSON.stringify({ status: 'defective', notes: 'écran cassé' }),
  });
  assert.equal(res.status, 200);
  const check = await fetch(`${base}/api/assets/lookup/TEST-PPE-GLOVES`, { headers: authed(staffToken) });
  const asset = await check.json();
  assert.equal(asset.status, 'defective');
});

after(async () => { await close(); });
