// Usage: node scripts/seed-sam-demo.js   (apres scripts/seed-dummy-data.js)
// Peuple le module SAM avec un scenario de demonstration FICTIF couvrant les 5
// statuts de position de licence. Les noms de produits sont des produits publics ;
// quantites, couts et contrats sont inventes. Les dates de renouvellement sont
// relatives a aujourd'hui pour que la demo ne "perime" jamais.
// Idempotent : relancer ne duplique rien.

import { db } from '../server/db.js';

const iso = (days) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

const agentId = (m) => db.prepare('SELECT id FROM agents WHERE matricule = ?').get(m)?.id;
const assetId = (c) => db.prepare('SELECT id FROM assets WHERE asset_code = ?').get(c)?.id;

const agents = ['DEMO-A001', 'DEMO-A002', 'DEMO-A003', 'DEMO-A004', 'DEMO-A005', 'DEMO-A006', 'DEMO-A007', 'DEMO-A008'].map(agentId);
if (agents.some(x => !x)) {
  console.error('Agents DEMO-A001..A008 introuvables : lance d\'abord  node scripts/seed-dummy-data.js');
  process.exit(1);
}
const laptops = ['DEMO-LT-001', 'DEMO-LT-002', 'DEMO-LT-003', 'DEMO-LT-004'].map(assetId);
const desktops = ['DEMO-DT-001', 'DEMO-DT-002'].map(assetId);
if ([...laptops, ...desktops].some(x => !x)) {
  console.error('Assets DEMO-LT-* / DEMO-DT-* introuvables : lance d\'abord  node scripts/seed-dummy-data.js');
  process.exit(1);
}

// name, vendor, metric, category, [quantity, annual_cost_total, contract_ref, renewal_in_days] | null
const products = [
  ['Microsoft 365 E5', 'Microsoft', 'named_user', 'Productivity', [6, 3900, 'EA-2026-M365', 25]],
  ['Creative Cloud', 'Adobe', 'named_user', 'Design', [5, 3600, 'ADB-CC-0042', 70]],
  ['Endpoint protection', 'CrowdStrike', 'device', 'Security', [6, 270, 'CS-EDR-118', 120]],
  ['AutoCAD', 'Autodesk', 'device', 'Engineering', [4, 6000, 'ADSK-ACAD-77', 200]],
  ['Power BI Pro', 'Microsoft', 'subscription', 'Analytics', [8, 960, 'EA-2026-PBI', 60]],
  ['Remote access tool', 'TeamViewer', 'named_user', 'IT tools', null], // aucun droit achete : usage hors catalogue
];

const insProduct = db.prepare('INSERT OR IGNORE INTO software_products (name, vendor, metric, category) VALUES (?,?,?,?)');
const getProduct = db.prepare('SELECT id FROM software_products WHERE vendor = ? AND name = ?');
const hasEnt = db.prepare('SELECT 1 FROM licence_entitlements WHERE product_id = ?');
const insEnt = db.prepare('INSERT INTO licence_entitlements (product_id, quantity, annual_cost, contract_ref, renewal_date) VALUES (?,?,?,?,?)');
const insInstall = db.prepare('INSERT OR IGNORE INTO software_installations (product_id, agent_id, asset_id, source) VALUES (?,?,?,?)');

let created = 0, installs = 0;
const pid = {};
for (const [name, vendor, metric, category, ent] of products) {
  created += insProduct.run(name, vendor, metric, category).changes;
  pid[name] = getProduct.get(vendor, name).id;
  if (ent && !hasEnt.get(pid[name])) insEnt.run(pid[name], ent[0], ent[1], ent[2], iso(ent[3]));
}

const give = (name, targets, key) => targets.forEach(t => {
  installs += insInstall.run(pid[name], key === 'agent' ? t : null, key === 'asset' ? t : null, 'demo').changes;
});

give('Microsoft 365 E5', agents, 'agent');                 // 8 agents pour 6 droits : sur-deploiement
give('Creative Cloud', agents.slice(3, 5), 'agent');       // 2 usages pour 5 droits : surdimensionne
give('Endpoint protection', [...laptops, ...desktops], 'asset'); // 6 pour 6 : limite atteinte
give('AutoCAD', [desktops[0]], 'asset');                   // 1 usage pour 4 droits : surdimensionne
give('Power BI Pro', agents.slice(0, 7), 'agent');         // 7 pour 8 : conforme
give('Remote access tool', agents.slice(4, 6), 'agent');   // 2 usages, 0 droit : sans droit

console.log(`✓ Produits SAM crees : ${created} (sur ${products.length})`);
console.log(`✓ Attributions creees : ${installs}`);
console.log('✓ Donnees 100% fictives - relance sans risque de doublon.');
