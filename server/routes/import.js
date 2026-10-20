import { Router } from 'express';
import { backfillActiveAssets } from '../lib/cmdb-sync.js';
import multer from 'multer';
import XLSX from 'xlsx';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const importRouter = Router();
importRouter.use(requireAuth, requireRole('admin', 'manager'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const key = (s) => String(s).trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]/g, '');

function readRows(file) {
  const wb = XLSX.read(file.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  return rows.map(obj => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[key(k)] = typeof v === 'string' ? v.trim() : v;
    return out;
  });
}

const pick = (r, names) => {
  for (const n of names) {
    const v = r[key(n)];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

const STATUSES = ['available', 'in_use', 'defective', 'repair', 'lost', 'stolen', 'retired'];
// key() retire tout caractere non alphanumerique : 'in_use' devient 'inuse'. Comparer les
// clefs normalisees des DEUX cotes, sinon 'in_use' retombait silencieusement sur 'available'.
const STATUS_BY_KEY = Object.fromEntries(STATUSES.map(st => [key(st), st]));


function lookupMaps() {
  const dept = new Map(db.prepare('SELECT id, code, name FROM departments').all()
    .flatMap(d => [[key(d.code), d.id], [key(d.name), d.id]]));
  const cat = new Map(db.prepare('SELECT id, code, name FROM categories').all()
    .flatMap(c => [[key(c.code), c.id], [key(c.name), c.id]]));
  return { dept, cat };
}

// Generic CMDB import: any IT / OT / business asset or consumable.
// Columns (case & accent tolerant, EN/FR/NL):
//   Asset / Code / PTX, Serial / IMEI / Numero de serie, Label, Category, Department,
//   Status, Quantity, Min quantity, Location, Notes
function importAssets(req, res, defaultCategoryCode = null) {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const rows = readRows(req.file);
  const { dept, cat } = lookupMaps();
  const fallbackCat = defaultCategoryCode ? cat.get(key(defaultCategoryCode)) || null : null;

  const existingBySerial = new Map(db.prepare(`SELECT asset_code, serial FROM assets WHERE serial IS NOT NULL AND serial <> ''`)
    .all().map(r => [r.serial, r.asset_code]));

  const upsert = db.prepare(`
    INSERT INTO assets (asset_code, serial, label, category_id, department_id, status, quantity, min_quantity, location, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(asset_code) DO UPDATE SET
      serial=COALESCE(NULLIF(excluded.serial,''), assets.serial),
      label=COALESCE(NULLIF(excluded.label,''), assets.label),
      category_id=COALESCE(excluded.category_id, assets.category_id),
      department_id=COALESCE(excluded.department_id, assets.department_id),
      status=COALESCE(excluded.status, assets.status),
      quantity=excluded.quantity,
      min_quantity=excluded.min_quantity,
      location=COALESCE(NULLIF(excluded.location,''), assets.location),
      notes=COALESCE(NULLIF(excluded.notes,''), assets.notes),
      updated_at=CURRENT_TIMESTAMP`);

  let inserted = 0, updated = 0;
  const skipped = [];
  const seen = new Map();

  db.transaction(() => {
    rows.forEach((r, i) => {
      const line = i + 2;
      const code = (pick(r, ['asset', 'asset_code', 'code', 'ptx', 'equipement', 'equipment', 'item', 'tag']) || '').toUpperCase();
      const serial = pick(r, ['serial', 'imei', 'serial_number', 'numero de serie', 'serienummer', 'sn']);
      const catRaw = pick(r, ['category', 'categorie', 'categorie', 'type', 'categorie asset', 'categorie']);
      const deptRaw = pick(r, ['department', 'departement', 'dept', 'afdeling', 'service']);
      const statusRaw = key(pick(r, ['status', 'statut', 'etat', 'staat']));
      const qtyRaw = pick(r, ['quantity', 'qty', 'quantite', 'aantal', 'stock']);
      const minRaw = pick(r, ['min_quantity', 'min', 'minimum', 'seuil', 'minimum stock']);

      if (!code) { skipped.push({ line, asset: code, serial, reason: 'Missing asset code' }); return; }
      if (seen.has(code)) { skipped.push({ line, asset: code, serial, reason: `Duplicate code in file (line ${seen.get(code)})` }); return; }
      seen.set(code, line);

      const categoryId = (catRaw && cat.get(key(catRaw))) || fallbackCat;
      if (!categoryId) {
        skipped.push({ line, asset: code, serial, reason: catRaw ? `Unknown category "${catRaw}"` : 'Missing category' });
        return;
      }
      if (serial) {
        const owner = existingBySerial.get(serial);
        if (owner && owner !== code) {
          skipped.push({ line, asset: code, serial, reason: `Serial/IMEI already used by ${owner}` });
          return;
        }
      }
      const departmentId = deptRaw ? dept.get(key(deptRaw)) || null : null;
      if (deptRaw && !departmentId) skipped.push({ line, asset: code, serial, reason: `Unknown department "${deptRaw}" - imported without department` });

      const status = STATUS_BY_KEY[statusRaw] || 'available';
      const quantity = Number(qtyRaw) > 0 ? Number(qtyRaw) : 1;
      const minQuantity = Number(minRaw) > 0 ? Number(minRaw) : 0;

      try {
        const before = db.prepare('SELECT id FROM assets WHERE asset_code = ?').get(code);
        upsert.run(code, serial || null, pick(r, ['label', 'name', 'description', 'libelle', 'naam']) || null,
          categoryId, departmentId, status, quantity, minQuantity,
          pick(r, ['location', 'emplacement', 'locatie', 'zone']) || null,
          pick(r, ['notes', 'note', 'remarque', 'opmerking']) || null);
        if (before) updated++; else inserted++;
        if (serial) existingBySerial.set(serial, code);
      } catch (e) {
        skipped.push({ line, asset: code, serial, reason: e.message });
      }
    });
  })();

  backfillActiveAssets(); // lignes importees directement en in_use -> CI
  res.json({ inserted, updated, skipped, total: rows.length });
}

importRouter.post('/assets', upload.single('file'), (req, res) => importAssets(req, res, req.query.category || null));
// Backward compatible PTX-only import (category defaults to PTX)
importRouter.post('/ptx', upload.single('file'), (req, res) => importAssets(req, res, 'PTX'));

// Agents import. Accepts separate first/last name columns or a single full-name
// column, in EN/FR/NL. Header matching is case/accent tolerant.
importRouter.post('/agents', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const clean = readRows(req.file);
  const { dept } = lookupMaps();

  const insert = db.prepare(`INSERT INTO agents (matricule, first_name, last_name, department_id) VALUES (?, ?, ?, ?)`);
  const updateByMat = db.prepare(`UPDATE agents SET first_name=?, last_name=?, department_id=COALESCE(?, department_id) WHERE matricule=?`);
  const findByMat = db.prepare('SELECT id FROM agents WHERE matricule = ?');
  const findByName = db.prepare('SELECT id FROM agents WHERE lower(first_name)=lower(?) AND lower(last_name)=lower(?)');

  let imported = 0, updated = 0;
  const skipped = [];

  db.transaction(() => {
    clean.forEach((r, i) => {
      const line = i + 2;
      let first = pick(r, ['first_name', 'firstname', 'prenom', 'voornaam', 'given name']);
      let last = pick(r, ['last_name', 'lastname', 'nom', 'naam', 'achternaam', 'surname', 'family name']);
      const full = pick(r, ['name', 'full_name', 'fullname', 'agent', 'nom complet', 'nom prenom', 'volledige naam']);

      if ((!first || !last) && full) {
        if (full.includes(',')) {
          const [l, f] = full.split(',');
          last = (last || l || '').trim();
          first = (first || f || '').trim();
        } else {
          const parts = full.split(/\s+/);
          if (!first) first = parts.shift() || '';
          if (!last) last = parts.join(' ');
        }
      }
      if (!first && last) { first = last; last = ''; }
      if (!first) { skipped.push({ line, reason: 'Missing agent name' }); return; }

      const mat = pick(r, ['matricule', 'badge', 'badge_id', 'id', 'employee_id', 'employeeid', 'personeelsnummer', 'agent_id']) || null;
      const deptRaw = pick(r, ['department', 'departement', 'dept', 'afdeling', 'service']);
      const departmentId = deptRaw ? dept.get(key(deptRaw)) || null : null;
      if (deptRaw && !departmentId) skipped.push({ line, reason: `Unknown department "${deptRaw}" - agent imported without department` });

      try {
        if (mat && findByMat.get(mat)) { updateByMat.run(first, last, departmentId, mat); updated++; return; }
        if (!mat && findByName.get(first, last)) { updated++; return; }
        insert.run(mat, first, last, departmentId);
        imported++;
      } catch (e) {
        skipped.push({ line, reason: e.message });
      }
    });
  })();

  res.json({ imported, updated, skipped, total: clean.length });
});

// ---------------------------------------------------------------------------
// v1.5 - Guided import with column mapping (BOM/delimiter tolerant, dry-run)
// ---------------------------------------------------------------------------
import { readTable as readTable2, autoMap, FIELDS } from '../lib/tabular.js';
import { importAssetsMapped, importAgentsMapped } from '../lib/importer.js';
import crypto from 'crypto';

const signature = (headers) => crypto.createHash('sha1')
  .update(headers.map(h => h.trim().toLowerCase()).join('|')).digest('hex');

const targetOf = (v) => (v === 'agents' ? 'agents' : 'assets');

// Step 1: parse the file, return headers + preview rows + suggested mapping
importRouter.post('/preview', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const target = targetOf(req.query.target || req.body?.target);
  let parsed;
  try { parsed = readTable2(req.file); }
  catch (e) { return res.status(400).json({ error: `Unreadable file: ${e.message}` }); }
  const { headers, rows } = parsed;
  if (!headers.length) return res.status(400).json({ error: 'No columns detected in the first sheet' });

  const sig = signature(headers);
  const saved = db.prepare('SELECT mapping FROM import_profiles WHERE target=? AND signature=?').get(target, sig);
  const mapping = saved ? JSON.parse(saved.mapping) : { fields: autoMap(headers, target, rows), notesExtra: [] };

  res.json({
    target,
    signature: sig,
    headers,
    fields: (FIELDS[target] || []).map(f => f.key),
    rowCount: rows.length,
    preview: rows.slice(0, 5),
    mapping,
    savedProfile: !!saved,
  });
});

