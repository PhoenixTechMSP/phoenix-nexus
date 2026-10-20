const BASE = '/api';

function token() { return localStorage.getItem('ptx_token'); }

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(BASE + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  // 401 = session expiree, SAUF sur la connexion elle-meme : un mauvais mot de passe renvoie aussi 401, et recharger
  // la page de connexion effacait le message d'erreur (le visiteur voyait le formulaire se vider sans explication).
  if (res.status === 401 && path !== '/auth/login') { localStorage.removeItem('ptx_token'); location.href = '/login'; return; }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function upload(path, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(BASE + path, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

export function downloadBlob(path, filename) {
  return fetch(BASE + path, { headers: { Authorization: `Bearer ${token()}` } })
    .then(r => {
      // Avant : une reponse d'erreur (500, session expiree) etait telechargee comme un fichier .xlsx contenant du JSON.
      if (!r.ok) throw new Error(`Download failed (HTTP ${r.status})`);
      return r.blob();
    })
    .then(b => {
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    })
    .catch(e => { alert(e.message); });
}

export function currentUser() {
  try { return JSON.parse(localStorage.getItem('ptx_user') || 'null'); } catch { return null; }
}

/** Upload a file plus extra form fields (guided import with column mapping). */
export async function uploadForm(path, file, fields = {}) {
  const fd = new FormData();
  fd.append('file', file);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}` },
    body: fd,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || 'Upload failed');
  return data;
}
