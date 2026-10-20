import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { sign, requireAuth } from '../middleware/auth.js';
import { loginLimiter } from '../lib/security.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  // Types verifies : un email numerique ou un objet faisait lever une exception (500) au lieu d'un 400.
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }
  const key = `${req.ip}|${email.toLowerCase()}`;
  const wait = loginLimiter.blockedFor(req.ip, key);
  if (wait) {
    res.set('Retry-After', String(wait));
    return res.status(429).json({ error: 'Too many failed attempts, try again later' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    loginLimiter.fail(req.ip, key);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  loginLimiter.reset(key);
  if (user.status !== 'active') return res.status(403).json({ error: `Account ${user.status}` });
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  const token = sign({ id: user.id, role: user.role, dept: user.department_id, name: user.full_name });
  res.json({
    token,
    user: {
      id: user.id, email: user.email, full_name: user.full_name,
      role: user.role, department_id: user.department_id, language: user.language,
    },
  });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(
    'SELECT id, email, full_name, role, department_id, language FROM users WHERE id = ?'
  ).get(req.user.id);
  res.json(user);
});
