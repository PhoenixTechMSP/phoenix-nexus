import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import './db.js';
import { authRouter } from './routes/auth.js';
import { assetsRouter } from './routes/assets.js';
import { catalogRouter } from './routes/catalog.js';
import { agentsRouter } from './routes/agents.js';
import { eventsRouter } from './routes/events.js';
import { importRouter } from './routes/import.js';
import { usersRouter } from './routes/users.js';
import { ssoRouter } from './routes/sso.js';
import { cmdbRouter } from './routes/cmdb.js';
import { samRouter } from './routes/sam.js';
import { demoRouter } from './routes/demo.js';
import { blockInDemo } from './lib/demo.js';
import { securityHeaders, isMainModule } from './lib/security.js';
import { backfillActiveAssets } from './lib/cmdb-sync.js';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
// Derriere un reverse proxy (Caddy, Nginx) : sans ceci, req.ip serait toujours celui du proxy et le limiteur de
// connexion verrouillerait TOUS les utilisateurs a la fois. A n'activer que si le port de l'app n'est pas expose
// directement (sinon l'en-tete X-Forwarded-For serait falsifiable). Valeur = nombre de proxys de confiance.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.use(securityHeaders);
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.get('/api/departments', (req, res) => res.json(db.prepare('SELECT * FROM departments ORDER BY code').all()));

// ROUTES PUBLIQUES : a declarer AVANT app.use('/api', catalogRouter) ci-dessous, dont requireAuth intercepte
// tout /api/* non encore traite (une route publique declaree apres repondrait 401).
app.use('/api/demo', demoRouter);
app.use('/api/auth', authRouter);
app.use('/api/sso', ssoRouter);
app.use('/api/assets', assetsRouter);
// Legacy alias: the PTX endpoints now operate on the generic asset table
app.use('/api/ptx', assetsRouter);
app.use('/api', catalogRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/import', blockInDemo('File import'), importRouter);
app.use('/api/users', usersRouter);
app.use('/api/cmdb', cmdbRouter);
app.use('/api/sam', samRouter);

// Serve frontend build
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));

// Rattrapage CMDB au demarrage (idempotent) : cree le CI des assets deja en
// service avant l'arrivee du module CMDB - voir lib/cmdb-sync.js.
const backfilled = backfillActiveAssets();
if (backfilled) console.log(`[cmdb] ${backfilled} asset(s) en service rattrape(s) en CMDB`);

export { app };

// Ne démarre le serveur que si ce fichier est exécuté directement (node server/index.js),
// pas quand il est importé (par les tests notamment) - pattern standard Express/Node
// pour rendre l'app testable sans effet de bord au moment de l'import.
if (isMainModule(import.meta.url)) {
  const PORT = process.env.PORT || 8080;
  const server = app.listen(PORT, () => console.log(`[server] Phoenix-Nexus on :${PORT}`));

  // Arret propre. Dans un conteneur, node est le processus 1 : sans gestionnaire il ignore SIGTERM et Docker/Podman
  // le tue de force apres 10 s (deploiements et retours arriere ralentis, base coupee en pleine ecriture).
  // On cesse d'accepter des connexions, on laisse finir les requetes en cours, on ferme SQLite (checkpoint WAL).
  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[server] ${signal} recu : arret en cours`);
    const force = setTimeout(() => { console.error('[server] arret force apres 8 s'); process.exit(1); }, 8000);
    force.unref();
    server.close(() => {
      try { db.pragma('wal_checkpoint(TRUNCATE)'); db.close(); } catch (e) { console.error('[server] fermeture de la base :', e.message); }
      console.log('[server] arret propre');
      process.exit(0);
    });
    server.closeIdleConnections?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
