import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Probleme eventuel avec un JWT_SECRET destine a la production (null = acceptable).
 *
 * Contexte : la valeur d'exemple de .env.example est publique. Un serveur lance avec elle
 * (ou avec le defaut du docker-compose) permet a n'importe qui de forger un jeton admin.
 * Seul le defaut interne 'dev_only_change_me' etait refuse jusque-la.
 */
export function secretProblem(secret) {
  if (!secret) return 'JWT_SECRET must be set in production. Generate one with: openssl rand -hex 32';
  if (secret.length < 32) return 'JWT_SECRET is too short (32 characters minimum). Generate one with: openssl rand -hex 32';
  if (/replace|change.?me|example|placeholder|dev_only|password|12345|secret/i.test(secret)) {
    return 'JWT_SECRET looks like a placeholder value (it is public). Generate one with: openssl rand -hex 32';
  }
  if (new Set(secret).size < 10) return 'JWT_SECRET has too little entropy. Generate one with: openssl rand -hex 32';
  return null;
}

/**
 * Limiteur de tentatives de connexion echouees, en memoire, sans dependance.
 * - par paire (adresse IP + email) : empeche de deviner le mot de passe d'un compte ;
 * - par adresse IP : empeche de balayer de nombreux comptes depuis une meme machine.
 * Seuls les echecs comptent : se connecter correctement n'est jamais freine, et un succes efface
 * le compteur de la paire (un utilisateur legitime qui s'est trompe deux fois n'est pas penalise).
 * Limite connue : un attaquant reparti sur beaucoup d'adresses IP n'est pas freine par ce mecanisme.
 */
export function createLoginLimiter({ windowMs = 15 * 60 * 1000, maxPerKey = 8, maxPerIp = 40, now = Date.now, maxEntries = 20000 } = {}) {
  const keys = new Map();
  const ips = new Map();
  const live = rec => rec && now() - rec.first < windowMs;
  const bump = (map, k) => {
    const rec = map.get(k);
    if (live(rec)) rec.count++; else map.set(k, { count: 1, first: now() });
  };
  const waitFor = (rec, max) => (live(rec) && rec.count >= max ? Math.ceil((rec.first + windowMs - now()) / 1000) : 0);
  const prune = map => {
    if (map.size <= maxEntries) return;
    for (const [k, rec] of map) if (!live(rec)) map.delete(k);
    if (map.size > maxEntries) map.clear();   // saturation volontaire : la memoire reste bornee
  };
  return {
    /** Secondes a attendre avant le prochain essai (0 = autorise). */
    blockedFor(ip, key) { return Math.max(waitFor(keys.get(key), maxPerKey), waitFor(ips.get(ip), maxPerIp)); },
    fail(ip, key) { bump(keys, key); bump(ips, ip); prune(keys); prune(ips); },
    reset(key) { keys.delete(key); },
    size() { return keys.size + ips.size; },
  };
}

export const loginLimiter = createLoginLimiter({
  maxPerKey: Number(process.env.LOGIN_MAX_ATTEMPTS) || 8,
});

/** En-tetes de securite simples (pas de CSP : le scanner camera et les styles en ligne la rendraient fragile). */
export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',   // la page Scan utilise la camera
  });
  next();
}

/**
 * Vrai si ce module est le point d'entree (node server/index.js).
 * Ne JAMAIS comparer import.meta.url a `file://${argv[1]}` : sous Windows argv[1] vaut "C:\\...",
 * l'egalite echoue et le serveur ne se met jamais a ecouter. pathToFileURL gere les deux plateformes.
 */
export function isMainModule(importMetaUrl, argv1 = process.argv[1], deps = {}) {
  if (!argv1) return false;
  const realpath = deps.realpath || fs.realpathSync;   // injectables : permettent de tester la semantique Windows depuis Linux
  const toUrl = deps.toUrl || pathToFileURL;
  try { return toUrl(realpath(argv1)).href === importMetaUrl; }
  catch { return false; }
}
