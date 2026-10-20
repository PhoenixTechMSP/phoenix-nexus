import './clean-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'data', 'logs', 'backups', '__pycache__']);
const SKIP_FILES = new Set(['package-lock.json']);
const TEXT_EXT = new Set(['.js', '.jsx', '.mjs', '.json', '.md', '.yml', '.yaml', '.sh', '.ps1', '.bat', '.html', '.css', '.py', '.csv', '.txt']);
const THIS_FILE = path.join('server', 'test', 'repo-guards.test.js');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name)); continue; }
    const rel = path.relative(ROOT, path.join(dir, entry.name));
    const isText = TEXT_EXT.has(path.extname(entry.name)) || ['Dockerfile', '.env.example', '.gitignore', '.dockerignore'].includes(entry.name);
    if (isText && !SKIP_FILES.has(entry.name) && rel !== THIS_FILE) yield rel;
  }
}
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const files = [...walk(ROOT)];

test('garde-fou : aucun em-dash dans le code, les pages ni la documentation', () => {
  const offenders = files.filter(f => read(f).includes('\u2014'));
  assert.deepEqual(offenders, [], 'em-dash interdit (utiliser un tiret simple) : ' + offenders.join(', '));
});

// Ancien nom du produit. Autorise uniquement la ou il est volontaire :
// CHANGELOG (historique + note de renommage), INSTALL.md (note de nommage),
// install-windows.ps1 (nom de l'ancienne regle de pare-feu, reconnue pour ne pas creer de doublon).
const LEGACY = /site asset manager|site-asset-manager|ptx-fleet|ptx fleet manager|site-cmdb/i;
const ALLOWED_LEGACY = new Set(['CHANGELOG.md', 'INSTALL.md', path.join('scripts', 'install-windows.ps1')]);

test('garde-fou : l\'ancien nom du produit n\'apparait que la ou c\'est voulu', () => {
  const offenders = files.filter(f => !ALLOWED_LEGACY.has(f) && LEGACY.test(read(f)));
  assert.deepEqual(offenders, [], 'ancien nom trouve (renommer en Phoenix-Nexus) : ' + offenders.join(', '));
});

test('marque : Phoenix-Nexus dans les trois langues, le package et la page', () => {
  for (const lang of ['en', 'fr', 'nl']) {
    const d = JSON.parse(read(path.join('client', 'src', 'i18n', `${lang}.json`)));
    assert.equal(d.app.title, 'Phoenix-Nexus', `app.title (${lang})`);
    assert.equal(d.login.title, 'Phoenix-Nexus', `login.title (${lang})`);
  }
  assert.equal(JSON.parse(read('package.json')).name, 'phoenix-nexus');
  assert.match(read(path.join('client', 'index.html')), /<title>Phoenix-Nexus<\/title>/);
});

// Ces identifiants gardent volontairement leur nom historique : les renommer ferait
// demarrer une instance existante sur une base VIDE (ptx.db), casserait la mise a jour
// Windows (le service PTXFleet sert a retrouver l'installation) ou les droits sur le volume
// Docker (utilisateur ptx). Si tu veux vraiment les changer, il faut une migration, pas un sed.
test('compatibilite : les identifiants a etat gardent leur nom historique', () => {
  assert.match(read(path.join('server', 'db.js')), /'data', 'ptx\.db'/, 'nom de fichier de base par defaut');
  assert.match(read('docker-compose.yml'), /DB_PATH=\/data\/ptx\.db/, 'DB_PATH du compose');
  assert.match(read(path.join('scripts', 'update-windows.ps1')), /\$Service = 'PTXFleet'/, 'service Windows par defaut');
  assert.match(read(path.join('scripts', 'install-windows.ps1')), /Get-Service PTXFleet/, 'service Windows a l\'installation');
  assert.match(read('Dockerfile'), /adduser -S ptx -G ptx/, 'utilisateur du conteneur');
});

// Preuve comportementale (pas seulement textuelle) de la promesse du CHANGELOG :
// une installation existante, avec son fichier data/ptx.db, retrouve ses donnees apres le
// renommage sans aucune configuration (DB_PATH non defini => chemin par defaut).
test('mise a jour sans migration : une base data/ptx.db existante est retrouvee par defaut', async () => {
  const { execFileSync } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  const os = await import('node:os');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-upgrade-'));
  fs.mkdirSync(path.join(work, 'data'));
  const dbUrl = pathToFileURL(path.join(ROOT, 'server', 'db.js')).href;

  // 1) "Ancienne installation" : on cree data/ptx.db avec une donnee metier.
  const seedScript = path.join(work, 'seed.mjs');
  fs.writeFileSync(seedScript, [
    `process.env.DB_PATH = ${JSON.stringify(path.join(work, 'data', 'ptx.db'))};`,
    `const { db } = await import(${JSON.stringify(dbUrl)});`,
    `db.prepare("INSERT INTO agents (matricule, first_name, last_name) VALUES ('LEGACY-1','Existing','Install')").run();`,
  ].join('\n'));
  execFileSync('node', [seedScript], { cwd: work, stdio: 'pipe' });

  // 2) Demarrage "apres mise a jour" : AUCUN DB_PATH, dossier de travail = l'installation.
  const readScript = path.join(work, 'read.mjs');
  fs.writeFileSync(readScript, [
    `const { db } = await import(${JSON.stringify(dbUrl)});`,
    `const row = db.prepare("SELECT first_name FROM agents WHERE matricule='LEGACY-1'").get();`,
    `console.log(JSON.stringify({ found: row ? row.first_name : null }));`,
  ].join('\n'));
  const env = { ...process.env }; delete env.DB_PATH;
  const out = execFileSync('node', [readScript], { cwd: work, env, encoding: 'utf8' });
  const result = JSON.parse(out.trim().split('\n').pop());

  assert.equal(result.found, 'Existing', 'les donnees de l\'ancienne installation doivent etre retrouvees');
  assert.deepEqual(fs.readdirSync(path.join(work, 'data')).filter(f => f.endsWith('.db')), ['ptx.db'],
    'aucun nouveau fichier de base ne doit apparaitre a cote de ptx.db');
  fs.rmSync(work, { recursive: true, force: true });
});

