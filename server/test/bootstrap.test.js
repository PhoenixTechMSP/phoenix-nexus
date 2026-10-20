import './clean-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const strongSecret = () => crypto.randomBytes(32).toString('hex');
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const tmpDb = () => path.join(os.tmpdir(), `boot-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
const cleanDb = f => ['', '-wal', '-shm'].forEach(s => fs.rmSync(f + s, { force: true }));

async function waitHealthy(port, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return true; } catch { /* pas encore pret */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}
function startReal(args, env) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  return { child, log: () => out, stop: () => new Promise(r => { child.once('exit', r); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 3000); }) };
}

// Les autres tests IMPORTENT l'app. Celui-ci lance le vrai point d'entree, comme le fait npm start, le
// service Windows ou Docker : c'est le seul moyen de voir un serveur qui ne se met jamais a ecouter.
test('DEMARRAGE REEL : node server/index.js ecoute et repond (mode production, vrai secret)', async () => {
  const port = await freePort(), db = tmpDb();
  const s = startReal(['server/index.js'], { NODE_ENV: 'production', PORT: String(port), DB_PATH: db, JWT_SECRET: strongSecret() });
  try {
    assert.ok(await waitHealthy(port), `le serveur n'ecoute pas : ${s.log()}`);
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  } finally { await s.stop(); cleanDb(db); }
});

test('DEMARRAGE REEL : en production, le secret d\'exemple public est refuse (le processus s\'arrete, code 1)', async () => {
  const port = await freePort(), db = tmpDb();
  const r = spawnSync(process.execPath, ['server/index.js'], { cwd: ROOT, encoding: 'utf8', timeout: 8000,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), DB_PATH: db, JWT_SECRET: 'replace_with_a_long_random_string_at_least_32_chars' } });
  cleanDb(db);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /FATAL: JWT_SECRET/);
});

test('AMORCAGE DEMO : refuse de demarrer sans DEMO_PASSWORD (code 1)', () => {
  const db = tmpDb();
  const r = spawnSync(process.execPath, ['scripts/demo-setup.js'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DB_PATH: db, DEMO_PASSWORD: '' } });
  cleanDb(db);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DEMO_PASSWORD/);
});

test('AMORCAGE DEMO : un mot de passe admin trop court est refuse', () => {
  const db = tmpDb();
  const r = spawnSync(process.execPath, ['scripts/demo-setup.js'], { cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, DB_PATH: db, DEMO_PASSWORD: 'DemoPass2026', ADMIN_EMAIL: 'ops@x.be', ADMIN_PASSWORD: 'court' } });
  cleanDb(db);
  assert.equal(r.status, 1);
});

test('AMORCAGE DEMO de bout en bout : demo-setup puis serveur de production, tout est utilisable',
  { skip: process.platform === 'win32' && 'entrypoint en sh : conteneur Linux uniquement' }, async () => {
  const port = await freePort(), db = tmpDb();
  const env = { NODE_ENV: 'production', PORT: String(port), DB_PATH: db, JWT_SECRET: strongSecret(), DEMO_MODE: '1',
                DEMO_PASSWORD: 'DemoPass2026', DEMO_RESET_ON_START: '1', ADMIN_EMAIL: 'ops@phoenix-tech.be', ADMIN_PASSWORD: 'UnAdminTresLong123' };
  // via l'entrypoint reel du conteneur (sh) : demo-setup puis exec node server/index.js
  const entry = spawn('sh', ['scripts/docker-entrypoint.sh'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; entry.stdout.on('data', d => log += d); entry.stderr.on('data', d => log += d);
  try {
    assert.ok(await waitHealthy(port, 30000), `entrypoint : le serveur n'ecoute pas\n${log}`);
    assert.match(log, /\[demo\] pret : 8 agents, 25 assets/);
    const B = `http://127.0.0.1:${port}`;
    const login = async (email, password) => (await fetch(`${B}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }));
    const m = await login('demo-manager@demo.local', 'DemoPass2026');
    assert.equal(m.status, 200, 'le compte manager de demo doit pouvoir se connecter');
    const token = (await m.json()).token, H = { Authorization: `Bearer ${token}` };
    assert.equal((await login('demo-staff@demo.local', 'DemoPass2026')).status, 200);
    assert.equal((await login('ops@phoenix-tech.be', 'UnAdminTresLong123')).status, 200, 'le compte admin PRIVE fonctionne');
    assert.equal((await login('ops@phoenix-tech.be', 'DemoPass2026')).status, 401, 'le mot de passe PUBLIC ne donne pas acces a l\'admin');

    const get = async u => (await fetch(`${B}${u}`, { headers: H })).json();
    const stats = await get('/api/events/stats');
    assert.ok(stats.daily.length >= 20, `tableau de bord : ${stats.daily.length} jours d'historique (attendu >= 20)`);
    const fc = await fetch(`${B}/api/events/forecast`, { headers: H });
    assert.equal(fc.status, 200, 'previsions');
    assert.ok((await fc.json()).byHour.length > 0, 'previsions : des donnees horaires doivent exister');
    assert.ok((await get('/api/cmdb/items')).length >= 10, 'CMDB peuplee');
    const sam = await get('/api/sam/summary');
    assert.equal(sam.annual_cost, 14730); assert.equal(sam.exposures, 2);
    assert.ok((await get('/api/assets')).length >= 25);
    const imp = await fetch(`${B}/api/import/assets`, { method: 'POST', headers: H });
    assert.equal(imp.status, 403, 'imports desactives en demo');
    assert.equal((await (await fetch(`${B}/api/demo`)).json()).enabled, true);

    // Le test de fumee livre (celui qu'on lance apres un deploiement) : succes ici, echec contre un port mort.
    // Les controles de la PAGE (HTML, JS, logo) exigent un client compile : on les lance seulement si dist/ existe
    // (sinon ils echouent a juste titre). Les controles d'API tournent dans tous les cas.
    const hasBuild = fs.existsSync(path.join(ROOT, 'dist', 'index.html'));
    const failures = r => r.stdout.split('\n').filter(l => l.startsWith('FAIL')).join('\n');
    const api = spawnSync(process.execPath, ['scripts/smoke.mjs', B, '--api-only'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    assert.equal(api.status, 0, `smoke.mjs --api-only a echoue sur une instance saine :\n${failures(api)}`);
    assert.match(api.stdout, /controles OK, 0 FAIL/);
    if (hasBuild) {
      const full = spawnSync(process.execPath, ['scripts/smoke.mjs', B], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
      assert.equal(full.status, 0, `smoke.mjs complet a echoue sur une instance saine :\n${failures(full)}`);
      assert.match(full.stdout, /page d'accueil servie/);
    }
    const dead = spawnSync(process.execPath, ['scripts/smoke.mjs', `http://127.0.0.1:${await freePort()}`], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    assert.equal(dead.status, 1, 'le test de fumee doit ECHOUER (code 1) quand rien n\'ecoute, sinon un deploiement casse passerait pour bon');
  } finally { entry.kill('SIGTERM'); await new Promise(r => { entry.once('exit', r); setTimeout(() => { entry.kill('SIGKILL'); r(); }, 3000); }); cleanDb(db); }
});
