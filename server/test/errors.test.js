import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DB_PATH = path.join(os.tmpdir(), `test-errors-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8098';
process.env.JWT_SECRET = 'test_secret_errors';
process.env.NODE_ENV = 'test';

const { startServer, seed, loginAs, authed } = await import('./helpers.js');
const { friendlyDbError } = await import('../lib/errors.js');

let base, close, managerToken;

before(async () => {
  ({ base, close } = await startServer());
  await seed(base);
  managerToken = await loginAs(base, 'manager');
});

test('friendlyDbError : doublon unique nomme le champ sans exposer la table', () => {
  const e = Object.assign(new Error('UNIQUE constraint failed: agents.matricule'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
  assert.equal(friendlyDbError(e), 'A record with the same matricule already exists');
});

test('friendlyDbError : unicité composite liste les champs', () => {
  const e = Object.assign(new Error('UNIQUE constraint failed: t.a, t.b'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
  assert.equal(friendlyDbError(e), 'A record with the same a / b already exists');
});

test('friendlyDbError : erreur inconnue -> message générique, jamais le détail brut', () => {
  const orig = console.error; console.error = () => {};
  try {
    assert.equal(friendlyDbError(new Error('secret internal detail /var/db/x')), 'The request could not be completed');
  } finally { console.error = orig; }
});

test('endpoint hérité (agents) : matricule en double -> 409 propre, sans nom de table', async () => {
  const body = JSON.stringify({ first_name: 'A', last_name: 'B', matricule: 'DUP-1' });
  const r1 = await fetch(`${base}/api/agents`, { method: 'POST', headers: authed(managerToken), body });
  assert.equal(r1.status, 200);
  const r2 = await fetch(`${base}/api/agents`, { method: 'POST', headers: authed(managerToken), body });
  assert.equal(r2.status, 409);
  const { error } = await r2.json();
  assert.equal(error, 'A record with the same matricule already exists');
  assert.ok(!/agents\.|constraint/i.test(error));
});

test('endpoint hérité (assets) : code asset en double -> 409 propre', async () => {
  const r = await fetch(`${base}/api/assets`, {
    method: 'POST', headers: authed(managerToken),
    body: JSON.stringify({ asset_code: 'LT-001', category_id: 1 }),
  });
  assert.equal(r.status, 409);
  const { error } = await r.json();
  assert.match(error, /already exists/);
  assert.ok(!/assets\.|constraint/i.test(error));
});

after(async () => { await close(); });
