import './clean-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skip = process.platform === 'win32' ? 'le point d\'entree conteneur est un script sh (Docker/Linux)' : false;
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-first-'));

async function waitHealthy(port, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return true; } catch { /* pas encore pret */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}
// Lance le VRAI point d'entree du conteneur (scripts/docker-entrypoint.sh), sans JWT_SECRET sauf si fourni.
function boot(dir, port, extra = {}) {
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), DB_PATH: path.join(dir, 'ptx.db'), ...extra };
  const child = spawn('sh', ['scripts/docker-entrypoint.sh'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  const exited = new Promise(r => child.once('exit', code => r(code)));
  return { log: () => out, exited, stop: () => new Promise(r => {
    if (child.exitCode !== null || child.signalCode) return r();   // deja termine : rien a arreter (un 'exit' ne viendra plus)
    child.once('exit', r); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 3000);
  }) };
}
const login = async (port, email, password) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const generatedPassword = log => (log.match(/mot de passe : (\S+)/) || [])[1];

test('premier demarrage SANS aucune configuration : secret genere, admin cree, connexion possible', { skip }, async () => {
  const dir = tmpDir(), port = await freePort();
  const s = boot(dir, port);
  try {
    assert.ok(await waitHealthy(port), `le serveur n'ecoute pas : ${s.log()}`);
    const secretFile = path.join(dir, '.jwt_secret');
    assert.match(fs.readFileSync(secretFile, 'utf8'), /^[0-9a-f]{64}$/, 'secret fort de 64 caracteres hexadecimaux');
    assert.equal(fs.statSync(secretFile).mode & 0o077, 0, 'le fichier du secret n\'est lisible que par son proprietaire');
    const pwd = generatedPassword(s.log());
    assert.ok(pwd && pwd.length >= 12, `mot de passe genere absent des journaux : ${s.log()}`);
    const ok = await login(port, 'admin@phoenix-nexus.local', pwd);
    assert.equal(ok.status, 200); assert.ok(ok.body.token);
    assert.equal((await login(port, 'admin@phoenix-nexus.local', pwd + 'x')).status, 401);
  } finally { await s.stop(); }
});

test('redemarrage : meme secret, meme mot de passe, rien n\'est affiche ni recree', { skip }, async () => {
  const dir = tmpDir(), port = await freePort();
  const s1 = boot(dir, port);
  let pwd, secret1;
  try {
    assert.ok(await waitHealthy(port), s1.log());
    pwd = generatedPassword(s1.log()); secret1 = fs.readFileSync(path.join(dir, '.jwt_secret'), 'utf8');
  } finally { await s1.stop(); }
  const s2 = boot(dir, port);
  try {
    assert.ok(await waitHealthy(port), s2.log());
    assert.equal(fs.readFileSync(path.join(dir, '.jwt_secret'), 'utf8'), secret1, 'le secret ne change pas (sinon toutes les sessions sauteraient)');
    assert.equal(generatedPassword(s2.log()), undefined, 'le mot de passe n\'est affiche qu\'une fois');
    assert.doesNotMatch(s2.log(), /JWT_SECRET genere/);
    assert.equal((await login(port, 'admin@phoenix-nexus.local', pwd)).status, 200, 'le compte du premier demarrage est conserve');
  } finally { await s2.stop(); }
});

test('compte admin choisi (ADMIN_EMAIL / ADMIN_PASSWORD) : utilise tel quel, mot de passe jamais journalise', { skip }, async () => {
  const dir = tmpDir(), port = await freePort();
  const s = boot(dir, port, { ADMIN_EMAIL: 'Chef@Example.org', ADMIN_PASSWORD: 'UnMotDePasseSolide42' });
  try {
    assert.ok(await waitHealthy(port), s.log());
    assert.equal((await login(port, 'chef@example.org', 'UnMotDePasseSolide42')).status, 200);
    assert.doesNotMatch(s.log(), /UnMotDePasseSolide42/);
    assert.equal((await login(port, 'admin@phoenix-nexus.local', 'x')).status, 401, 'pas de second compte par defaut');
  } finally { await s.stop(); }
});