// Step 2: apply the mapping (dryRun=1 simulates without writing anything)
importRouter.post('/commit', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const target = targetOf(req.query.target || req.body?.target);
  const dryRun = String(req.query.dryRun ?? req.body?.dryRun ?? '') === '1';
  let mapping;
  try { mapping = JSON.parse(req.body?.mapping || '{}'); }
  catch { return res.status(400).json({ error: 'Invalid mapping payload' }); }
  if (!mapping.fields) return res.status(400).json({ error: 'Missing mapping' });

  let parsed;
  try { parsed = readTable2(req.file); }
  catch (e) { return res.status(400).json({ error: `Unreadable file: ${e.message}` }); }

  let result;
  try {
    result = target === 'agents'
      ? importAgentsMapped(parsed.rows, mapping, { dryRun })
      : importAssetsMapped(parsed.rows, mapping, { dryRun });
  } catch (e) { return res.status(400).json({ error: e.message }); }

  if (!dryRun && String(req.query.remember ?? req.body?.remember ?? '1') === '1') {
    const sig = signature(parsed.headers);
    db.prepare(`INSERT INTO import_profiles (name, target, signature, mapping) VALUES (?,?,?,?)
      ON CONFLICT(target, signature) DO UPDATE SET mapping=excluded.mapping, name=excluded.name, updated_at=CURRENT_TIMESTAMP`)
      .run(req.file.originalname || 'profile', target, sig, JSON.stringify(mapping));
  }
  // Jamais en dry-run : une simulation ne doit rien ecrire, CMDB comprise.
  if (!dryRun && target === 'assets') backfillActiveAssets();
  res.json(result);
});
