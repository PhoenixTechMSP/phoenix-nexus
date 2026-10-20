import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { friendlyDbError } from '../lib/errors.js';

export const cmdbRouter = Router();
cmdbRouter.use(requireAuth);

cmdbRouter.get('/items', (req, res) => {
  const { status } = req.query;
  const items = status
    ? db.prepare(`SELECT * FROM configuration_items WHERE status = ? ORDER BY id DESC`).all(status)
    : db.prepare(`SELECT * FROM configuration_items ORDER BY id DESC`).all();
  res.json(items);
});

cmdbRouter.get('/items/:id', (req, res) => {
  const item = db.prepare(`SELECT * FROM configuration_items WHERE id = ?`).get(req.params.id);
  if (!item) return res.status(404).json({ error: 'CI not found' });
  const relationships = db.prepare(`
    SELECT r.*, c.label AS target_label, c.ci_type AS target_type
    FROM ci_relationships r JOIN configuration_items c ON c.id = r.target_ci_id
    WHERE r.source_ci_id = ?
  `).all(item.id);
  // Relations entrantes : vue depuis l'autre extremite (qui depend de / pointe vers ce CI).
  const incoming = db.prepare(`
    SELECT r.*, c.label AS source_label, c.ci_type AS source_type
    FROM ci_relationships r JOIN configuration_items c ON c.id = r.source_ci_id
    WHERE r.target_ci_id = ?
  `).all(item.id);
  res.json({ ...item, relationships, incoming });
});

// Les relations sont une donnée propre à la CMDB (ADR-001, point 2) - jamais
// générées depuis l'ITAM, toujours créées manuellement ou par un futur
// connecteur dédié (Phase 6).
cmdbRouter.post('/relationships', requireRole('admin', 'manager'), (req, res) => {
  const { source_ci_id, target_ci_id, relationship_type } = req.body || {};
  if (!source_ci_id || !target_ci_id || !relationship_type) {
    return res.status(400).json({ error: 'source_ci_id, target_ci_id et relationship_type sont requis' });
  }
  if (source_ci_id === target_ci_id) {
    return res.status(400).json({ error: 'Un CI ne peut pas être en relation avec lui-même' });
  }
  const a = db.prepare('SELECT id FROM configuration_items WHERE id = ?').get(source_ci_id);
  const b = db.prepare('SELECT id FROM configuration_items WHERE id = ?').get(target_ci_id);
  if (!a || !b) return res.status(404).json({ error: 'CI source ou cible introuvable' });
  try {
    const info = db.prepare(
      `INSERT INTO ci_relationships (source_ci_id, target_ci_id, relationship_type) VALUES (?,?,?)`
    ).run(source_ci_id, target_ci_id, relationship_type);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    // Un doublon est le seul echec "normal" ici : phrase metier lisible plutot que
    // le message generique (qui nommerait des champs techniques). Le reste passe
    // par le helper sur (lib/errors.js) : jamais de detail SQLite vers l'ecran.
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'This relationship already exists' });
    }
    res.status(500).json({ error: friendlyDbError(e) });
  }
});

cmdbRouter.delete('/relationships/:id', requireRole('admin', 'manager'), (req, res) => {
  const info = db.prepare(`DELETE FROM ci_relationships WHERE id = ?`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Relationship not found' });
  res.json({ ok: true });
});
