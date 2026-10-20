import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.DB_PATH = path.join(os.tmpdir(), `test-cmdbpaths-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8100';
process.env.JWT_SECRET = 'test_secret_cmdbpaths';
process.env.NODE_ENV = 'test';

const { startServer, seed, loginAs, authed } = await import('./helpers.js');

let base, close, fixtures, mgr, db;
const ciCount = (code) => db.prepare(
  `SELECT COUNT(*) AS n FROM configuration_items ci JOIN assets a ON CAST(a.id AS TEXT)=ci.source_identifier WHERE a.asset_code=?`
).get(code).n;

before(async () => {
  ({ base, close } = await startServer());
  fixtures = await seed(base);
  mgr = await loginAs(base, 'manager');
  ({ db } = await import('../db.js'));
});

test('édition de statut vers in_use (sans check-out) crée le CI', async () => {
  assert.equal(ciCount('LT-001'), 0);
  const r = await fetch(`${base}/api/assets/${fixtures.assetSerialId}`, {
    method: 'PATCH', headers: authed(mgr), body: JSON.stringify({ status: 'in_use' }),
  });
  assert.equal(r.status, 200);
  assert.equal(ciCount('LT-001'), 1);
});

test('création directe en in_use crée le CI', async () => {
  const r = await fetch(`${base}/api/assets`, {
    method: 'POST', headers: authed(mgr),
    body: JSON.stringify({ asset_code: 'DIRECT-INUSE', category_id: 1, department_id: fixtures.deptId, status: 'in_use' }),
  });
  assert.equal(r.status, 200);
  assert.equal(ciCount('DIRECT-INUSE'), 1);
});

test('création en available ne crée aucun CI', async () => {
  await fetch(`${base}/api/assets`, {
    method: 'POST', headers: authed(mgr),
    body: JSON.stringify({ asset_code: 'DIRECT-AVAIL', category_id: 1, department_id: fixtures.deptId, status: 'available' }),
  });
  assert.equal(ciCount('DIRECT-AVAIL'), 0);
});

test('import CSV de lignes in_use crée les CI, une seule fois même en réimportant', async () => {
  const csv = 'asset_code,category,status\nIMP-ACTIVE-1,LAPTOP,in_use\nIMP-IDLE-1,LAPTOP,available\n';
  const send = async () => {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'a.csv');
    return (await fetch(`${base}/api/import/assets`, { method: 'POST', headers: { Authorization: `Bearer ${mgr}` }, body: form })).json();
  };
  await send();
  assert.equal(ciCount('IMP-ACTIVE-1'), 1);
  assert.equal(ciCount('IMP-IDLE-1'), 0);
  await send();
  assert.equal(ciCount('IMP-ACTIVE-1'), 1, 'pas de doublon au second import');
});

test('import (chemin classique) : in_use, "in use" et IN-USE sont tous lus comme in_use', async () => {
  const csv = 'asset_code,category,status\nSTAT-A,LAPTOP,in_use\nSTAT-B,LAPTOP,in use\nSTAT-C,LAPTOP,IN-USE\nSTAT-D,LAPTOP,repair\nSTAT-E,LAPTOP,\n';
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 's.csv');
  await fetch(`${base}/api/import/assets`, { method: 'POST', headers: { Authorization: `Bearer ${mgr}` }, body: form });
  const st = code => db.prepare('SELECT status FROM assets WHERE asset_code=?').get(code).status;
  assert.equal(st('STAT-A'), 'in_use');
  assert.equal(st('STAT-B'), 'in_use');
  assert.equal(st('STAT-C'), 'in_use');
  assert.equal(st('STAT-D'), 'repair', 'les statuts a un seul mot ne sont pas affectes');
  assert.equal(st('STAT-E'), 'available', 'statut vide : valeur par defaut inchangee');
});

test('import guidé (commit réel) : le statut in_use est conservé et crée le CI', async () => {
  const form = new FormData();
  form.append('file', new Blob(['code,cat,etat\nGUIDED-1,LAPTOP,in_use\nGUIDED-2,LAPTOP,available\n'], { type: 'text/csv' }), 'g.csv');
  form.append('mapping', JSON.stringify({ fields: { asset_code: { column: 'code' }, category: { column: 'cat' }, status: { column: 'etat' } } }));
  const r = await fetch(`${base}/api/import/commit?target=assets&remember=0`, {
    method: 'POST', headers: { Authorization: `Bearer ${mgr}` }, body: form,
  });
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT status FROM assets WHERE asset_code='GUIDED-1'").get().status, 'in_use');
  assert.equal(ciCount('GUIDED-1'), 1);
  assert.equal(ciCount('GUIDED-2'), 0);
});

test('dry-run de l\'import guidé n\'écrit RIEN en CMDB', async () => {
  // Un asset in_use orphelin (sans CI) existe : un dry-run ne doit pas le "rattraper".
  db.prepare(`INSERT INTO assets (asset_code, category_id, status, quantity) VALUES ('ORPHAN-IN-USE', 1, 'in_use', 1)`).run();
  const form = new FormData();
  form.append('file', new Blob(['code,cat\nX-1,LAPTOP\n'], { type: 'text/csv' }), 'b.csv');
  form.append('mapping', JSON.stringify({ fields: { asset_code: { column: 'code' }, category: { column: 'cat' } } }));
  const r = await fetch(`${base}/api/import/commit?target=assets&dryRun=1`, {
    method: 'POST', headers: { Authorization: `Bearer ${mgr}` }, body: form,
  });
  assert.equal(r.status, 200);
  assert.equal(ciCount('ORPHAN-IN-USE'), 0, 'dry-run : aucune écriture CMDB');
});

after(async () => { await close(); });
