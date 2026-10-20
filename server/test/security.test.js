import './clean-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

process.env.DB_PATH = path.join(os.tmpdir(), `test-security-${Date.now()}-${process.pid}.db`);
process.env.PORT = '8111';
process.env.JWT_SECRET = 'test_secret_security';
process.env.NODE_ENV = 'test';
// IMPORTANT : pas de TRUST_PROXY ici (voir security-proxy.test.js pour le cas avec proxy).

const { startServer, seed, loginAs } = await import('./helpers.js');
const { secretProblem, createLoginLimiter, isMainModule } = await import('../lib/security.js');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

// ---------------------------------------------------------------- secrets en production
test('secretProblem : accepte un vrai secret aleatoire (openssl rand -hex 32)', () => {
  assert.equal(secretProblem(crypto.randomBytes(32).toString('hex')), null);
  assert.equal(secretProblem(crypto.randomBytes(48).toString('base64')), null);
});

test('secretProblem : refuse absent, court, valeurs d\'exemple PUBLIQUES et faible entropie', () => {
  assert.match(secretProblem(undefined), /must be set/);
  assert.match(secretProblem('abc123'), /too short/);
  assert.match(secretProblem('replace_with_a_long_random_string_at_least_32_chars'), /placeholder/, 'valeur de .env.example');
  assert.match(secretProblem('change_me_in_production_please_ok_ok_ok'), /placeholder/, 'ancien defaut du docker-compose');
  assert.match(secretProblem('dev_only_change_me_dev_only_change_me'), /placeholder/);
  assert.match(secretProblem('a'.repeat(40)), /entropy/);
  assert.match(secretProblem('ab'.repeat(20)), /entropy/);
});

test('les valeurs d\'exemple reellement presentes dans le depot sont toutes refusees', () => {
  const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8').match(/^JWT_SECRET=(.+)$/m)[1];
  assert.ok(secretProblem(envExample), `.env.example contient ${envExample} : doit etre refuse en production`);
});

function runWithSecret(secret, env = {}) {
  const f = path.join(os.tmpdir(), `authcheck-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(f, `await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'server', 'middleware', 'auth.js')).href)});\nconsole.log('DEMARRE');`);
  const e = { ...process.env, NODE_ENV: 'production', ...env };
  if (secret === undefined) delete e.JWT_SECRET; else e.JWT_SECRET = secret;
  const r = spawnSync(process.execPath, [f], { env: e, encoding: 'utf8' });
  fs.rmSync(f, { force: true });
  return r;
}

test('PRODUCTION : le serveur refuse de demarrer avec le secret d\'exemple (code 1, message clair)', () => {
  const r = runWithSecret('replace_with_a_long_random_string_at_least_32_chars');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FATAL: JWT_SECRET looks like a placeholder/);
  assert.doesNotMatch(r.stdout, /DEMARRE/);
});
test('PRODUCTION : refuse aussi l\'absence de secret et un secret court', () => {
  assert.equal(runWithSecret(undefined).status, 1);
  assert.equal(runWithSecret('trop-court').status, 1);
});
test('PRODUCTION : demarre avec un vrai secret aleatoire', () => {
  const r = runWithSecret(crypto.randomBytes(32).toString('hex'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DEMARRE/);
});
test('HORS production (dev, tests) : un secret faible reste accepte (confort de developpement)', () => {
  const r = runWithSecret('abc', { NODE_ENV: 'development' });
  assert.equal(r.status, 0, r.stderr);
});

// ---------------------------------------------------------------- limiteur (unite, horloge simulee)
test('limiteur : bloque apres 8 echecs pour une paire IP+email, debloque apres la fenetre', () => {
  let t = 1_000_000; const L = createLoginLimiter({ now: () => t });
  for (let i = 0; i < 7; i++) L.fail('1.1.1.1', 'k');
  assert.equal(L.blockedFor('1.1.1.1', 'k'), 0, '7 echecs : pas encore bloque');
  L.fail('1.1.1.1', 'k');
  assert.ok(L.blockedFor('1.1.1.1', 'k') > 0, '8e echec : bloque');
  t += 14 * 60 * 1000; assert.ok(L.blockedFor('1.1.1.1', 'k') > 0, 'encore bloque a 14 min');
  t += 61 * 1000;      assert.equal(L.blockedFor('1.1.1.1', 'k'), 0, 'debloque apres 15 min');
});
test('limiteur : un succes efface le compteur de la paire', () => {
  const L = createLoginLimiter({ now: () => 1 });
  for (let i = 0; i < 5; i++) L.fail('ip', 'k');
  L.reset('k');
  for (let i = 0; i < 7; i++) L.fail('ip', 'k');
  assert.equal(L.blockedFor('ip', 'k'), 0);
});
test('limiteur : plafond par adresse IP sur des comptes differents (balayage)', () => {
  const L = createLoginLimiter({ now: () => 1 });
  for (let i = 0; i < 40; i++) L.fail('9.9.9.9', `user${i}`);
  assert.ok(L.blockedFor('9.9.9.9', 'nouveau-compte') > 0, 'un 41e compte depuis la meme IP est bloque');
  assert.equal(L.blockedFor('8.8.8.8', 'nouveau-compte'), 0, 'une autre IP n\'est pas affectee');
});
test('limiteur : la memoire reste bornee sous un balayage massif', () => {
  const L = createLoginLimiter({ now: () => 1, maxEntries: 100 });
  for (let i = 0; i < 5000; i++) L.fail(`ip${i}`, `k${i}`);
  assert.ok(L.size() <= 200, `taille ${L.size()}`);
});

// ---------------------------------------------------------------- module principal (le bug Windows)
test('isMainModule : vrai pour le fichier lance, faux pour un autre, faux sans argument', () => {
  const f = path.join(ROOT, 'server', 'index.js');
  assert.equal(isMainModule(pathToFileURL(f).href, f), true);
  assert.equal(isMainModule(pathToFileURL(f).href, path.join(ROOT, 'server', 'db.js')), false);
  assert.equal(isMainModule(pathToFileURL(f).href, undefined), false);
});
test('isMainModule : un lien symbolique vers le fichier est reconnu (installations par lien)', { skip: process.platform === 'win32' && 'liens symboliques : droits admin requis' }, () => {
  const f = path.join(ROOT, 'server', 'index.js'); const link = path.join(os.tmpdir(), `link-${Date.now()}.js`);
  fs.symlinkSync(f, link);
  try { assert.equal(isMainModule(pathToFileURL(f).href, link), true); } finally { fs.rmSync(link, { force: true }); }
});
test('WINDOWS : l\'ancienne comparaison file://${argv1} ne pouvait JAMAIS reussir, la nouvelle oui', () => {
  const winPath = 'C:\\app\\server\\index.js';
  const realWinUrl = pathToFileURL(winPath, { windows: true }).href;       // semantique Windows de Node, depuis n'importe quel OS
  assert.equal(realWinUrl, 'file:///C:/app/server/index.js');
  assert.notEqual(`file://${winPath}`, realWinUrl, 'ancienne methode : file://C:\\app\\... ne correspond pas : le serveur n\'ecoutait jamais');
  assert.equal(isMainModule(realWinUrl, winPath, { realpath: p => p, toUrl: p => pathToFileURL(p, { windows: true }) }), true);
});

