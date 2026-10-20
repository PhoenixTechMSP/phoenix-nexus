import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { emitIntegrationEvent } from '../lib/events.js';
import { processIntegrationEvents, backfillActiveAssets } from '../lib/cmdb-sync.js';
import { friendlyDbError } from '../lib/errors.js';

export const assetsRouter = Router();
assetsRouter.use(requireAuth);

const SELECT = `
  SELECT a.*, d.name AS department_name, d.code AS department_code,
    c.code AS category_code, c.name AS category_name, c.kind AS category_kind, c.consumable,
    ag.first_name || ' ' || ag.last_name AS agent_name, ag.matricule AS agent_matricule,
    u.full_name AS last_operator_name, u.email AS last_operator_email
  FROM assets a
  LEFT JOIN departments d ON d.id = a.department_id
  LEFT JOIN categories c ON c.id = a.category_id
  LEFT JOIN agents ag ON ag.id = a.current_agent_id
  LEFT JOIN users u ON u.id = a.last_operator_id
`;

// Accepts "PTX-0536 / 356966281334294", "PTX-0536" or a bare serial/IMEI
function parseCode(raw) {
  const [code, serial] = String(raw || '').split('/').map(s => s.trim());
  return { code: (code || '').toUpperCase(), serial: serial || null };
}

// Tolerant lookup: exact code, exact serial, combined "CODE / SERIAL" labels
// (whether the combined value is stored in asset_code or scanned from a label),
// and finally a code/serial prefix-suffix match.
function findAsset(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const full = trimmed.toUpperCase();
  const { code, serial } = parseCode(trimmed);
  const exact = db.prepare(
    `SELECT * FROM assets WHERE upper(trim(asset_code)) = ? OR upper(trim(COALESCE(serial,''))) = ? LIMIT 1`
  );
  const like = db.prepare(
    `SELECT * FROM assets WHERE upper(replace(asset_code,' ','')) LIKE ? LIMIT 1`
  );
  const ser = serial ? serial.toUpperCase() : null;
  return exact.get(full, full)
    || (code && code !== full ? exact.get(code, code) : null)
    || (ser ? exact.get(ser, ser) : null)
    // stored code is "PTX-0406 / 3569662813..." but only the code was scanned
    || (code ? like.get(`${code.replace(/\s/g, '')}/%`) : null)
    // stored code is the bare code but a combined label was scanned
    || (ser ? like.get(`%/${ser.replace(/\s/g, '')}`) : null)
    // a bare serial / IMEI was scanned but it lives inside a combined code
    || (!ser && code ? like.get(`%/${code.replace(/\s/g, '')}`) : null)
    // bare serial without "/" searched as suffix of a combined stored code
    || (!serial ? like.get(`%/${full.replace(/\s/g, '')}`) : null);
}

function logEvent(asset, req, type, statusAfter, notes, quantity = null) {
  db.prepare(`INSERT INTO asset_events
    (asset_id, agent_id, user_id, event_type, status_after, department_id, category_id, quantity, notes)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(asset.id, asset.current_agent_id || null, req.user.id, type, statusAfter,
      asset.department_id || null, asset.category_id || null, quantity, notes || null);
}

assetsRouter.get('/', (req, res) => {
  const { category_id, kind, department_id, status, q } = req.query;
  const where = [], params = [];
  if (category_id) { where.push('a.category_id = ?'); params.push(category_id); }
  if (kind) { where.push('c.kind = ?'); params.push(kind); }
  if (department_id) { where.push('a.department_id = ?'); params.push(department_id); }
  if (status) { where.push('a.status = ?'); params.push(status); }
  if (q) {
    where.push('(a.asset_code LIKE ? OR a.serial LIKE ? OR a.label LIKE ?)');
    const like = `%${q}%`; params.push(like, like, like);
  }
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.asset_code`;
  res.json(db.prepare(sql).all(...params));
});

assetsRouter.get('/lookup/:code', (req, res) => {
  const found = findAsset(req.params.code);
  if (!found) return res.status(404).json({ error: 'Asset not found' });
  const row = db.prepare(`${SELECT} WHERE a.id = ?`).get(found.id);
  res.json(row);
});

