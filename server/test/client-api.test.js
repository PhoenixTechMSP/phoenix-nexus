import './clean-env.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Le client api.js n'utilise que fetch, localStorage et location : on le teste sans navigateur avec des doublures.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let store, loc, alerts, clicks, nextResponse;
const response = (status, body, type = 'application/json') => ({
  status, ok: status >= 200 && status < 300, headers: { get: () => type },
  json: async () => body, text: async () => String(body), blob: async () => ({ size: 1 }),
});
beforeEach(() => {
  store = { ptx_token: 'jeton-valide' }; loc = { href: '/scan' }; alerts = []; clicks = 0;
  globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  globalThis.location = loc;
  globalThis.alert = m => alerts.push(m);
  globalThis.fetch = async () => nextResponse;
  globalThis.document = { createElement: () => ({ click: () => { clicks++; } }) };
  globalThis.URL.createObjectURL = () => 'blob:x'; globalThis.URL.revokeObjectURL = () => {};
});
const { api, downloadBlob } = await import(pathToFileURL(path.join(ROOT, 'client', 'src', 'lib', 'api.js')).href);

test('MAUVAIS MOT DE PASSE : l\'erreur du serveur est levee, la page n\'est PAS rechargee (message visible)', async () => {
  nextResponse = response(401, { error: 'Invalid email or password' });
  await assert.rejects(() => api('/auth/login', { method: 'POST', body: { email: 'a', password: 'b' } }), /Invalid email or password/);
  assert.equal(loc.href, '/scan', 'pas de redirection : sinon le message d\'erreur disparait avec le rechargement');
});
test('session expiree (401 sur une autre route) : jeton efface et retour a la connexion', async () => {
  nextResponse = response(401, { error: 'Unauthorized' });
  assert.equal(await api('/assets'), undefined);
  assert.equal(store.ptx_token, undefined);
  assert.equal(loc.href, '/login');
});
test('429 (trop d\'essais) : le message du serveur est affiche, pas de redirection', async () => {
  nextResponse = response(429, { error: 'Too many failed attempts, try again later' });
  await assert.rejects(() => api('/auth/login', { method: 'POST', body: {} }), /Too many failed attempts/);
  assert.equal(loc.href, '/scan');
});
test('requete reussie : renvoie les donnees', async () => {
  nextResponse = response(200, [{ id: 1 }]);
  assert.deepEqual(await api('/assets'), [{ id: 1 }]);
});
test('TELECHARGEMENT en erreur (500) : message affiche, AUCUN fichier telecharge', async () => {
  nextResponse = response(500, { error: 'x' });
  await downloadBlob('/events/export.xlsx', 'a.xlsx');
  assert.equal(clicks, 0, 'avant : le JSON d\'erreur etait enregistre comme un fichier .xlsx');
  assert.match(alerts[0], /Download failed \(HTTP 500\)/);
});
test('TELECHARGEMENT en erreur de session (401) : meme comportement', async () => {
  nextResponse = response(401, {});
  await downloadBlob('/events/export.xlsx', 'a.xlsx');
  assert.equal(clicks, 0); assert.match(alerts[0], /HTTP 401/);
});
test('telechargement reussi : le fichier est propose', async () => {
  nextResponse = response(200, 'PK');
  await downloadBlob('/events/export.xlsx', 'a.xlsx');
  assert.equal(clicks, 1); assert.deepEqual(alerts, []);
});
