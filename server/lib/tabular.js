import XLSX from 'xlsx';

/** Strip a UTF-8 BOM and normalise line endings. */
function decode(buffer) {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n?/g, '\n');
}

/** Guess the CSV delimiter from the header line. */
function guessDelimiter(line) {
  const candidates = [';', ',', '\t', '|'];
  let best = ',', bestCount = -1;
  for (const d of candidates) {
    const n = line.split(d).length - 1;
    if (n > bestCount) { best = d; bestCount = n; }
  }
  return bestCount > 0 ? best : ',';
}

const looksCsv = (name = '') => /\.(csv|txt|tsv)$/i.test(name);

/**
 * Read an uploaded xlsx / xls / csv buffer into { headers, rows }.
 * CSV: BOM tolerant + delimiter auto-detection (';', ',', tab, '|').
 */
export function readTable(file) {
  let wb;
  if (looksCsv(file.originalname)) {
    const text = decode(file.buffer);
    const firstLine = text.split('\n', 1)[0] || '';
    wb = XLSX.read(text, { type: 'string', raw: false, FS: guessDelimiter(firstLine) });
  } else {
    wb = XLSX.read(file.buffer, { type: 'buffer' });
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };

  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  const headerRow = matrix[0] || [];
  const headers = headerRow.map((h) => String(h ?? '').trim()).filter((h) => h !== '');
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }).map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      out[String(k).replace(/^\ufeff/, '').trim()] = typeof v === 'string' ? v.trim() : v;
    }
    return out;
  });
  return { headers, rows };
}

export const norm = (s) => String(s ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

/** Target field catalogue used by the mapping UI. */
export const FIELDS = {
  assets: [
    { key: 'asset_code', synonyms: ['assetcode', 'code', 'ptx', 'asset', 'device', 'devicename', 'tag', 'inventory', 'reference', 'equipment'] },
    { key: 'serial', synonyms: ['serial', 'serialnumber', 'imei', 'numerodeserie', 'serienummer', 'sn', 'mac'] },
    { key: 'label', synonyms: ['label', 'name', 'description', 'libelle', 'naam', 'designation', 'model', 'username', 'user'] },
    { key: 'category', synonyms: ['category', 'categorie', 'type', 'famille', 'family', 'group'] },
    { key: 'department', synonyms: ['department', 'departement', 'dept', 'afdeling', 'service', 'team'] },
    { key: 'status', synonyms: ['status', 'statut', 'etat', 'staat', 'state'] },
    { key: 'quantity', synonyms: ['quantity', 'qty', 'quantite', 'aantal', 'stock'] },
    { key: 'min_quantity', synonyms: ['minquantity', 'min', 'minimum', 'seuil'] },
    { key: 'location', synonyms: ['location', 'emplacement', 'locatie', 'zone', 'site'] },
    { key: 'notes', synonyms: ['notes', 'note', 'remarque', 'comment', 'opmerking', 'telnumber', 'phone', 'tel'] },
  ],
  agents: [
    { key: 'matricule', synonyms: ['matricule', 'badge', 'employeeid', 'personeelsnummer', 'id', 'agentid', 'staffid'] },
    { key: 'first_name', synonyms: ['firstname', 'prenom', 'voornaam', 'givenname'] },
    { key: 'last_name', synonyms: ['lastname', 'nom', 'naam', 'achternaam', 'surname', 'familyname'] },
    { key: 'full_name', synonyms: ['fullname', 'name', 'agent', 'nomcomplet', 'volledigenaam', 'username'] },
    { key: 'department', synonyms: ['department', 'departement', 'dept', 'afdeling', 'service', 'team'] },
  ],
};

/** Suggest a column for every target field (exact normalised match, then partial). */
export function autoMap(headers, target, rows = []) {
  const fields = FIELDS[target] || [];
  const mapping = {};
  const used = new Set();
  const normalized = headers.map((h) => ({ raw: h, n: norm(h) }));

  for (const f of fields) {
    const syn = f.synonyms.map(norm);
    let hit = normalized.find((h) => !used.has(h.raw) && syn.includes(h.n));
    if (!hit) {
      hit = normalized.find((h) => !used.has(h.raw)
        && syn.some((s) => s.length >= 4 && (h.n.includes(s) || s.includes(h.n))));
    }
    mapping[f.key] = hit
      ? { mode: 'column', column: hit.raw }
      : { mode: 'ignore' };
    if (hit) used.add(hit.raw);
  }

  // Column holding "CODE / SERIAL" in a single cell → propose an automatic split.
  const codeCol = mapping.asset_code?.column;
  if (target === 'assets' && codeCol && (!mapping.serial || mapping.serial.mode === 'ignore')) {
    const sample = rows.slice(0, 20)
      .map((r) => String(r[codeCol] ?? ''))
      .find((v) => v.split('/').filter((p) => p.trim() !== '').length === 2);
    if (sample) {
      mapping.asset_code = { mode: 'column', column: codeCol, split: { sep: '/', index: 0 } };
      mapping.serial = { mode: 'column', column: codeCol, split: { sep: '/', index: 1 } };
    }
  }
  return mapping;
}

/** Resolve one mapped field for a row. */
export function resolve(row, spec) {
  if (!spec || spec.mode === 'ignore') return '';
  if (spec.mode === 'const') return String(spec.value ?? '').trim();
  if (!spec.column) return '';
  let v = row[spec.column];
  v = v === undefined || v === null ? '' : String(v).trim();
  if (spec.split && spec.split.sep) {
    const parts = v.split(spec.split.sep).map((p) => p.trim()).filter((p) => p !== '');
    v = parts[Number(spec.split.index) || 0] ?? '';
  }
  return v;
}
