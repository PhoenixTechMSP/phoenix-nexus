// Admin: CRUD users + roles
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { friendlyDbError } from '../lib/errors.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

// Any authenticated user can update their own preference (language)
usersRouter.patch('/me', (req, res) => {
  const { language } = req.body || {};
  if (language && !['en','fr','nl'].includes(language)) return res.status(400).json({ error: 'invalid language' });
  if (language) db.prepare('UPDATE users SET language=? WHERE id=?').run(language, req.user.id);
  res.json({ ok: true });
});

// Admin-only endpoints
usersRouter.use(requireRole('admin'));

usersRouter.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.email, u.full_name, u.role, u.status, u.department_id, u.oid, u.last_login_at, u.created_at,
           d.name AS department_name,
           CASE WHEN u.password_hash IS NULL THEN 0 ELSE 1 END AS has_password
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    ORDER BY u.created_at DESC
  `).all();
  res.json(rows);
});

usersRouter.post('/', (req, res) => {
  const { email, full_name, role, department_id, password } = req.body || {};
  if (!email || !full_name || !role) return res.status(400).json({ error: 'email, full_name, role required' });
  if (!['admin','manager','staff','pending'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  const hash = password ? bcrypt.hashSync(password, 10) : null;
  try {
    const info = db.prepare(
      `INSERT INTO users (email, password_hash, full_name, role, department_id, status) VALUES (?, ?, ?, ?, ?, 'active')`
    ).run(email.toLowerCase(), hash, full_name, role, department_id || null);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: friendlyDbError(e) });
  }
});

usersRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { full_name, role, department_id, status, password } = req.body || {};
  if (role && !['admin','manager','staff','pending'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  if (status && !['active','disabled','pending'].includes(status)) return res.status(400).json({ error: 'invalid status' });

  // Prevent locking out the last admin
  if ((role && role !== 'admin') || status === 'disabled') {
    const target = db.prepare('SELECT role, status FROM users WHERE id=?').get(id);
    if (target?.role === 'admin' && target?.status === 'active') {
      const activeAdmins = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role='admin' AND status='active'`).get().c;
      if (activeAdmins <= 1) return res.status(400).json({ error: 'Cannot remove/disable the last active admin' });
    }
  }

  const fields = [], params = [];
  if (full_name != null) { fields.push('full_name=?'); params.push(full_name); }
  if (role != null) { fields.push('role=?'); params.push(role); }
  if (department_id !== undefined) { fields.push('department_id=?'); params.push(department_id || null); }
  if (status != null) { fields.push('status=?'); params.push(status); }
  if (password) { fields.push('password_hash=?'); params.push(bcrypt.hashSync(password, 10)); }
  if (!fields.length) return res.json({ ok: true });
  params.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id=?`).run(...params);
  res.json({ ok: true });
});

usersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const target = db.prepare('SELECT role, status FROM users WHERE id=?').get(id);
  if (target?.role === 'admin' && target?.status === 'active') {
    const activeAdmins = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role='admin' AND status='active'`).get().c;
    if (activeAdmins <= 1) return res.status(400).json({ error: 'Cannot delete the last active admin' });
  }
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});
