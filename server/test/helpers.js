// Harnais de test Phase 0 - aucune nouvelle dépendance (node:test natif).
// Chaque fichier de test doit définir process.env.DB_PATH et process.env.PORT
// AVANT d'importer ce module, pour s'exécuter isolé des autres (base temporaire
// dédiée + port dédié par fichier de test).

import bcrypt from 'bcryptjs';

export async function startServer() {
  // On importe l'app (pas de app.listen() au moment de l'import depuis le fix
  // Phase 0 sur index.js) et on gère nous-mêmes le cycle de vie du serveur HTTP,
  // pour pouvoir le fermer proprement en fin de suite (sinon le process ne se
  // termine jamais - trouvé en le vivant ce soir).
  const { app } = await import('../index.js');
  // Port 0 = le systeme attribue un port LIBRE. Un port fixe par fichier provoquait des collisions des que deux processus
  // lancaient le meme fichier en meme temps (EADDRINUSE : tout le fichier tombait, cf. le test d'hermetisme qui relance
  // des fichiers pendant que le lanceur les execute). PORT n'est plus lu.
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise(r => server.close(r)) };
}

export async function seed(base) {
  const { db } = await import('../db.js');

  // Codes préfixés TEST* pour ne jamais entrer en collision avec le seed par défaut
  // de db.js (departments: GEN/OPS/WH/... - categories: PTX/LAPTOP/PPE/... - trouvé
  // en marchant dessus la première fois : seed() utilisait 'GEN' et 'PPE', déjà pris).
  const dept = db.prepare(`INSERT INTO departments (code, name) VALUES ('TESTDEPT','Test Department')`).run();
  const deptId = dept.lastInsertRowid;

  const catSerial = db.prepare(`INSERT INTO categories (code, name, kind, consumable) VALUES ('TESTLT','Test Laptop','IT',0)`).run();
  const catConsumable = db.prepare(`INSERT INTO categories (code, name, kind, consumable) VALUES ('TESTPPE','Test PPE','BUSINESS',1)`).run();

  const agent = db.prepare(`INSERT INTO agents (matricule, first_name, last_name, department_id) VALUES ('A001','Jean','Dupont', ?)`).run(deptId);

  const passwordHash = bcrypt.hashSync('Test1234!', 4); // coût réduit (4) - on veut des tests rapides, pas une vraie protection ici
  const users = {};
  for (const role of ['admin', 'manager', 'staff']) {
    const info = db.prepare(
      `INSERT INTO users (email, password_hash, full_name, role, status, department_id) VALUES (?,?,?,?,'active',?)`
    ).run(`${role}@test.local`, passwordHash, `Test ${role}`, role, deptId);
    users[role] = { id: info.lastInsertRowid, email: `${role}@test.local` };
  }

  const assetSerial = db.prepare(
    `INSERT INTO assets (asset_code, serial, category_id, status, department_id, quantity) VALUES ('LT-001','SN-001',?,'available',?,1)`
  ).run(catSerial.lastInsertRowid, deptId);

  const assetConsumable = db.prepare(
    `INSERT INTO assets (asset_code, category_id, status, department_id, quantity, min_quantity) VALUES ('TEST-PPE-GLOVES',?,'available',?,10,2)`
  ).run(catConsumable.lastInsertRowid, deptId);

  return {
    deptId,
    agentId: agent.lastInsertRowid,
    users,
    assetSerialId: assetSerial.lastInsertRowid,
    assetConsumableId: assetConsumable.lastInsertRowid,
  };
}

export async function loginAs(base, role) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${role}@test.local`, password: 'Test1234!' }),
  });
  if (!res.ok) throw new Error(`Login failed for ${role}: ${res.status}`);
  const { token } = await res.json();
  return token;
}

export function authed(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
