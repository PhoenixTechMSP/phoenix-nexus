import jwt from 'jsonwebtoken';

import { secretProblem } from '../lib/security.js';

const SECRET = process.env.JWT_SECRET || 'dev_only_change_me';
if (process.env.NODE_ENV === 'production') {
  // Refuse aussi les valeurs d'exemple publiques (.env.example, defaut du docker-compose), pas seulement le defaut interne.
  const problem = secretProblem(process.env.JWT_SECRET);
  if (problem) {
    console.error(`FATAL: ${problem}`);
    process.exit(1);
  }
}

export function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '12h' });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
