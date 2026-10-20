import './clean-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'client', 'src');
const load = l => JSON.parse(fs.readFileSync(path.join(SRC, 'i18n', `${l}.json`), 'utf8'));
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, p + k + '.') : [[p + k, v]]));
const dicts = Object.fromEntries(['en', 'fr', 'nl'].map(l => [l, new Map(flat(load(l)))]));

// Une cle manquante s'affiche TELLE QUELLE a l'ecran ("scan.confirmOut") : un defaut visible par tous les
// visiteurs de la demo, dans la langue ou elle manque. Aucun test fonctionnel ne le voit.
test('traductions : chaque cle existe dans les trois langues (en, fr, nl)', () => {
  const all = new Set([...dicts.en.keys(), ...dicts.fr.keys(), ...dicts.nl.keys()]);
  const missing = [];
  for (const k of all) for (const l of ['en', 'fr', 'nl']) if (!dicts[l].has(k)) missing.push(`${l}:${k}`);
  assert.deepEqual(missing, [], `${missing.length} traduction(s) manquante(s) : ${missing.slice(0, 12).join(', ')}`);
});

test('traductions : aucune valeur vide', () => {
  const empty = [];
  for (const l of ['en', 'fr', 'nl']) for (const [k, v] of dicts[l]) if (typeof v === 'string' && v.trim() === '') empty.push(`${l}:${k}`);
  assert.deepEqual(empty, []);
});

test('traductions : les variables {{x}} sont identiques dans toutes les langues', () => {
  const vars = s => [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]).sort().join(',');
  const bad = [];
  for (const [k, v] of dicts.en) for (const l of ['fr', 'nl']) if (dicts[l].has(k) && vars(v) !== vars(dicts[l].get(k))) bad.push(`${l}:${k}`);
  assert.deepEqual(bad, [], 'une variable absente affiche "{{n}}" ou un trou dans la phrase');
});

function* sources(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(p); else if (/\.(jsx?|mjs)$/.test(e.name)) yield p;
  }
}
test('traductions : toute cle passee a t(\'...\') dans le code existe (pas de faute de frappe)', () => {
  const used = new Map();
  for (const f of sources(SRC)) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'\s*[,)]/g)) used.set(m[1], path.relative(ROOT, f));
  }
  assert.ok(used.size > 100, `trop peu de cles detectees (${used.size}) : l'expression de recherche est cassee`);
  const unknown = [...used].filter(([k]) => !dicts.en.has(k)).map(([k, f]) => `${k} (${f})`);
  assert.deepEqual(unknown, [], `cle(s) inconnue(s) : ${unknown.join(', ')}`);
});
