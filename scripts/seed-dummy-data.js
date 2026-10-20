// Usage: node scripts/seed-dummy-data.js
// Peuple la base avec des agents et des assets FICTIFS variés (plusieurs
// catégories, plusieurs statuts) pour pouvoir naviguer dans l'UI sans
// attendre un vrai import. Jamais de données réelles ici - noms et matricules
// clairement inventés, cohérent avec la discipline appliquée au reste du
// projet ce soir.
//
// Idempotent par construction : les matricules/codes asset sont préfixés
// DEMO- et vérifiés avant insertion, donc relancer le script ne duplique rien.

import { db } from '../server/db.js';

function deptId(code) {
  const row = db.prepare('SELECT id FROM departments WHERE code = ?').get(code);
  if (!row) throw new Error(`Département ${code} introuvable - la base a-t-elle bien été initialisée (npm run dev:server au moins une fois) ?`);
  return row.id;
}

function catId(code) {
  const row = db.prepare('SELECT id FROM categories WHERE code = ?').get(code);
  if (!row) throw new Error(`Catégorie ${code} introuvable - la base a-t-elle bien été initialisée ?`);
  return row.id;
}

const agents = [
  ['DEMO-A001', 'Jean', 'Dupont', 'OPS'],
  ['DEMO-A002', 'Sophie', 'Martin', 'OPS'],
  ['DEMO-A003', 'Karim', 'Benali', 'WH'],
  ['DEMO-A004', 'Laura', 'Peeters', 'SALES'],
  ['DEMO-A005', 'Thomas', 'Claes', 'IT'],
  ['DEMO-A006', 'Elise', 'Janssens', 'HR'],
  ['DEMO-A007', 'Nicolas', 'Wouters', 'MNT'],
  ['DEMO-A008', 'Fatima', 'Lefevre', 'CLEAN'],
];

let agentsCreated = 0;
const insertAgent = db.prepare(
  `INSERT OR IGNORE INTO agents (matricule, first_name, last_name, department_id) VALUES (?,?,?,?)`
);
for (const [matricule, first, last, deptCode] of agents) {
  const info = insertAgent.run(matricule, first, last, deptId(deptCode));
  if (info.changes) agentsCreated++;
}

// [asset_code, category_code, status, dept_code, quantity, min_quantity]
const assets = [
  ['DEMO-LT-001', 'LAPTOP', 'available', 'IT', 1, 0],
  ['DEMO-LT-002', 'LAPTOP', 'in_use', 'SALES', 1, 0],
  ['DEMO-LT-003', 'LAPTOP', 'defective', 'OPS', 1, 0],
  ['DEMO-LT-004', 'LAPTOP', 'repair', 'HR', 1, 0],
  ['DEMO-DT-001', 'DESKTOP', 'available', 'IT', 1, 0],
  ['DEMO-DT-002', 'DESKTOP', 'in_use', 'HR', 1, 0],
  ['DEMO-MN-001', 'MONITOR', 'available', 'IT', 1, 0],
  ['DEMO-MN-002', 'MONITOR', 'in_use', 'SALES', 1, 0],
  ['DEMO-PR-001', 'PRINTER', 'available', 'GEN', 1, 0],
  ['DEMO-PH-001', 'PHONE', 'in_use', 'SALES', 1, 0],
  ['DEMO-PH-002', 'PHONE', 'available', 'MNT', 1, 0],
  ['DEMO-RD-001', 'RADIO', 'in_use', 'OPS', 1, 0],
  ['DEMO-RD-002', 'RADIO', 'available', 'OPS', 1, 0],
  ['DEMO-PTX-001', 'PTX', 'in_use', 'WH', 1, 0],
  ['DEMO-PTX-002', 'PTX', 'available', 'WH', 1, 0],
  ['DEMO-PTX-003', 'PTX', 'retired', 'WH', 1, 0],
  ['DEMO-NET-001', 'NETWORK', 'in_use', 'IT', 1, 0],
  ['DEMO-PLC-001', 'PLC', 'in_use', 'MNT', 1, 0],
  ['DEMO-CCTV-001', 'CCTV', 'in_use', 'GEN', 1, 0],
  ['DEMO-VAC-001', 'VACUUM', 'available', 'CLEAN', 1, 0],
  ['DEMO-TRL-001', 'TROLLEY', 'in_use', 'WH', 1, 0],
  // Consommables (quantity > 1, min_quantity pour tester les alertes de réappro)
  ['DEMO-PPE-GLOVES', 'PPE', 'available', 'GEN', 45, 20],
  ['DEMO-PPE-MASKS', 'PPE', 'available', 'GEN', 8, 15], // sous le seuil exprès - teste l'alerte réappro
  ['DEMO-CLOTH-01', 'CLOTH', 'available', 'CLEAN', 30, 10],
  ['DEMO-SUPPLY-01', 'SUPPLY', 'available', 'CLEAN', 5, 10], // sous le seuil exprès aussi
];

let assetsCreated = 0;
const insertAsset = db.prepare(
  `INSERT OR IGNORE INTO assets (asset_code, category_id, status, department_id, quantity, min_quantity) VALUES (?,?,?,?,?,?)`
);
for (const [code, catCode, status, deptCode, qty, minQty] of assets) {
  const info = insertAsset.run(code, catId(catCode), status, deptId(deptCode), qty, minQty);
  if (info.changes) assetsCreated++;
}

// Quelques check-out réels pour peupler l'historique/dashboard (pas juste un statut 'in_use' statique)
const demoAgent = db.prepare(`SELECT id FROM agents WHERE matricule = 'DEMO-A001'`).get();
const inUseAssets = db.prepare(
  `SELECT id FROM assets WHERE asset_code IN ('DEMO-LT-002','DEMO-PTX-001') AND current_agent_id IS NULL`
).all();
for (const a of inUseAssets) {
  db.prepare(`UPDATE assets SET current_agent_id = ? WHERE id = ?`).run(demoAgent.id, a.id);
}

console.log(`✓ Agents créés : ${agentsCreated} (sur ${agents.length} - le reste existait déjà)`);
console.log(`✓ Assets créés : ${assetsCreated} (sur ${assets.length} - le reste existait déjà)`);
console.log(`✓ Données 100% fictives, préfixées DEMO- - relance sans risque de doublon.`);