assetsRouter.get('/:id/history', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, ag.first_name || ' ' || ag.last_name AS agent_name,
      d.name AS department_name, u.full_name AS operator_name
    FROM asset_events e
    LEFT JOIN agents ag ON ag.id = e.agent_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN users u ON u.id = e.user_id
    WHERE e.asset_id = ? ORDER BY e.created_at DESC LIMIT 200
  `).all(req.params.id);
  res.json(rows);
});

// Create an asset (any category)
assetsRouter.post('/', requireRole('admin', 'manager'), (req, res) => {
  const { asset_code, serial, label, category_id, department_id, status = 'available',
    quantity = 1, min_quantity = 0, location, notes } = req.body || {};
  if (!asset_code) return res.status(400).json({ error: 'asset_code required' });
  if (!category_id) return res.status(400).json({ error: 'category_id required' });
  try {
    const info = db.prepare(`INSERT INTO assets
      (asset_code, serial, label, category_id, department_id, status, quantity, min_quantity, location, notes,
       last_operator_id, last_status_change_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
      .run(String(asset_code).toUpperCase().trim(), serial || null, label || null, category_id,
        department_id || null, status, Number(quantity) || 1, Number(min_quantity) || 0,
        location || null, notes || null, req.user.id);
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(info.lastInsertRowid);
    logEvent(asset, req, 'create', status, notes || null, asset.quantity);
    backfillActiveAssets(); // un asset cree directement en service doit avoir son CI
    res.json({ id: asset.id });
  } catch (e) { res.status(409).json({ error: friendlyDbError(e) }); }
});

assetsRouter.patch('/:id', requireRole('admin', 'manager'), (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  const b = req.body || {};
  const statusChanged = b.status && b.status !== asset.status;
  const newCode = b.asset_code ? String(b.asset_code).trim().toUpperCase() : null;
  if (newCode && newCode !== asset.asset_code) {
    const clash = db.prepare('SELECT id FROM assets WHERE asset_code = ? AND id <> ?').get(newCode, asset.id);
    if (clash) return res.status(409).json({ error: `Asset code ${newCode} already exists` });
  }
  try {
    db.prepare(`UPDATE assets SET
        asset_code=COALESCE(?,asset_code),
        serial=COALESCE(?,serial), label=COALESCE(?,label), category_id=COALESCE(?,category_id),
        department_id=COALESCE(?,department_id), status=COALESCE(?,status),
        quantity=COALESCE(?,quantity), min_quantity=COALESCE(?,min_quantity),
        location=COALESCE(?,location), notes=COALESCE(?,notes),
        last_operator_id=?, last_status_change_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE last_status_change_at END,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .run(newCode, b.serial ?? null, b.label ?? null, b.category_id ?? null, b.department_id ?? null,
        b.status ?? null, b.quantity ?? null, b.min_quantity ?? null, b.location ?? null,
        b.notes ?? null, req.user.id, statusChanged ? 1 : 0, asset.id);
  } catch (e) { return res.status(409).json({ error: friendlyDbError(e) }); }
  if (statusChanged) {
    const fresh = db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id);
    logEvent(fresh, req, 'status_change', b.status, b.notes || null);
    // Phase 1 Phoenix Nexus (ADR-001, symetrie de sortie) : un retrait doit
    // archiver le CI correspondant en CMDB, pas le laisser actif indefiniment.
    if (b.status === 'retired') {
      emitIntegrationEvent('asset', fresh.id, 'asset.retired', { asset_code: fresh.asset_code });
      processIntegrationEvents();
    }
  }
  backfillActiveAssets(); // passage en in_use par edition (sans check-out) : meme CI qu'un check-out
  res.json({ ok: true });
});


assetsRouter.delete('/:id', requireRole('admin'), (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  db.prepare('DELETE FROM assets WHERE id = ?').run(asset.id);
  res.json({ ok: true });
});

// Check-out: assign a serialised asset to an agent
assetsRouter.post('/:code/check-out', (req, res) => {
  const { agent_id, notes } = req.body || {};
  const asset = findAsset(req.params.code);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (asset.status !== 'available') return res.status(409).json({ error: `Asset is ${asset.status}` });
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent_id);
  if (!agent) return res.status(400).json({ error: 'Agent not found' });

  const deptId = agent.department_id || asset.department_id || null;
  db.transaction(() => {
    db.prepare(`UPDATE assets SET status='in_use', current_agent_id=?, department_id=?, last_operator_id=?,
      last_status_change_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(agent.id, deptId, req.user.id, asset.id);
    db.prepare(`INSERT INTO asset_events (asset_id, agent_id, user_id, event_type, status_after, department_id, category_id, notes)
      VALUES (?,?,?,'check_out','in_use',?,?,?)`)
      .run(asset.id, agent.id, req.user.id, deptId, asset.category_id, notes || null);

    // Phase 1 Phoenix Nexus (ADR-001) : declenche l'evenement d'entree en
    // service CMDB - "Attribue" pour les categories Nominative, "Deploye"
    // (conceptuel, meme statut applicatif pour l'instant) pour Infrastructure.
    const cat = db.prepare('SELECT equipment_class FROM categories WHERE id = ?').get(asset.category_id);
    emitIntegrationEvent('asset', asset.id, 'asset.activated', {
      asset_code: asset.asset_code,
      equipment_class: cat?.equipment_class || 'Nominative',
      department_id: deptId,
    });
  })();
  processIntegrationEvents(); // hors transaction ITAM - voir lib/cmdb-sync.js
  res.json({ ok: true });
});

