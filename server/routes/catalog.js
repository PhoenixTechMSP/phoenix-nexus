import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { friendlyDbError } from '../lib/errors.js';

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

// ---- Categories ----
catalogRouter.get('/categories', (req, res) => {
  res.json(db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM assets a WHERE a.category_id = c.id) AS asset_count
    FROM categories c ORDER BY c.kind, c.name
  `).all());
});

catalogRouter.post('/categories', requireRole('admin', 'manager'), (req, res) => {
  const { code, name, kind = 'IT', consumable = 0 } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });
  if (!['IT', 'OT', 'BUSINESS'].includes(kind)) return res.status(400).json({ error: 'Invalid kind' });
  try {
    const info = db.prepare('INSERT INTO categories (code, name, kind, consumable) VALUES (?,?,?,?)')
      .run(String(code).toUpperCase().trim(), name.trim(), kind, consumable ? 1 : 0);
    res.json({ id: info.lastInsertRowid });
  } catch (e) { res.status(409).json({ error: friendlyDbError(e) }); }
});

catalogRouter.patch('/categories/:id', requireRole('admin', 'manager'), (req, res) => {
  const { code, name, kind, consumable } = req.body || {};
  if (kind && !['IT', 'OT', 'BUSINESS'].includes(kind)) return res.status(400).json({ error: 'Invalid kind' });
  try {
    db.prepare(`UPDATE categories SET code=COALESCE(?,code), name=COALESCE(?,name),
      kind=COALESCE(?,kind), consumable=COALESCE(?,consumable) WHERE id=?`)
      .run(code ? String(code).toUpperCase().trim() : null, name ?? null, kind ?? null,
        consumable === undefined ? null : (consumable ? 1 : 0), req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(409).json({ error: friendlyDbError(e) }); }
});

catalogRouter.delete('/categories/:id', requireRole('admin'), (req, res) => {
  const used = db.prepare('SELECT COUNT(*) n FROM assets WHERE category_id = ?').get(req.params.id).n;
  if (used) return res.status(409).json({ error: `Category still used by ${used} asset(s)` });
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Departments ----
catalogRouter.post('/departments', requireRole('admin', 'manager'), (req, res) => {
  const { code, name } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });
  try {
    const info = db.prepare('INSERT INTO departments (code, name) VALUES (?,?)')
      .run(String(code).toUpperCase().trim(), name.trim());
    res.json({ id: info.lastInsertRowid });
  } catch (e) { res.status(409).json({ error: friendlyDbError(e) }); }
});

catalogRouter.patch('/departments/:id', requireRole('admin', 'manager'), (req, res) => {
  const { code, name } = req.body || {};
  try {
    db.prepare('UPDATE departments SET code=COALESCE(?,code), name=COALESCE(?,name) WHERE id=?')
      .run(code ? String(code).toUpperCase().trim() : null, name ?? null, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(409).json({ error: friendlyDbError(e) }); }
});

catalogRouter.delete('/departments/:id', requireRole('admin'), (req, res) => {
  const assets = db.prepare('SELECT COUNT(*) n FROM assets WHERE department_id = ?').get(req.params.id).n;
  const users = db.prepare('SELECT COUNT(*) n FROM users WHERE department_id = ?').get(req.params.id).n;
  if (assets || users) return res.status(409).json({ error: `Department still used (${assets} assets, ${users} users)` });
  db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
