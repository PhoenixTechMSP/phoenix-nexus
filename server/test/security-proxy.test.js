import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DB_PATH = path.join(os.tmpdir(), `test-secproxy-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8112';
process.env.JWT_SECRET = 'test_secret_secproxy';
process.env.NODE_ENV = 'test';
process.env.TRUST_PROXY = '1';          // derriere UN proxy (Caddy) : on lit l'adresse reelle dans X-Forwarded-For

const { startServer, seed } = await import('./helpers.js');
let base, close;
before(async () => { ({ base, close } = await startServer()); await seed(base); });
after(async () => { await close(); });

const login = (email, ip, password = 'faux') => fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ email, password }),
});

// Sans TRUST_PROXY, req.ip serait celui du proxy pour TOUS les visiteurs : un seul attaquant bloquerait tout le monde.
test('derriere un proxy : le blocage est par client reel, pas par adresse du proxy', async () => {
  for (let i = 0; i < 8; i++) assert.equal((await login('admin@test.local', '203.0.113.1')).status, 401);
  assert.equal((await login('admin@test.local', '203.0.113.1')).status, 429, 'client 1 bloque');
  assert.equal((await login('admin@test.local', '203.0.113.2')).status, 401, 'client 2 : pas bloque, c\'est une autre adresse');
});
test('derriere un proxy : un visiteur legitime n\'est pas bloque par les echecs d\'un attaquant', async () => {
  for (let i = 0; i < 9; i++) await login('manager@test.local', '198.51.100.7');
  assert.equal((await login('manager@test.local', '192.0.2.50', 'Test1234!')).status, 200);
});
test('derriere un proxy : plafond par IP (balayage de comptes)', async () => {
  for (let i = 0; i < 40; i++) await login(`inconnu${i}@x.test`, '203.0.113.99');
  assert.equal((await login('encore-un-autre@x.test', '203.0.113.99')).status, 429);
});