// Logo : une image manquante ne se voit qu'en ouvrant un navigateur. On verifie donc que chaque
// image referencee dans l'interface, le HTML ou le README existe, est un vrai PNG RGBA (transparence
// preservee, pas un JPG renomme ni un carre opaque) et reste legere (le logo source pese 60 Ko).
test('logo : images referencees presentes, PNG RGBA, legeres', () => {
  const publicDir = path.join(ROOT, 'client', 'public');
  const refs = new Set();
  const scanned = files.filter(f => /^client[\\/](src|index\.html)/.test(f) || f === 'README.md');
  for (const f of scanned) {
    const text = read(f);
    for (const m of text.matchAll(/(?:src|href)="(\/(?:brand\/[\w.-]+|favicon)\.png)"/g)) refs.add(m[1]);
    for (const m of text.matchAll(/client\/public\/(brand\/[\w.-]+\.png)/g)) refs.add('/' + m[1]);
  }
  assert.ok(refs.size >= 4, `au moins 4 references d'image attendues (en-tete, 2 connexion, favicon), trouvees : ${[...refs]}`);
  for (const ref of refs) {
    const file = path.join(publicDir, ref);
    assert.ok(fs.existsSync(file), `image referencee mais absente : ${ref}`);
    const buf = fs.readFileSync(file);
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${ref} n'est pas un PNG`);
    assert.equal(buf[25], 6, `${ref} doit etre RGBA (type 6) pour garder la transparence`);
    assert.ok(buf.readUInt32BE(16) >= 64 && buf.readUInt32BE(20) >= 64, `${ref} trop petit (< 64 px) : flou sur ecran HiDPI`);
    assert.ok(buf.length < 30 * 1024, `${ref} pese ${(buf.length / 1024).toFixed(0)} Ko : regenerer avec scripts/brand/make-assets.py`);
  }
});


// Hygiene git. Un `git add .` sans .gitignore a deja envoye .env, la base SQLite (avec le compte
// admin) et 7 470 fichiers de node_modules sur un depot public. Ces deux tests l'empechent.
test('hygiene git : .gitignore protege les secrets, les bases, node_modules et le build', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.gitignore')), '.gitignore manquant a la racine');
  const lines = read('.gitignore').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  for (const needed of ['node_modules/', '.env', 'data/', 'dist/', '*.db', '*.db-wal', '*.db-shm']) {
    assert.ok(lines.includes(needed), `.gitignore doit contenir "${needed}"`);
  }
  assert.ok(!lines.includes('.env.example') && !lines.includes('.env*'), '.env.example doit rester suivi (modele de configuration)');
});

const IS_GIT = (() => {
  try { execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'ignore' }); return true; }
  catch { return false; }
})();

test('hygiene git : git ne suit ni .env, ni base de donnees, ni node_modules, ni data, ni dist',
  { skip: !IS_GIT && 'pas un depot git (archive extraite) : rien a verifier' }, () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const bad = tracked.filter(f => /(^|\/)\.env$/.test(f) || /\.db(-wal|-shm|-journal)?$/.test(f) || /^(node_modules|data|dist)\//.test(f));
    assert.deepEqual(bad.slice(0, 8), [],
      `${bad.length} fichier(s) sensible(s) suivi(s) par git (secret, base ou dependances). ` +
      'Si deja pousses : considerer les secrets comme compromis et les renouveler. ' +
      'Retirer du suivi : git rm -r --cached --ignore-unmatch .env data node_modules dist');
  });

test('licence : AGPL-3.0 presente et coherente (LICENSE, package.json, README, fichiers communautaires)', () => {
  const lic = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(lic, /GNU AFFERO GENERAL PUBLIC LICENSE/); assert.ok(lic.length > 30000, 'texte de licence tronque');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.license, 'AGPL-3.0-only');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /AGPL-3\.0/); assert.doesNotMatch(readme, /All rights reserved/i, 'README contredit la licence');
  for (const f of ['CODE_OF_CONDUCT.md', 'COMMERCIAL.md', 'ROADMAP.md', 'SECURITY.md', 'CONTRIBUTING.md', '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE/bug_report.md', '.github/ISSUE_TEMPLATE/config.yml']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} manquant`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'SECURITY.md'), 'utf8'), /internal IT security team\.\s*Do/, 'SECURITY.md sans contact public');
});
