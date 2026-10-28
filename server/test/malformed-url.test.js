import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';

process.env.DB_PATH = path.join(os.tmpdir(), `test-malformed-${Date.now()}-${process.pid}.db`);
process.env.JWT_SECRET = 'test_secret_malformed_url';
process.env.NODE_ENV = 'test';

const { startServer } = await import('./helpers.js');
let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

// http.request n'normalise pas le chemin (fetch le ferait) : on envoie vraiment /%c0, comme les scanners.
const raw = (p) => new Promise((resolve, reject) => {
  const u = new URL(srv.base);
  http.get({ host: u.hostname, port: u.port, path: p }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => resolve({ status: r.statusCode, body: b })); }).on('error', reject);
});

test('URL mal formee (/%c0) : 400 sobre, sans trace d\'erreur dans la reponse', async () => {
  const r = await raw('/%c0');
  assert.equal(r.status, 400);
  assert.doesNotMatch(r.body, /URIError|decode_param|at .*node_modules/, 'la trace de l\'erreur ne doit pas fuiter');
});

test('URL mal formee sous /api : jamais d\'erreur 500 ni de trace, et le serveur continue de repondre', async () => {
  const r = await raw('/api/%c0');
  assert.ok([400, 401].includes(r.status), `attendu 400 ou 401 (non authentifie), recu ${r.status}`);
  assert.doesNotMatch(r.body, /URIError|decode_param|at .*node_modules/);
  assert.equal((await raw('/api/health')).status, 200);
});
