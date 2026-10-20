import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { friendlyDbError } from '../lib/errors.js';

export const agentsRouter = Router();
agentsRouter.use(requireAuth);

agentsRouter.get('/', (req, res) => {
  const { q } = req.query;
  let sql = `SELECT a.*, d.name AS department_name FROM agents a LEFT JOIN departments d ON d.id = a.department_id WHERE a.active = 1`;
  const params = [];
  if (q) {
    sql += ` AND (a.first_name LIKE ? OR a.last_name LIKE ? OR a.matricule LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ` ORDER BY a.last_name, a.first_name LIMIT 50`;
  res.json(db.prepare(sql).all(...params));
});

agentsRouter.post('/', requireRole('admin','manager'), (req, res) => {
  const { matricule, first_name, last_name, department_id } = req.body || {};
  if (!first_name || !last_name) return res.status(400).json({ error: 'Name required' });
  try {
    const info = db.prepare(`INSERT INTO agents (matricule, first_name, last_name, department_id) VALUES (?, ?, ?, ?)`)
      .run(matricule || null, first_name, last_name, department_id || null);
    res.json({ id: info.lastInsertRowid });
  } catch (e) { res.status(409).json({ error: friendlyDbError(e) }); }
});

agentsRouter.patch('/:id', requireRole('admin','manager'), (req, res) => {
  const { matricule, first_name, last_name, department_id, active } = req.body || {};
  db.prepare(`UPDATE agents SET matricule=COALESCE(?,matricule), first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name), department_id=COALESCE(?,department_id), active=COALESCE(?,active) WHERE id=?`)
    .run(matricule ?? null, first_name ?? null, last_name ?? null, department_id ?? null, active ?? null, req.params.id);
  res.json({ ok: true });
});
