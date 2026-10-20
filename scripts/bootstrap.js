// Premier demarrage : cree le compte administrateur SI la base n'a encore aucun utilisateur. Sinon, ne fait rien.
//
//   ADMIN_EMAIL + ADMIN_PASSWORD (12+ caracteres) : compte choisi par vous.
//   Sinon : compte admin@phoenix-nexus.local avec un mot de passe aleatoire, affiche UNE seule fois dans les journaux.
//
// Ne modifie jamais un compte existant : relancer ne change aucun mot de passe.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const { db } = await import('../server/db.js');

if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) process.exit(0);

const email = (process.env.ADMIN_EMAIL || 'admin@phoenix-nexus.local').trim().toLowerCase();
let password = process.env.ADMIN_PASSWORD || '';
let generated = false;
if (!password) { password = crypto.randomBytes(12).toString('base64url'); generated = true; }
if (password.length < 12) {
  console.error('[bootstrap] ADMIN_PASSWORD doit faire 12 caracteres minimum.');
  process.exit(1);
}

db.prepare(`INSERT INTO users (email, password_hash, full_name, role, status, language) VALUES (?,?,?,?, 'active', 'en')`)
  .run(email, bcrypt.hashSync(password, 10), 'Administrator', 'admin');

console.log('[bootstrap] Premier demarrage : compte administrateur cree.');
console.log(`[bootstrap]   email        : ${email}`);
if (generated) {
  console.log(`[bootstrap]   mot de passe : ${password}`);
  console.log('[bootstrap]   Ce mot de passe n\'est affiche qu\'UNE fois. Changez-le dans Admin > Utilisateurs.');
}
process.exit(0);