test('mot de passe admin trop court : le demarrage est refuse avec un message clair', { skip }, async () => {
  const dir = tmpDir(), port = await freePort();
  const s = boot(dir, port, { ADMIN_EMAIL: 'chef@example.org', ADMIN_PASSWORD: 'court' });
  const code = await Promise.race([s.exited, new Promise(r => setTimeout(() => r('timeout'), 20000))]);
  await s.stop();
  assert.equal(code, 1, s.log()); assert.match(s.log(), /12 caracteres minimum/);
});

test('SEED_SAMPLE=1 : donnees d\'exemple, mais ni mode demo, ni comptes publics, et jamais d\'effacement', { skip }, async () => {
  const dir = tmpDir(), port = await freePort();
  const env = { SEED_SAMPLE: '1', DEMO_RESET_ON_START: '1' };   // DEMO_RESET_ON_START ne doit RIEN effacer hors mode demo
  const s1 = boot(dir, port, env);
  let pwd;
  try {
    assert.ok(await waitHealthy(port), s1.log());
    pwd = generatedPassword(s1.log());
    const { body } = await login(port, 'admin@phoenix-nexus.local', pwd);
    const H = { authorization: `Bearer ${body.token}` };
    const assets = await (await fetch(`http://127.0.0.1:${port}/api/assets`, { headers: H })).json();
    assert.ok((assets.items || assets).length >= 10, 'des assets d\'exemple sont charges');
    const cmdb = await (await fetch(`http://127.0.0.1:${port}/api/cmdb/items`, { headers: H })).json();
    assert.ok((cmdb.items || cmdb).length >= 1, 'la CMDB est alimentee');
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/demo`)).json(), { enabled: false }, 'pas de mode demo');
    assert.equal((await login(port, 'demo-staff@demo.local', 'DemoPass2026')).status, 401, 'aucun compte public');
  } finally { await s1.stop(); }
  const s2 = boot(dir, port, env);
  try {
    assert.ok(await waitHealthy(port), s2.log());
    assert.equal((await login(port, 'admin@phoenix-nexus.local', pwd)).status, 200, 'le 2e demarrage n\'a pas efface la base');
  } finally { await s2.stop(); }
});

test('compose de production : image publiee, pas de demo, application non exposee, aucun secret par defaut', () => {
  const t = read('deploy/docker-compose.prod.yml');
  const nexus = t.split(/\n  caddy:/)[0];
  assert.match(nexus, /image: \$\{NEXUS_IMAGE:-ghcr\.io\/phoenixtechmsp\/phoenix-nexus:[0-9A-Za-z.\-]+\}/);
  assert.doesNotMatch(nexus, /\n\s+build:/, 'aucune construction chez le client');
  assert.doesNotMatch(nexus, /DEMO_MODE|DEMO_PASSWORD|DEMO_RESET/, 'ce compose n\'est pas la demo');
  assert.doesNotMatch(nexus, /\n\s+ports:/, 'l\'application n\'est pas publiee (condition de TRUST_PROXY)');
  assert.match(nexus, /TRUST_PROXY=1/);
  assert.match(nexus, /"JWT_SECRET=\$\{JWT_SECRET:-\}"/, 'secret vide = genere automatiquement');
  assert.doesNotMatch(t, /change_me|replace_with|dev_only|password123/i);
  const env = read('deploy/.env.prod.example');
  for (const k of ['ADMIN_PASSWORD', 'JWT_SECRET']) assert.match(env, new RegExp(`^${k}=$`, 'm'), `${k} vide dans le modele`);
  assert.match(env, /^SEED_SAMPLE=0$/m);
});

test('la version publiee dans le compose de production et le README est celle de package.json (aucune derive)', () => {
  const v = JSON.parse(read('package.json')).version;
  assert.match(read('deploy/docker-compose.prod.yml'), new RegExp(`phoenix-nexus:${v.replace(/\./g, '\\.')}\\}`));
  assert.match(read('README.md'), new RegExp(`ghcr\\.io/phoenixtechmsp/phoenix-nexus:${v.replace(/\./g, '\\.')}`));
  const readme = read('README.md');
  for (const needle of ['## Get started', 'docker run', 'docker-compose.prod.yml', 'SEED_SAMPLE=1', 'ADMIN_PASSWORD']) assert.ok(readme.includes(needle), `README sans "${needle}"`);
});
