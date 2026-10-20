// Usage: node scripts/first-admin.js <email> <password> "<full name>"
import bcrypt from 'bcryptjs';
import { db } from '../server/db.js';

const [email, password, fullName] = process.argv.slice(2);
if (!email || !password || !fullName) {
  console.error('Usage: node scripts/first-admin.js <email> <password> "<Full Name>"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
try {
  const info = db.prepare(`INSERT INTO users (email, password_hash, full_name, role, status) VALUES (?, ?, ?, 'admin', 'active')`)
    .run(email.toLowerCase(), hash, fullName);
  console.log(`✓ Admin created (id=${info.lastInsertRowid}) - email: ${email}`);
} catch (e) {
  if (String(e.message).includes('UNIQUE')) {
    db.prepare(`UPDATE users SET password_hash=?, full_name=?, role='admin', status='active' WHERE email=?`).run(hash, fullName, email.toLowerCase());
    console.log(`✓ Admin updated - email: ${email}`);
  } else { console.error(e.message); process.exit(1); }
}