// ---------------------------------------------------------------- integration HTTP
let base, close;
before(async () => { ({ base, close } = await startServer()); await seed(base); });
after(async () => { await close(); });

const login = (email, password, extra = {}) => fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ email, password }),
});

test('connexion : 8 echecs puis 429 avec Retry-After, MEME avec le bon mot de passe', async () => {
  for (let i = 0; i < 8; i++) assert.equal((await login('admin@test.local', 'faux')).status, 401, `essai ${i + 1}`);
  const blocked = await login('admin@test.local', 'faux');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0, 'Retry-After doit indiquer l\'attente');
  assert.equal((await login('admin@test.local', 'Test1234!')).status, 429, 'le bon mot de passe est refuse pendant le blocage');
});
test('connexion : le blocage d\'un compte n\'affecte pas les autres comptes', async () => {
  assert.equal((await login('manager@test.local', 'Test1234!')).status, 200);
});
test('connexion : un succes remet le compteur a zero', async () => {
  for (let i = 0; i < 3; i++) await login('manager@test.local', 'faux');
  assert.equal((await login('manager@test.local', 'Test1234!')).status, 200);
  for (let i = 0; i < 7; i++) assert.equal((await login('manager@test.local', 'faux')).status, 401, `apres reinitialisation, essai ${i + 1}`);
});
test('connexion SANS proxy de confiance : falsifier X-Forwarded-For ne permet pas de contourner le blocage', async () => {
  for (let i = 0; i < 8; i++) await login('staff@test.local', 'faux', { 'X-Forwarded-For': `10.1.1.${i}` });
  const r = await login('staff@test.local', 'faux', { 'X-Forwarded-For': '10.9.9.9' });
  assert.equal(r.status, 429, 'l\'en-tete est ignore tant que TRUST_PROXY n\'est pas defini');
});
test('connexion : entrees mal typees -> 400, jamais 500', async () => {
  for (const body of [{ email: 12345, password: 'x' }, { email: 'a@b.c', password: { x: 1 } }, { email: ['a'], password: 'x' }, {}, { email: '', password: '' }]) {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test('en-tetes de securite presents, X-Powered-By absent', async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'same-origin');
  assert.match(r.headers.get('permissions-policy'), /camera=\(self\)/, 'la page Scan a besoin de la camera');
  assert.equal(r.headers.get('x-powered-by'), null);
});
test('hors mode demo : /api/demo ne divulgue rien (pas de mot de passe, pas de comptes)', async () => {
  const body = await (await fetch(`${base}/api/demo`)).json();
  assert.deepEqual(body, { enabled: false });
});
test('hors mode demo : l\'import de fichiers reste disponible (non bloque)', async () => {
  const token = await loginAs(base, 'manager');
  const form = new FormData(); form.append('file', new Blob(['asset_code,category\nSEC-1,LAPTOP\n'], { type: 'text/csv' }), 'a.csv');
  const r = await fetch(`${base}/api/import/assets`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  assert.equal(r.status, 200);
});
