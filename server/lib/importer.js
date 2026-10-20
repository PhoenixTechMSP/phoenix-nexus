import { db } from '../db.js';
import { norm, resolve } from './tabular.js';

const STATUSES = ['available', 'in_use', 'defective', 'repair', 'lost', 'stolen', 'retired'];
// norm() retire les non-alphanumeriques ('in_use' -> 'inuse') : comparer les clefs normalisees
// des deux cotes, sinon 'in_use' retombait silencieusement sur 'available'.
const STATUS_BY_KEY = Object.fromEntries(STATUSES.map(st => [norm(st), st]));

function lookupMaps() {
  const dept = new Map(db.prepare('SELECT id, code, name FROM departments').all()
    .flatMap(d => [[norm(d.code), d.id], [norm(d.name), d.id]]));
  const cat = new Map(db.prepare('SELECT id, code, name FROM categories').all()
    .flatMap(c => [[norm(c.code), c.id], [norm(c.name), c.id]]));
  return { dept, cat };
}

function extraNotes(row, extras = []) {
  return extras
    .map(h => {
      const v = row[h];
      return v === undefined || v === null || String(v).trim() === '' ? '' : `${h}: ${String(v).trim()}`;
    })
    .filter(Boolean)
    .join(' | ');
}

/**
 * Mapped asset import.
 * mapping: { fields: {...}, notesExtra: [header], onDuplicate: 'update'|'duplicate'|'skip' }
 *  - update    : overwrite the existing row (default)
 *  - duplicate : keep the existing row and add a new one with a suffixed code
 *  - skip      : leave the existing row untouched and report the line
 */
