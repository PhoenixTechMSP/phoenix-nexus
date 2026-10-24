import './clean-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));
const COMPOSE = ['docker-compose.yml', path.join('deploy', 'docker-compose.demo.yml')];

// Un ": " dans un element de liste YAML non quote transforme la chaine en PAIRE cle/valeur : docker compose rejette le fichier
// (cas reel : "JWT_SECRET=${JWT_SECRET:?JWT_SECRET is required: generate ...}" avait casse le compose).
test('YAML : aucun element de liste "KEY=valeur" non quote ne contient ": "', () => {
  const bad = [];
  for (const f of [...COMPOSE, path.join('.github', 'workflows', 'ci.yml')]) {
    read(f).split('\n').forEach((line, i) => {
      if (/^\s*-\s+(?!["'])[A-Za-z_][A-Za-z0-9_]*=.*:\s/.test(line)) bad.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], 'mettre l\'element entre guillemets');
});

test('compose : aucun secret par defaut connu, JWT_SECRET est obligatoire', () => {
  for (const f of COMPOSE) {
    const text = read(f);
    assert.doesNotMatch(text, /JWT_SECRET[=:-][^\n]*(change_me|replace_with|dev_only)/i, `${f} : secret par defaut connu`);
    assert.match(text, /JWT_SECRET=\$\{JWT_SECRET:\?/, `${f} : JWT_SECRET doit etre obligatoire (syntaxe :?)`);
  }
});

test('demo : l\'application n\'est pas publiee sur l\'hote, seul le proxy l\'est (condition de TRUST_PROXY)', () => {
  const text = read(path.join('deploy', 'docker-compose.demo.yml'));
  const nexus = text.split(/\n  caddy:/)[0];
  assert.doesNotMatch(nexus, /\n\s+ports:/, 'le service nexus ne doit PAS avoir de "ports:" : X-Forwarded-For serait falsifiable');
  assert.match(nexus, /TRUST_PROXY=1/);
  assert.match(nexus, /DEMO_MODE=1/);
  assert.match(text, /DEMO_PASSWORD=\$\{DEMO_PASSWORD:\?/, 'le mot de passe de demo doit etre obligatoire');
});

test('Caddyfile : domaine et email lus dans l\'environnement, HSTS, vers l\'application', () => {
  // Les commentaires sont ignores : citer un domaine en exemple est permis, le coder en dur dans la configuration ne l'est pas.
  const t = read(path.join('deploy', 'Caddyfile')).split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
  assert.match(t, /\{\$DOMAIN\}/); assert.match(t, /\{\$ACME_EMAIL\}/);
  assert.match(t, /reverse_proxy nexus:8080/); assert.match(t, /Strict-Transport-Security/);
  assert.doesNotMatch(t, /phoenix-tech\.(be|online)/, 'aucun domaine code en dur : il vient de deploy/.env');
});

test('.env.demo.example : modele sans aucun secret renseigne', () => {
  const t = read(path.join('deploy', '.env.demo.example'));
  for (const key of ['JWT_SECRET', 'DEMO_PASSWORD', 'ADMIN_PASSWORD']) assert.match(t, new RegExp(`^${key}=$`, 'm'), `${key} doit etre vide dans le modele`);
});

test('Dockerfile : build reproductible (npm ci + lockfile), sonde de sante, entrypoint present', () => {
  const t = read('Dockerfile');
  assert.match(t, /COPY package\.json package-lock\.json/); assert.match(t, /npm ci\b/); assert.doesNotMatch(t, /npm install/);
  assert.match(t, /HEALTHCHECK/); assert.match(t, /FROM node:22/);
  assert.match(t, /ENTRYPOINT \["sh", "scripts\/docker-entrypoint\.sh"\]/);
  assert.ok(exists(path.join('scripts', 'docker-entrypoint.sh')));
  assert.match(read(path.join('scripts', 'docker-entrypoint.sh')), /exec node server\/index\.js/, 'exec : node doit recevoir SIGTERM (arret propre)');
});

test('integration continue : le workflow rejoue les tests serveur ET navigateur', () => {
  const t = read(path.join('.github', 'workflows', 'ci.yml'));
  assert.match(t, /npm ci/); assert.match(t, /npm test/); assert.match(t, /run\.sh all/); assert.match(t, /playwright install/);
  assert.match(t, /on:\s*\n\s+push:/);
});

test('npm : les commandes de test et de verification existent', () => {
  const s = JSON.parse(read('package.json')).scripts;
  for (const k of ['test', 'test:e2e', 'smoke', 'demo:setup', 'build', 'start']) assert.ok(s[k], `script npm "${k}" manquant`);
});

test('deploiement continu : image tracable, rollback, hote SSH epingle, aucun secret en clair', () => {
  const ci = read(path.join('.github', 'workflows', 'ci.yml'));
  assert.match(ci, /needs: tests/, 'aucune image ni deploiement sans tests verts');
  assert.match(ci, /refs\/heads\/develop/); assert.match(ci, /refs\/heads\/main/);
  assert.match(ci, /sha-\$\{GITHUB_SHA/, 'tag immuable = SHA du commit');
  assert.equal((ci.match(/vars\.DEPLOY_ENABLED == 'true'/g) || []).length, 2, 'aucun deploiement sans DEPLOY_ENABLED (UAT et prod)');
  const dep = read(path.join('.github', 'workflows', 'deploy.yml'));
  assert.match(dep, /StrictHostKeyChecking=yes/); assert.doesNotMatch(dep, /StrictHostKeyChecking=no|ssh-keyscan\s+\$/);
  assert.match(dep, /smoke\.mjs/); assert.match(dep, /remote-deploy\.sh "?'?rollback/);
  assert.match(dep, /secrets\.DEPLOY_SSH_KEY/); assert.doesNotMatch(dep, /BEGIN [A-Z ]*PRIVATE KEY/);
  assert.doesNotMatch(dep, /\.env\b[^\n]*deploy@|scp[^\n]*\.env(\s|")/, 'le .env ne part jamais vers le serveur');
});

test('remote-deploy.sh : syntaxe valide, reference d\'image validee, rollback present', async () => {
  const { spawnSync } = await import('node:child_process');
  const f = path.join(ROOT, 'deploy', 'remote-deploy.sh');
  assert.equal(spawnSync('bash', ['-n', f]).status, 0, 'syntaxe bash invalide');
  assert.equal(spawnSync('bash', ['-n', path.join(ROOT, 'deploy', 'bootstrap-vps.sh')]).status, 0);
  const bad = spawnSync('bash', [f, 'evil.example/x:latest; rm -rf /'], { encoding: 'utf8' });
  assert.equal(bad.status, 2, 'une reference hors ghcr.io doit etre refusee');
  assert.match(bad.stderr, /refusee/);
  assert.match(read('deploy/remote-deploy.sh'), /--wait/); assert.match(read('deploy/remote-deploy.sh'), /\.previous-image/);
});

test('compose demo : image injectee par le pipeline (NEXUS_IMAGE) avec repli local', () => {
  assert.match(read(path.join('deploy', 'docker-compose.demo.yml')), /image: \$\{NEXUS_IMAGE:-phoenix-nexus:local\}/);
});

test('release : le tag doit correspondre a package.json, les notes viennent du CHANGELOG, image versionnee, pre-release si tiret', () => {
  const t = read(path.join('.github', 'workflows', 'release.yml'));
  assert.match(t, /tags:\s*\["v\*\.\*\.\*"\]/); assert.match(t, /ne correspond pas a package\.json/);
  assert.match(t, /CHANGELOG\.md/); assert.match(t, /npm test/); assert.match(t, /type=semver,pattern=\{\{version\}\}/);
  assert.match(t, /--prerelease/); assert.match(t, /packages: write/);
  const pkg = JSON.parse(read('package.json')).version;
  const log = read('CHANGELOG.md');
  assert.ok(log.split('\n').some(l => l === `## ${pkg}` || l.startsWith(`## ${pkg} `)), `CHANGELOG sans section "## ${pkg}" : la release echouerait`);
  assert.ok(exists('RELEASING.md'));
});

// Constate au premier tag : le workflow ecrivait release-notes.md a la racine AVANT `npm test`, et le garde-fou de l'ancien nom
// (qui parcourt le dossier de travail) rejetait ce fichier. Les notes doivent vivre hors du depot.
test('release : les notes sont ecrites hors du depot (RUNNER_TEMP), pas dans le dossier analyse par les tests', () => {
  const t = read(path.join('.github', 'workflows', 'release.yml'));
  assert.match(t, /RUNNER_TEMP\/release-notes\.md/);
  assert.match(t, /path:\s*\$\{\{ runner\.temp \}\}\/release-notes\.md/);
  assert.doesNotMatch(t, /(^|[^>])>\s*(\.\/)?release-notes\.md\s*$/m, 'release-notes.md ne doit pas etre cree a la racine avant les tests');
});