// Check-in: return a serialised asset
assetsRouter.post('/:code/check-in', (req, res) => {
  const { status = 'available', notes } = req.body || {};
  if (!['available', 'defective', 'lost', 'stolen'].includes(status))
    return res.status(400).json({ error: 'Invalid return status' });
  const asset = findAsset(req.params.code);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (asset.status !== 'in_use') return res.status(409).json({ error: `Asset is not checked out (status: ${asset.status})` });

  db.transaction(() => {
    db.prepare(`UPDATE assets SET status=?, current_agent_id=NULL, last_operator_id=?,
      last_status_change_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(status, req.user.id, asset.id);
    db.prepare(`INSERT INTO asset_events (asset_id, agent_id, user_id, event_type, status_after, department_id, category_id, notes)
      VALUES (?,?,?,'check_in',?,?,?,?)`)
      .run(asset.id, asset.current_agent_id, req.user.id, status, asset.department_id, asset.category_id, notes || null);
  })();
  res.json({ ok: true });
});

// Consumables: issue stock to a department / agent
assetsRouter.post('/:code/consume', (req, res) => {
  const { quantity = 1, agent_id, department_id, notes } = req.body || {};
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Invalid quantity' });
  const asset = findAsset(req.params.code);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  if (asset.quantity < qty) return res.status(409).json({ error: `Only ${asset.quantity} left in stock` });
  db.transaction(() => {
    db.prepare(`UPDATE assets SET quantity = quantity - ?, last_operator_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(qty, req.user.id, asset.id);
    db.prepare(`INSERT INTO asset_events (asset_id, agent_id, user_id, event_type, status_after, department_id, category_id, quantity, notes)
      VALUES (?,?,?,'consume',NULL,?,?,?,?)`)
      .run(asset.id, agent_id || null, req.user.id, department_id || asset.department_id, asset.category_id, qty, notes || null);
  })();
  res.json({ ok: true });
});

// Consumables: restock
assetsRouter.post('/:code/restock', requireRole('admin', 'manager'), (req, res) => {
  const qty = Number(req.body?.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Invalid quantity' });
  const asset = findAsset(req.params.code);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  db.transaction(() => {
    db.prepare(`UPDATE assets SET quantity = quantity + ?, last_operator_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(qty, req.user.id, asset.id);
    logEvent(asset, req, 'restock', null, req.body?.notes || null, qty);
  })();
  res.json({ ok: true });
});

// Send to repair (any vendor, tracked per-asset via repair_vendor)
assetsRouter.post('/:code/repair-send', requireRole('admin', 'manager'), (req, res) => {
  const { repair_ticket, repair_vendor, notes } = req.body || {};
  const asset = findAsset(req.params.code);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  db.transaction(() => {
    db.prepare(`UPDATE assets SET status='repair', repair_ticket=?, repair_vendor=?, repair_sent_at=CURRENT_TIMESTAMP,
      repair_returned_at=NULL, repair_notes=?, last_operator_id=?, last_status_change_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(repair_ticket || null, repair_vendor || null, notes || null, req.user.id, asset.id);
    logEvent(asset, req, 'repair_send', 'repair',
      `Ticket: ${repair_ticket || 'n/a'} - ${repair_vendor || ''} ${notes || ''}`.trim());
  })();
  res.json({ ok: true });
});

assetsRouter.post('/:code/repair-return', requireRole('admin', 'manager'), (req, res) => {
  const { status = 'available', notes } = req.body || {};
  if (!['available', 'defective', 'retired'].includes(status))
    return res.status(400).json({ error: 'Invalid repair return status' });
  const asset = findAsset(req.params.code);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  db.transaction(() => {
    db.prepare(`UPDATE assets SET status=?, repair_returned_at=CURRENT_TIMESTAMP,
      repair_notes=COALESCE(?, repair_notes), last_operator_id=?, last_status_change_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(status, notes || null, req.user.id, asset.id);
    logEvent(asset, req, 'repair_return', status, notes || null);
  })();
  res.json({ ok: true });
});
