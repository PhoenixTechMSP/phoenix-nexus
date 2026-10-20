import './clean-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.DB_PATH = path.join(os.tmpdir(), `test-isolation-${Date.now()}-${process.pid}.db`);
process.env.JWT_SECRET = 'test_secret_isolation';
process.env.NODE_ENV = 'test';
process.env.PORT = '8120';   // l'ancien comportement lisait ce port fixe : deux serveurs ne pouvaient pas coexister

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POLLUTED = { NODE_ENV: 'production', DEMO_MODE: '1', DEMO_PASSWORD: 'x', TRUST_PROXY: '1', LOGIN_MAX_ATTEMPTS: '1',
                   JWT_SECRET: 'replace_with_a_long_random_string_at_least_32_chars', PORT: '1', DB_PATH: '/nulle/part.db', SSO_ENABLED: 'true' };

test('clean-env : retire du processus toutes les variables ambiantes qui changent le comportement du serveur', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'server', 'test', 'clean-env.js')).href)});
     console.log(JSON.stringify(Object.keys(process.env).filter(k => /^(NODE_ENV|DEMO_|TRUST_PROXY|LOGIN_|JWT_|SSO_|PORT|DB_PATH)/.test(k))));`],
    { env: { ...process.env, ...POLLUTED }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), []);
});

// Preuve de bout en bout : les fichiers qui supposent "pas de mode demo, pas de proxy, pas de production" passent
// meme lances depuis un shell qui a TOUT cela d'exporte (le cas qui a fait echouer 9 tests lors d'une session de travail).
for (const file of ['security.test.js', 'phase2-cmdb.test.js', 'import-csv-samples.test.js']) {
  test(`hermetique : ${file} passe depuis un environnement pollue (DEMO_MODE, NODE_ENV=production, TRUST_PROXY...)`, () => {
    // Le lanceur de tests de Node transmet NODE_TEST_CONTEXT a ses enfants : sans l'effacer, un "node --test" imbrique ne
    // lance rien et renvoie 0 (le garde-fou passait SANS RIEN EXECUTER, constate par mutation). On l'efface, puis on
    // verifie que des tests ont reellement tourne.
    const env = { ...process.env, ...POLLUTED };
    for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST')) delete env[k];
    const r = spawnSync(process.execPath, ['--test', path.join('server', 'test', file)], { cwd: ROOT, env, encoding: 'utf8', timeout: 150000 });
    const ran = Number((r.stdout.match(/^# tests (\d+)/m) || [])[1] || 0);
    assert.ok(ran >= 3, `${file} : seulement ${ran} test(s) ont tourne : le garde-fou ne verifie rien`);
    const failed = r.stdout.split('\n').filter(l => l.startsWith('not ok')).join(' | ');
    assert.equal(r.status, 0, `${file} depend de l'environnement du shell : ${failed}`);
  });
}

// Regression d'une course reelle : deux processus lancant le meme fichier de test simultanement se disputaient un port fixe
// (EADDRINUSE, 23 tests en echec d'un coup sur une machine plus lente que celle du developpement).
test('isolation : deux serveurs de test coexistent (port libre attribue par le systeme, pas de port fixe)', async () => {
  const { startServer } = await import('./helpers.js');
  const a = await startServer(), b = await startServer();
  try {
    assert.notEqual(a.base, b.base);
    for (const s of [a, b]) assert.equal((await fetch(`${s.base}/api/health`)).status, 200);
  } finally { await a.close(); await b.close(); }
});
