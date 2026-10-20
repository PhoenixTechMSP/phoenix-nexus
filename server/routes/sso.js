// Microsoft Entra ID (Azure AD) OIDC SSO
// Enabled when SSO_ENABLED=true and the SSO_* env vars are set.
// MFA (Yubikey / Authenticator app) is enforced by Microsoft's Conditional Access -
// no code required here; users completing MFA at Microsoft are trusted.
import { Router } from 'express';
import { Issuer, generators } from 'openid-client';
import { db } from '../db.js';
import { sign } from '../middleware/auth.js';

export const ssoRouter = Router();

const enabled = String(process.env.SSO_ENABLED || '').toLowerCase() === 'true';
const tenant = process.env.SSO_TENANT_ID;
const clientId = process.env.SSO_CLIENT_ID;
const clientSecret = process.env.SSO_CLIENT_SECRET;
const redirectUri = process.env.SSO_REDIRECT_URI; // e.g. https://ptx.intranet.local/api/sso/callback
const defaultRole = process.env.SSO_DEFAULT_ROLE || 'pending'; // pending → admin approves
const allowedDomains = (process.env.SSO_ALLOWED_DOMAINS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

let client = null;
async function getClient() {
  if (client) return client;
  if (!enabled || !tenant || !clientId || !clientSecret || !redirectUri) return null;
  const issuer = await Issuer.discover(`https://login.microsoftonline.com/${tenant}/v2.0`);
  client = new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [redirectUri],
    response_types: ['code'],
  });
  return client;
}

// Short-lived in-memory state store (single-container OK).
const states = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of states) if (v.expires < now) states.delete(k);
}, 60_000).unref?.();

ssoRouter.get('/status', (req, res) => res.json({ enabled }));

ssoRouter.get('/login', async (req, res) => {
  try {
    const c = await getClient();
    if (!c) return res.status(503).send('SSO not configured');
    const state = generators.state();
    const nonce = generators.nonce();
    const code_verifier = generators.codeVerifier();
    const code_challenge = generators.codeChallenge(code_verifier);
    states.set(state, { nonce, code_verifier, expires: Date.now() + 10 * 60_000 });
    const url = c.authorizationUrl({
      scope: 'openid profile email',
      state, nonce, code_challenge, code_challenge_method: 'S256',
    });
    res.redirect(url);
  } catch (e) {
    console.error('[sso] login error', e);
    res.status(500).send('SSO error: ' + e.message);
  }
});

ssoRouter.get('/callback', async (req, res) => {
  try {
    const c = await getClient();
    if (!c) return res.status(503).send('SSO not configured');
    const params = c.callbackParams(req);
    const s = states.get(params.state);
    if (!s) return res.status(400).send('Invalid or expired SSO state');
    states.delete(params.state);

    const tokenSet = await c.callback(redirectUri, params, {
      state: params.state, nonce: s.nonce, code_verifier: s.code_verifier,
    });
    const claims = tokenSet.claims();
    const email = (claims.email || claims.preferred_username || '').toLowerCase();
    const fullName = claims.name || email;
    const oid = claims.oid || claims.sub;
    if (!email || !oid) return res.status(400).send('SSO: missing email/oid claim');

    if (allowedDomains.length) {
      const domain = email.split('@')[1];
      if (!allowedDomains.includes(domain)) {
        return res.status(403).send(`SSO domain not allowed: ${domain}`);
      }
    }

    // Upsert user by oid, then by email
    let user = db.prepare('SELECT * FROM users WHERE oid = ?').get(oid)
            || db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      const info = db.prepare(
        `INSERT INTO users (email, full_name, role, oid, status) VALUES (?, ?, ?, ?, ?)`
      ).run(email, fullName, defaultRole, oid, defaultRole === 'pending' ? 'pending' : 'active');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    } else {
      db.prepare(`UPDATE users SET oid = COALESCE(oid, ?), full_name = ?, last_login_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(oid, fullName, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    if (user.status !== 'active' || user.role === 'pending') {
      // Pass token-less info to a landing page
      return res.redirect('/login?sso=pending');
    }

    const token = sign({ id: user.id, role: user.role, dept: user.department_id, name: user.full_name });
    const payload = encodeURIComponent(JSON.stringify({
      token,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, department_id: user.department_id, language: user.language }
    }));
    res.redirect(`/login?sso=ok&data=${payload}`);
  } catch (e) {
    console.error('[sso] callback error', e);
    res.status(500).send('SSO callback failed: ' + e.message);
  }
});
