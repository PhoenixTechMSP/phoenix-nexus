// Cree les comptes manager et staff utilises par les scenarios e2e (l'admin vient de first-admin.js).
import bcrypt from 'bcryptjs';
import { db } from '../../server/db.js';

const hash = bcrypt.hashSync('UiTest1234!', 10);
for (const role of ['manager', 'staff']) {
  db.prepare(`INSERT OR IGNORE INTO users (email, password_hash, full_name, role, status) VALUES (?,?,?,?, 'active')`)
    .run(`${role}@test.local`, hash, `User ${role}`, role);
}
