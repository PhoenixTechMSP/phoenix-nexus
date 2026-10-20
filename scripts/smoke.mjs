#!/usr/bin/env node
// Test de fumee post-deploiement. Aucune dependance : Node 20+ suffit.
//
//   node scripts/smoke.mjs https://demo.phoenix-tech.be
//   node scripts/smoke.mjs http://localhost:8080
//   SMOKE_EMAIL=... SMOKE_PASSWORD=... node scripts/smoke.mjs https://instance-client.example
//
// Sur une instance de demo, les comptes sont lus depuis /api/demo (aucun identifiant a fournir).
// Hors demo, fournir SMOKE_EMAIL / SMOKE_PASSWORD pour les controles authentifies ; sinon seuls les controles publics tournent.
// Code de sortie : 0 si tout passe, 1 si un controle echoue (utilisable dans un script de deploiement ou en CI).
// Ne modifie aucune donnee : lectures uniquement, plus une connexion refusee volontairement (mauvais mot de passe).

const args = process.argv.slice(2);
const base = (args.find(a => /^https?:\/\//.test(a)) || process.env.SMOKE_URL || '').replace(/\/+$/, '');
// --api-only : ignore les controles de la PAGE (HTML, JS, CSS, logo), qui exigent un client compile (npm run build).
// Utile pour verifier un serveur lance sans 'dist/' (tests automatiques, developpement). Ne PAS l'utiliser apres un deploiement.
const apiOnly = args.includes('--api-only') || process.env.SMOKE_API_ONLY === '1';
if (!/^https?:\/\//.test(base)) {
  console.error('usage : node scripts/smoke.mjs <url> [--api-only]   (ex. https://demo.phoenix-tech.be)');
  process.exit(2);
}
const SLOW_MS = 3000;
const results = [];
const record = (ok, name, detail = '') => {
  results.push({ ok, name });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    record(true, name, `${detail || ''}${ms > SLOW_MS ? `  LENT (${ms} ms)` : ''}`.trim());
  } catch (e) { record(false, name, String(e.message || e).slice(0, 220)); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const get = (p, token, init = {}) => fetch(base + p, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers }, redirect: 'manual' });
const json = async (p, token) => {
  const r = await get(p, token); const text = await r.text();
  assert(r.status === 200, `HTTP ${r.status} sur ${p} : ${text.slice(0, 100).replace(/\s+/g, ' ')}`);
  try { return JSON.parse(text); } catch { throw new Error(`${p} ne renvoie pas du JSON : ${text.slice(0, 80).replace(/\s+/g, ' ')}`); }
};

console.log(`Smoke test : ${base}\n`);

// ---------------------------------------------------------------- public : page, ressources, sante
if (apiOnly) {
  console.log('(controles de la page ignores : --api-only)');
} else {
  let html = '';
  await check('page d\'accueil servie (HTML, titre Phoenix-Nexus)', async () => {
    const r = await get('/'); html = await r.text();
    assert(r.status === 200, `HTTP ${r.status}`);
    assert(/<title>Phoenix-Nexus<\/title>/.test(html), 'titre Phoenix-Nexus absent');
  });
  await check('JavaScript et CSS de l\'application se chargent', async () => {
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(m => m[1]);
    assert(assets.length >= 2, `${assets.length} ressource(s) /assets trouvee(s) dans la page`);
    for (const a of assets) { const r = await get(a); assert(r.status === 200, `${a} -> HTTP ${r.status}`); }
    return `${assets.length} fichiers`;
  });
  await check('logo et favicon se chargent (images PNG)', async () => {
    for (const p of ['/favicon.png', '/brand/phoenix-logo.png', '/brand/phoenix-mark-header.png']) {
      const r = await get(p);
      assert(r.status === 200 && (r.headers.get('content-type') || '').startsWith('image/png'), `${p} -> ${r.status} ${r.headers.get('content-type')}`);
    }
  });
  await check('une adresse interne de l\'interface (/inventory) renvoie l\'application, pas une 404', async () => {
    const r = await get('/inventory'); assert(r.status === 200 && /<div id="root">/.test(await r.text()), `HTTP ${r.status}`);
  });
}
await check('/api/health : ok', async () => { assert((await json('/api/health')).ok === true, 'ok != true'); });
await check('en-tetes de securite presents', async () => {
  const r = await get('/api/health'); const h = n => r.headers.get(n);
  assert(h('x-content-type-options') === 'nosniff', 'X-Content-Type-Options manquant');
  assert(h('x-frame-options') === 'DENY', 'X-Frame-Options manquant');
  assert(!h('x-powered-by'), 'X-Powered-By expose la technologie');
  if (base.startsWith('https://')) assert(/max-age=\d+/.test(h('strict-transport-security') || ''), 'HSTS manquant en HTTPS');
});
if (base.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(base)) record(false, 'HTTPS', 'instance publique servie en HTTP clair');
await check('une route d\'API protegee refuse l\'acces anonyme (401)', async () => {
  const r = await get('/api/assets'); assert(r.status === 401, `HTTP ${r.status} (attendu 401)`);
});

// ---------------------------------------------------------------- identifiants
const demo = await json('/api/demo').catch(() => ({ enabled: false }));
let email = process.env.SMOKE_EMAIL, password = process.env.SMOKE_PASSWORD, staffToken;
const login = async (e, p) => {
  const r = await get('/api/auth/login', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
if (demo.enabled) {
  console.log(`\nInstance de DEMO detectee (${demo.accounts.length} comptes publics)\n`);
  email = demo.accounts.find(a => a.role === 'manager').email; password = demo.password;
  await check('demo : un mauvais mot de passe est refuse (401)', async () => {
    const r = await login(email, password + 'x'); assert(r.status === 401, `HTTP ${r.status}`);
  });
  await check('demo : le compte staff peut se connecter', async () => {
    const s = demo.accounts.find(a => a.role === 'staff'); const r = await login(s.email, demo.password);
    assert(r.status === 200 && r.body.token, `HTTP ${r.status}`); staffToken = r.body.token;
  });
  await check('demo : aucun compte administrateur n\'est expose publiquement', async () => {
    assert(!demo.accounts.some(a => a.role === 'admin'), 'un compte admin est publie sur /api/demo');
  });
}

// ---------------------------------------------------------------- authentifie
let token;
if (!email || !password) {
  console.log('\n(controles authentifies ignores : definir SMOKE_EMAIL et SMOKE_PASSWORD)');
} else {
  await check('connexion avec le compte de test', async () => {
    const r = await login(email, password); assert(r.status === 200 && r.body.token, `HTTP ${r.status} : ${r.body.error || ''}`); token = r.body.token;
  });
}
if (token) {
  const reads = ['/api/auth/me', '/api/departments', '/api/categories', '/api/assets', '/api/agents', '/api/events', '/api/events/stats',
    '/api/events/forecast', '/api/events/fleet-snapshot', '/api/cmdb/items', '/api/sam/summary', '/api/sam/position', '/api/sam/renewals'];
  for (const p of reads) await check(`GET ${p} : 200 et JSON`, async () => { await json(p, token); });
  for (const p of ['/api/events/export.xlsx', '/api/events/fleet-export.xlsx']) {
    await check(`export ${p} : fichier Excel valide`, async () => {
      const r = await get(p, token); const b = Buffer.from(await r.arrayBuffer());
      assert(r.status === 200 && b.subarray(0, 2).toString() === 'PK', `HTTP ${r.status}, ${b.length} octets`);
    });
  }
  if (demo.enabled) {
    await check('demo : des donnees exploitables (assets, historique, CMDB, SAM)', async () => {
      const assets = await json('/api/assets', token), stats = await json('/api/events/stats', token);
      const cmdb = await json('/api/cmdb/items', token), sam = await json('/api/sam/summary', token);
      assert(assets.length >= 20, `${assets.length} assets`); assert(stats.daily.length >= 7, `${stats.daily.length} jours d'historique`);
      assert(cmdb.length >= 5, `${cmdb.length} CI`); assert(sam.products >= 3, `${sam.products} produits SAM`);
      return `${assets.length} assets, ${stats.daily.length} jours, ${cmdb.length} CI, ${sam.products} produits`;
    });
    await check('demo : les imports de fichiers sont desactives (403)', async () => {
      const r = await get('/api/import/assets', token, { method: 'POST' }); assert(r.status === 403, `HTTP ${r.status}`);
    });
    await check('demo : le compte staff ne peut pas administrer les utilisateurs (403)', async () => {
      const r = await get('/api/users', staffToken); assert(r.status === 403, `HTTP ${r.status}`);
    });
  }
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} controles OK, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