export function importAssetsMapped(rows, mapping, { dryRun = false } = {}) {
  const fields = mapping.fields || {};
  const policy = ['update', 'duplicate', 'skip'].includes(mapping.onDuplicate) ? mapping.onDuplicate : 'update';
  const { dept, cat } = lookupMaps();

  const existingBySerial = new Map(db.prepare(
    `SELECT asset_code, serial FROM assets WHERE serial IS NOT NULL AND serial <> ''`
  ).all().map(r => [r.serial, r.asset_code]));
  const allCodes = new Set(db.prepare('SELECT asset_code FROM assets').all().map(r => r.asset_code));
  const existsCode = db.prepare('SELECT id FROM assets WHERE asset_code = ?');

  const insert = db.prepare(`
    INSERT INTO assets (asset_code, serial, label, category_id, department_id, status, quantity, min_quantity, location, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

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

  let inserted = 0, updated = 0, duplicated = 0;
  const skipped = [];
  const warnings = [];
  const duplicates = [];
  const sample = [];
  const seen = new Map();

  // Free code variant such as PTX-0406-D2 when the same code comes back
  const freeCode = (code) => {
    for (let n = 2; n < 1000; n++) {
      const candidate = `${code}-D${n}`;
      if (!allCodes.has(candidate) && !seen.has(candidate)) return candidate;
    }
    return `${code}-D${Date.now()}`;
  };

  const run = db.transaction(() => {
    rows.forEach((row, i) => {
      const line = i + 2;
      const get = (k) => resolve(row, fields[k]);
      let code = get('asset_code').toUpperCase();
      let serial = get('serial');
      const catRaw = get('category');
      const deptRaw = get('department');

      if (!code) { skipped.push({ line, asset: code, serial, reason: 'Missing asset code' }); return; }

      // --- Duplicate detection: same code in the file, in the database, or serial already used
      const inFile = seen.get(code);
      const inDb = !!existsCode.get(code);
      const serialOwner = serial ? existingBySerial.get(serial) : null;
      const serialClash = !!serialOwner && serialOwner !== code;
      const isDuplicate = inFile !== undefined || inDb || serialClash;
      let mode = 'insert';

      if (isDuplicate) {
        const reason = inFile !== undefined
          ? `Duplicate code in file (line ${inFile})`
          : inDb ? 'Asset code already exists'
            : `Serial/IMEI already used by ${serialOwner}`;
        duplicates.push({ line, asset: code, serial, reason, action: policy });

        if (policy === 'skip') {
          skipped.push({ line, asset: code, serial, reason: `${reason} - skipped` });
          return;
        }
        if (policy === 'duplicate') {
          const original = code;
          if (inFile !== undefined || inDb) code = freeCode(code);
          if (serialClash || inFile !== undefined) {
            // serial is unique in the database: keep the value only as a note
            if (serial) warnings.push({ line, asset: code, reason: `Serial ${serial} kept on ${serialOwner || original} - stored in notes` });
            serial = '';
          }
          mode = 'duplicate';

        } else {
          mode = serialClash && !inDb ? 'skip-serial' : 'update';
          if (mode === 'skip-serial') {
            skipped.push({ line, asset: code, serial, reason: `Serial/IMEI already used by ${serialOwner}` });
            return;
          }
          if (inFile !== undefined) mode = 'update';
        }
      }
      seen.set(code, line);

      const categoryId = catRaw ? cat.get(norm(catRaw)) : null;
      if (catRaw && !categoryId) {
        skipped.push({ line, asset: code, serial, reason: `Unknown category "${catRaw}"` });
        return;
      }
      if (!categoryId && !existsCode.get(code)) {
        skipped.push({ line, asset: code, serial, reason: 'Missing category' });
        return;
      }
      const departmentId = deptRaw ? dept.get(norm(deptRaw)) || null : null;
      if (deptRaw && !departmentId) warnings.push({ line, asset: code, reason: `Unknown department "${deptRaw}" - imported without department` });

      const statusRaw = norm(get('status'));
      const status = STATUS_BY_KEY[statusRaw] || 'available';
      const quantity = Number(get('quantity')) > 0 ? Number(get('quantity')) : 1;
      const minQuantity = Number(get('min_quantity')) > 0 ? Number(get('min_quantity')) : 0;
      const extraSerial = mode === 'duplicate' && get('serial') && !serial ? `serial: ${get('serial')}` : '';
      const notes = [get('notes'), extraNotes(row, mapping.notesExtra), extraSerial].filter(Boolean).join(' | ');

      const before = existsCode.get(code);
      const action = mode === 'duplicate' ? 'duplicate' : (before ? 'update' : 'insert');
      if (sample.length < 10) {
        sample.push({ line, asset_code: code, serial, label: get('label'), category: catRaw, department: deptRaw, status, quantity, notes, action });
      }
      if (!dryRun) {
        try {
          const args = [code, serial || null, get('label') || null, categoryId, departmentId,
            status, quantity, minQuantity, get('location') || null, notes || null];
          if (mode === 'duplicate') insert.run(...args); else upsert.run(...args);
        } catch (e) {
          skipped.push({ line, asset: code, serial, reason: e.message });
          return;
        }
      }
      if (action === 'duplicate') duplicated++;
      else if (before) updated++;
      else inserted++;
      allCodes.add(code);
      if (serial) existingBySerial.set(serial, code);
    });
    if (dryRun) throw { rollback: true };
  });

  try { run(); } catch (e) { if (!e || !e.rollback) throw e; }

  return { target: 'assets', dryRun, onDuplicate: policy, total: rows.length, inserted, updated, duplicated, skipped, duplicates, warnings, sample };
}


/** Mapped agent import (same duplicate policy as assets). */
export function importAgentsMapped(rows, mapping, { dryRun = false } = {}) {
  const fields = mapping.fields || {};
  const policy = ['update', 'duplicate', 'skip'].includes(mapping.onDuplicate) ? mapping.onDuplicate : 'update';
  const { dept } = lookupMaps();

  const insert = db.prepare(`INSERT INTO agents (matricule, first_name, last_name, department_id) VALUES (?,?,?,?)`);
  const updateByMat = db.prepare(`UPDATE agents SET first_name=?, last_name=?, department_id=COALESCE(?, department_id) WHERE matricule=?`);
  const findByMat = db.prepare('SELECT id FROM agents WHERE matricule = ?');
  const findByName = db.prepare('SELECT id FROM agents WHERE lower(first_name)=lower(?) AND lower(last_name)=lower(?)');

  let inserted = 0, updated = 0, duplicated = 0;
  const skipped = [];
  const warnings = [];
  const duplicates = [];
  const sample = [];

  const run = db.transaction(() => {
    rows.forEach((row, i) => {
      const line = i + 2;
      const get = (k) => resolve(row, fields[k]);
      let first = get('first_name');
      let last = get('last_name');
      const full = get('full_name');

      if ((!first || !last) && full) {
        if (full.includes(',')) {
          const [l, f] = full.split(',');
          last = last || (l || '').trim();
          first = first || (f || '').trim();
        } else {
          const parts = full.split(/\s+/);
          if (!first) first = parts.shift() || '';
          if (!last) last = parts.join(' ');
        }
      }
      if (!first && last) { first = last; last = ''; }
      if (!first) { skipped.push({ line, reason: 'Missing agent name' }); return; }

      let mat = get('matricule') || null;
      const deptRaw = get('department');
      const departmentId = deptRaw ? dept.get(norm(deptRaw)) || null : null;
      if (deptRaw && !departmentId) warnings.push({ line, reason: `Unknown department "${deptRaw}" - agent imported without department` });

      const existing = mat ? findByMat.get(mat) : findByName.get(first, last);
      let action = existing ? 'update' : 'insert';

      if (existing) {
        const reason = mat ? `Staff ID ${mat} already exists` : `Agent ${first} ${last} already exists`;
        duplicates.push({ line, asset: mat || `${first} ${last}`, reason, action: policy });
        if (policy === 'skip') { skipped.push({ line, reason: `${reason} - skipped` }); return; }
        if (policy === 'duplicate') {
          if (mat) { warnings.push({ line, reason: `Staff ID ${mat} kept on the existing agent - new record created without it` }); mat = null; }
          action = 'duplicate';
        }
      }

      if (sample.length < 10) {
        sample.push({ line, matricule: mat, first_name: first, last_name: last, department: deptRaw, action });
      }
      if (!dryRun) {
        try {
          if (action === 'update' && mat) updateByMat.run(first, last, departmentId, mat);
          else if (action === 'update') { /* nothing to update reliably */ }
          else insert.run(mat, first, last, departmentId);
        } catch (e) { skipped.push({ line, reason: e.message }); return; }
      }
      if (action === 'duplicate') duplicated++;
      else if (existing) updated++;
      else inserted++;
    });
    if (dryRun) throw { rollback: true };
  });

  try { run(); } catch (e) { if (!e || !e.rollback) throw e; }

  return { target: 'agents', dryRun, onDuplicate: policy, total: rows.length, inserted, imported: inserted, updated, duplicated, skipped, duplicates, warnings, sample };
}

