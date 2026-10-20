import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { friendlyDbError } from '../lib/errors.js';
import { computePosition, computeSummary, upcomingRenewals } from '../lib/sam.js';

export const samRouter = Router();
samRouter.use(requireAuth);
const canWrite = requireRole('admin', 'manager');

const METRICS = ['named_user', 'device', 'core', 'subscription'];
// Quel type d'objet consomme une licence, selon la metrique du contrat.
const COUNTED_BY = { named_user: 'agent', subscription: 'agent', device: 'asset', core: 'asset' };

const isIsoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isNonNegInt = n => Number.isInteger(n) && n >= 0;

samRouter.get('/summary', (req, res) => res.json(computeSummary()));
samRouter.get('/position', (req, res) => res.json(computePosition()));

samRouter.get('/renewals', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 730);
  res.json(upcomingRenewals(days));
});

samRouter.get('/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM software_products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const entitlements = db.prepare('SELECT * FROM licence_entitlements WHERE product_id = ? ORDER BY renewal_date').all(product.id);
  const installations = db.prepare(`
    SELECT i.*, a.first_name || ' ' || a.last_name AS agent_name, s.asset_code
    FROM software_installations i
    LEFT JOIN agents a ON a.id = i.agent_id
    LEFT JOIN assets s ON s.id = i.asset_id
    WHERE i.product_id = ? ORDER BY i.id
  `).all(product.id);
  res.json({ ...product, counted_by: COUNTED_BY[product.metric], entitlements, installations });
});

samRouter.post('/products', canWrite, (req, res) => {
  const { name, vendor, metric, category } = req.body || {};
  if (!name || !vendor) return res.status(400).json({ error: 'name and vendor are required' });
  if (!METRICS.includes(metric)) return res.status(400).json({ error: `metric must be one of: ${METRICS.join(', ')}` });
  try {
    const info = db.prepare('INSERT INTO software_products (name, vendor, metric, category) VALUES (?,?,?,?)')
      .run(String(name).trim(), String(vendor).trim(), metric, category ? String(category).trim() : null);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) { res.status(409).json({ error: friendlyDbError(e) }); }
});

samRouter.post('/entitlements', canWrite, (req, res) => {
  const { product_id, quantity, annual_cost = 0, contract_ref, renewal_date, notes } = req.body || {};
  if (!db.prepare('SELECT 1 FROM software_products WHERE id = ?').get(product_id)) {
    return res.status(404).json({ error: 'Product not found' });
  }
  if (!isNonNegInt(quantity)) return res.status(400).json({ error: 'quantity must be a non-negative integer' });
  if (typeof annual_cost !== 'number' || !(annual_cost >= 0)) return res.status(400).json({ error: 'annual_cost must be a non-negative number' });
  if (renewal_date && !isIsoDate(renewal_date)) return res.status(400).json({ error: 'renewal_date must be a valid YYYY-MM-DD date' });
  try {
    const info = db.prepare(
      'INSERT INTO licence_entitlements (product_id, quantity, annual_cost, contract_ref, renewal_date, notes) VALUES (?,?,?,?,?,?)'
    ).run(product_id, quantity, annual_cost, contract_ref || null, renewal_date || null, notes || null);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) { res.status(409).json({ error: friendlyDbError(e) }); }
});

samRouter.delete('/entitlements/:id', canWrite, (req, res) => {
  const info = db.prepare('DELETE FROM licence_entitlements WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Entitlement not found' });
  res.json({ ok: true });
});

samRouter.post('/installations', canWrite, (req, res) => {
  const { product_id, agent_id, asset_id, units = 1, last_used_at } = req.body || {};
  const product = db.prepare('SELECT * FROM software_products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  // Regle de coherence : la metrique du contrat dit ce qui consomme la licence.
  // Sans ca, un contrat "par appareil" compterait des agents et la position serait fausse.
  const expected = COUNTED_BY[product.metric];
  if (!!agent_id === !!asset_id) return res.status(400).json({ error: 'Provide exactly one of agent_id or asset_id' });
  if (expected === 'agent' && !agent_id) return res.status(400).json({ error: `Metric "${product.metric}" is counted per agent: agent_id is required` });
  if (expected === 'asset' && !asset_id) return res.status(400).json({ error: `Metric "${product.metric}" is counted per asset: asset_id is required` });
  if (!Number.isInteger(units) || units < 1) return res.status(400).json({ error: 'units must be an integer >= 1' });
  if (last_used_at && !isIsoDate(last_used_at)) return res.status(400).json({ error: 'last_used_at must be a valid YYYY-MM-DD date' });
  if (agent_id && !db.prepare('SELECT 1 FROM agents WHERE id = ?').get(agent_id)) return res.status(404).json({ error: 'Agent not found' });
  if (asset_id && !db.prepare('SELECT 1 FROM assets WHERE id = ?').get(asset_id)) return res.status(404).json({ error: 'Asset not found' });

  try {
    const info = db.prepare(
      'INSERT INTO software_installations (product_id, agent_id, asset_id, units, last_used_at) VALUES (?,?,?,?,?)'
    ).run(product_id, agent_id || null, asset_id || null, units, last_used_at || null);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'This licence is already assigned to that agent/asset' });
    res.status(500).json({ error: friendlyDbError(e) });
  }
});

samRouter.delete('/installations/:id', canWrite, (req, res) => {
  const info = db.prepare('DELETE FROM software_installations WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Installation not found' });
  res.json({ ok: true });
});
