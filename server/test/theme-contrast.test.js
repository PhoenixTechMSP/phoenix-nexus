import './clean-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = fs.readFileSync(path.join(ROOT, 'client', 'src', 'styles.css'), 'utf8');

const block = sel => { const i = css.indexOf(sel + ' {'); assert.ok(i >= 0, `${sel} introuvable`); return css.slice(i, css.indexOf('}', i)); };
const tokens = txt => Object.fromEntries([...txt.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(m => [m[1], m[2]]));
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

const light = tokens(block(':root'));
const dark = { ...light, ...tokens(block('[data-theme="dark"]')) };

for (const [name, t] of [['clair', light], ['sombre', dark]]) {
  test(`contraste (theme ${name}) : les textes d'alerte sont lisibles (WCAG AA, 4.5:1)`, () => {
    for (const [fg, bg] of [['warn-text', 'warn-bg'], ['error-text', 'error-bg'], ['danger-text', 'surface'], ['success-text', 'surface'], ['text-muted', 'surface'], ['text', 'surface']]) {
      assert.ok(t[fg] && t[bg], `jeton manquant : ${fg} ou ${bg}`);
      const r = ratio(t[fg], t[bg]);
      assert.ok(r >= 4.5, `theme ${name} : ${fg} sur ${bg} = ${r.toFixed(2)}:1 (minimum 4.5:1)`);
    }
  });
}

test('aucune couleur claire codee en dur dans les pages : elles passent par les jetons du theme', () => {
  const bad = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const f = path.join(d, e.name);
    if (e.isDirectory()) return walk(f);
    if (!/\.jsx$/.test(e.name)) return;
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/background:\s*'#[0-9a-fA-F]{3,6}'/.test(l)) bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
      if (/color:\s*'#(475569|b91c1c|166534)'/.test(l)) bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
    });
  });
  walk(path.join(ROOT, 'client', 'src'));
  assert.deepEqual(bad, [], 'utiliser var(--...) ou une classe : un fond clair fixe rend le texte illisible en mode sombre');
});
