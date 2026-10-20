// Prepare une instance de DEMONSTRATION complete et reproductible.
//
//   DEMO_PASSWORD=...  node scripts/demo-setup.js
//
// Variables : DEMO_PASSWORD (obligatoire, 8+ car., sera PUBLIC : affiche sur la page de connexion),
//             DEMO_RESET_ON_START=1 (efface la base avant de la remplir : instance jetable),
//             ADMIN_EMAIL + ADMIN_PASSWORD (12+ car., optionnels : compte admin PRIVE pour l'exploitation).
// Toutes les donnees sont fictives. Idempotent : sans DEMO_RESET_ON_START, relancer ne duplique rien.

import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'ptx.db');
const password = process.env.DEMO_PASSWORD || '';
if (password.length < 8) {
  console.error('[demo] DEMO_PASSWORD est obligatoire (8 caracteres minimum). Il est affiche publiquement : ne reutilise AUCUN mot de passe reel.');
  process.exit(1);
}
const adminEmail = process.env.ADMIN_EMAIL || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';
if (adminEmail && adminPassword.length < 12) {
  console.error('[demo] ADMIN_PASSWORD doit faire 12 caracteres minimum.');
  process.exit(1);
}

if (process.env.DEMO_RESET_ON_START === '1') {
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(DB_PATH + suffix, { force: true });
  console.log('[demo] base reinitialisee');
}

const { db } = await import('../server/db.js');
const { DEMO_ACCOUNTS } = await import('../server/lib/demo.js');
const { backfillActiveAssets } = await import('../server/lib/cmdb-sync.js');
await import('./seed-dummy-data.js');   // agents + assets
await import('./seed-sam-demo.js');      // produits, droits, attributions SAM

// ---- comptes ----
const upsertUser = db.prepare(`
  INSERT INTO users (email, password_hash, full_name, role, status, language) VALUES (?,?,?,?, 'active', 'en')
  ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role, status = 'active'`);
const hash = bcrypt.hashSync(password, 10);
for (const a of DEMO_ACCOUNTS) upsertUser.run(a.email, hash, a.full_name, a.role);
if (adminEmail) upsertUser.run(adminEmail.toLowerCase(), bcrypt.hashSync(adminPassword, 10), 'Administrator', 'admin');

// ---- historique synthetique (28 jours) : sans lui Dashboard, Forecast et Logs seraient vides ----
let events = 0;
if (db.prepare('SELECT COUNT(*) AS n FROM asset_events').get().n < 20) {
  let seed = 20260101;                                  // generateur deterministe : meme demo a chaque fois
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const assets = db.prepare(`
    SELECT a.id, a.category_id, a.department_id FROM assets a JOIN categories c ON c.id = a.category_id
    WHERE a.asset_code LIKE 'DEMO-%' AND c.consumable = 0 AND a.status IN ('available','in_use')`).all();
  const agents = db.prepare(`SELECT id FROM agents WHERE matricule LIKE 'DEMO-%'`).all();
  const manager = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_ACCOUNTS[0].email);
  const ins = db.prepare(`INSERT INTO asset_events (asset_id, agent_id, user_id, event_type, status_after, department_id, category_id, created_at)
                          VALUES (?,?,?,?,?,?,?,?)`);
  const fmt = d => d.toISOString().slice(0, 19).replace('T', ' ');
  const HOURS = [7, 8, 8, 9, 13, 13, 14, 16, 17];       // pics du matin, du midi et de fin d'apres-midi
  const now = new Date();
  db.transaction(() => {
    for (let back = 27; back >= 0; back--) {
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back));
      const weekend = [0, 6].includes(day.getUTCDay());
      const loans = weekend ? Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 6);
      for (let i = 0; i < loans; i++) {
        const out = new Date(day); out.setUTCHours(pick(HOURS), Math.floor(rnd() * 60), 0);
        const back_ = new Date(out); back_.setUTCHours(out.getUTCHours() + 2 + Math.floor(rnd() * 5));
        if (out > now) continue;
        const a = pick(assets), ag = pick(agents);
        ins.run(a.id, ag.id, manager.id, 'check_out', 'in_use', a.department_id, a.category_id, fmt(out));
        events++;
        if (back_ <= now) { ins.run(a.id, ag.id, manager.id, 'check_in', 'available', a.department_id, a.category_id, fmt(back_)); events++; }
      }
    }
  })();
}

// ---- CMDB : CI des assets en service + relations plausibles ----
backfillActiveAssets();
const ci = code => db.prepare('SELECT id FROM configuration_items WHERE label = ?').get(code)?.id;
const rel = db.prepare('INSERT OR IGNORE INTO ci_relationships (source_ci_id, target_ci_id, relationship_type) VALUES (?,?,?)');
let relations = 0;
for (const [from, to, type] of [
  ['DEMO-PTX-001', 'DEMO-NET-001', 'connected_to'], ['DEMO-NET-001', 'DEMO-PLC-001', 'connected_to'],
  ['DEMO-NET-001', 'DEMO-CCTV-001', 'connected_to'], ['DEMO-LT-002', 'DEMO-NET-001', 'connected_to'],
  ['DEMO-DT-002', 'DEMO-NET-001', 'connected_to'],
]) if (ci(from) && ci(to)) relations += rel.run(ci(from), ci(to), type).changes;

const n = sql => db.prepare(sql).get().n;
console.log(`[demo] pret : ${n('SELECT COUNT(*) n FROM agents')} agents, ${n('SELECT COUNT(*) n FROM assets')} assets, ` +
  `${n('SELECT COUNT(*) n FROM asset_events')} evenements (+${events}), ${n('SELECT COUNT(*) n FROM configuration_items')} CI (+${relations} relations), ` +
  `${n('SELECT COUNT(*) n FROM software_products')} produits SAM, ${n('SELECT COUNT(*) n FROM users')} comptes`);
process.exit(0);
