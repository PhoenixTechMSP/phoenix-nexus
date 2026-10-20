import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

process.env.DB_PATH = path.join(os.tmpdir(), `test-importcsv-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8096';
process.env.JWT_SECRET = 'test_secret_importcsv';
process.env.NODE_ENV = 'test';

const { startServer, seed, loginAs } = await import('./helpers.js');

let base, close, adminToken;

before(async () => {
  ({ base, close } = await startServer());
  await seed(base);
  adminToken = await loginAs(base, 'admin');
});

async function uploadCsv(endpoint, filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'text/csv' }), path.basename(filePath));
  const res = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

test('import agents.csv - importe les agents valides, signale le département inconnu', async () => {
  const { status, body } = await uploadCsv('/api/import/agents', path.resolve('scripts/sample-import-agents.csv'));
  assert.equal(status, 200);
  assert.equal(body.imported, 11); // les 11 lignes créent un agent (le département inconnu n'empêche pas la création)
  const deptWarning = body.skipped.find(s => /DEPARTEMENT_INCONNU/i.test(s.reason || ''));
  assert.ok(deptWarning, 'le département inconnu doit être signalé dans skipped (avertissement, pas un rejet total)');
});

test('import assets.csv - importe les assets valides, rejette doublon et catégorie inconnue', async () => {
  const { status, body } = await uploadCsv('/api/import/assets', path.resolve('scripts/sample-import-assets.csv'));
  assert.equal(status, 200);
  assert.equal(body.inserted, 15); // 17 lignes - 1 doublon - 1 catégorie inconnue = 15 réellement créées
  const dup = body.skipped.find(s => /Duplicate code/i.test(s.reason || ''));
  const unknownCat = body.skipped.find(s => /Unknown category/i.test(s.reason || ''));
  assert.ok(dup, 'le doublon IMP-LT-102 doit être rejeté et signalé');
  assert.ok(unknownCat, 'la catégorie inconnue doit être rejetée et signalée');
});

test('import assets.csv - la catégorie donnée par nom complet (PTX / Handheld terminal) est résolue', async () => {
  const { db } = await import('../db.js');
  const asset = db.prepare(`SELECT * FROM assets WHERE asset_code = 'IMP-PTX-101'`).get();
  assert.ok(asset, 'IMP-PTX-101 doit avoir été importé');
  const cat = db.prepare('SELECT code FROM categories WHERE id = ?').get(asset.category_id);
  assert.equal(cat.code, 'PTX');
});

after(async () => { await close(); });
