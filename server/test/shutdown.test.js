import './clean-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skip = process.platform === 'win32' ? 'les signaux POSIX n\'existent pas sous Windows' : false;
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

async function waitHealthy(port, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return true; } catch { /* pas encore pret */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

// Dans un conteneur node est le processus 1 : sans gestionnaire de SIGTERM il ignore le signal et Docker/Podman le tue de force
// apres 10 s (constate lors de la recette : "StopSignal SIGTERM failed ... resorting to SIGKILL"). On ne peut pas etre PID 1 dans
// un test, mais un gestionnaire present se voit : arret volontaire = code 0, au lieu d'une mort par signal (code null).
for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`arret propre sur ${signal} : code 0, base fermee, connexion keep-alive ouverte`, { skip }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-stop-'));
    const port = await freePort();
    const env = { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'ptx.db'), JWT_SECRET: 'a'.repeat(64) };
    const child = spawn('node', ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
    const exited = new Promise(r => child.once('exit', (code, sig) => r({ code, sig })));
    try {
      assert.ok(await waitHealthy(port), `le serveur n'ecoute pas : ${out}`);
      // Une connexion keep-alive restee ouverte ne doit pas bloquer l'arret.
      const agent = new http.Agent({ keepAlive: true });
      await new Promise((res, rej) => http.get({ port, host: '127.0.0.1', path: '/api/health', agent }, r => { r.resume(); r.on('end', res); }).on('error', rej));
      const t0 = Date.now();
      child.kill(signal);
      const { code, sig } = await Promise.race([exited, new Promise((_, rej) => setTimeout(() => rej(new Error(`pas arrete apres 6 s : ${out}`)), 6000))]);
      agent.destroy();
      assert.equal(sig, null, `tue par le signal ${sig} : aucun gestionnaire`);
      assert.equal(code, 0, out);
      assert.ok(Date.now() - t0 < 5000, 'arret trop lent');
      assert.match(out, /arret propre/);
      assert.ok(!fs.existsSync(path.join(dir, 'ptx.db-wal')) || fs.statSync(path.join(dir, 'ptx.db-wal')).size === 0, 'journal WAL non vide : base mal fermee');
    } finally { if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL'); }
  });
}
