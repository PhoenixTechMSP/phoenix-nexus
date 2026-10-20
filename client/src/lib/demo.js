// Informations sur le mode demo, mises en cache : le Layout est remonte a chaque changement de page.
let cached;
export function getDemoInfo() {
  if (!cached) {
    cached = fetch('/api/demo').then(r => (r.ok ? r.json() : { enabled: false })).catch(() => ({ enabled: false }));
  }
  return cached;
}
