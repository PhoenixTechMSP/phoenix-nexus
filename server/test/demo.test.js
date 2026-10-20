import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DB_PATH = path.join(os.tmpdir(), `test-demo-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8113';
process.env.JWT_SECRET = 'test_secret_demo';
process.env.NODE_ENV = 'test';
process.env.DEMO_MODE = '1';
process.env.DEMO_PASSWORD = 'DemoPass2026';

const { startServer, seed, loginAs, authed } = await import('./helpers.js');
let base, close, manager;
before(async () => { ({ base, close } = await startServer()); await seed(base); manager = await loginAs(base, 'manager'); });
after(async () => { await close(); });

test('mode demo : /api/demo est PUBLIC (sans jeton) et expose les comptes et le mot de passe voulus', async () => {
  const r = await fetch(`${base}/api/demo`);
  assert.equal(r.status, 200, 'si 401 : la route est declaree apres app.use(\'/api\', catalogRouter)');
  const d = await r.json();
  assert.equal(d.enabled, true);
  assert.equal(d.password, 'DemoPass2026');
  assert.deepEqual(d.accounts.map(a => a.role).sort(), ['manager', 'staff']);
  assert.ok(!d.accounts.some(a => a.role === 'admin'), 'JAMAIS de compte admin expose');
});
test('mode demo : les imports de fichiers sont desactives (faille connue de xlsx), meme pour un manager', async () => {
  const form = new FormData(); form.append('file', new Blob(['asset_code,category\nX,LAPTOP\n'], { type: 'text/csv' }), 'a.csv');
  for (const url of ['/api/import/assets', '/api/import/agents', '/api/import/preview', '/api/import/commit']) {
    const r = await fetch(`${base}${url}`, { method: 'POST', headers: { Authorization: `Bearer ${manager}` }, body: form });
    assert.equal(r.status, 403, url);
    assert.match((await r.json()).error, /disabled on the demo instance/);
  }
});
test('mode demo : sans authentification l\'import est refuse (401 par l\'authentification, jamais un succes)', async () => {
  const r = await fetch(`${base}/api/import/assets`, { method: 'POST' });
  assert.ok([401, 403].includes(r.status), `statut ${r.status} : un import anonyme ne doit jamais reussir`);
});
test('mode demo : le reste de l\'application fonctionne normalement', async () => {
  assert.equal((await fetch(`${base}/api/assets`, { headers: authed(manager) })).status, 200);
  assert.equal((await fetch(`${base}/api/cmdb/items`, { headers: authed(manager) })).status, 200);
  const co = await fetch(`${base}/api/assets/LT-001/check-out`, { method: 'POST', headers: authed(manager), body: JSON.stringify({ agent_id: 1 }) });
  assert.equal(co.status, 200);
});
