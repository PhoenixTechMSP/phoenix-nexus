import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations, snapshotIfUnversioned } from './lib/migrate.js';
import { migrations } from './migrations/index.js';
import { createRequire } from 'module';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'ptx.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Installation anterieure aux migrations numerotees : copie de securite avant toute modification du schema.
snapshotIfUnversioned(db, DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','manager','staff','pending')),
  department_id INTEGER REFERENCES departments(id),
  oid TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','pending')),
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','fr','nl')),
  last_login_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matricule TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(last_name, first_name);

-- CMDB categories: IT, OT or business equipment/consumables
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'IT' CHECK(kind IN ('IT','OT','BUSINESS')),
  consumable INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Generic asset table (PTX, laptops, PLCs, vacuums, cloths, ...)
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_code TEXT UNIQUE NOT NULL,
  serial TEXT,
  label TEXT,
  category_id INTEGER REFERENCES categories(id),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK(status IN ('available','in_use','defective','repair','lost','stolen','retired')),
  department_id INTEGER REFERENCES departments(id),
  current_agent_id INTEGER REFERENCES agents(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  notes TEXT,
  last_operator_id INTEGER REFERENCES users(id),
  last_status_change_at TEXT,
  repair_ticket TEXT,
  repair_vendor TEXT,
  repair_sent_at TEXT,
  repair_returned_at TEXT,
  repair_notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_serial ON assets(serial) WHERE serial IS NOT NULL AND serial <> '';
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_dept ON assets(department_id);
CREATE INDEX IF NOT EXISTS idx_assets_cat ON assets(category_id);

CREATE TABLE IF NOT EXISTS asset_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  agent_id INTEGER REFERENCES agents(id),
  user_id INTEGER REFERENCES users(id),
  event_type TEXT NOT NULL CHECK(event_type IN
    ('check_out','check_in','status_change','import','note','repair_send','repair_return','consume','restock','create','delete')),
  status_after TEXT,
  department_id INTEGER REFERENCES departments(id),
  category_id INTEGER REFERENCES categories(id),
  quantity INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_aevents_asset ON asset_events(asset_id);
CREATE INDEX IF NOT EXISTS idx_aevents_date ON asset_events(created_at);
CREATE INDEX IF NOT EXISTS idx_aevents_dept ON asset_events(department_id);
CREATE INDEX IF NOT EXISTS idx_aevents_cat ON asset_events(category_id);
`);

// Saved column-mapping profiles for file imports (additive, v1.5)
db.exec(`
CREATE TABLE IF NOT EXISTS import_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target TEXT NOT NULL CHECK(target IN ('assets','agents')),
  signature TEXT NOT NULL,
  mapping TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(target, signature)
);

-- Phase 1 Phoenix Nexus - pattern outbox transactionnel (ADR-001 : flux
-- asynchrone ITAM -> CMDB, pas d'appel synchrone direct). Ecrit dans la meme
-- transaction que le changement metier ; un futur worker (Phase 2) lira les
-- lignes processed_at IS NULL pour creer/archiver les CI. Table generique,
-- reutilisable pour d'autres consommateurs futurs (ServiceNow/Ivanti, Phase 6)
-- sans nouvelle migration.
CREATE TABLE IF NOT EXISTS integration_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_integration_events_unprocessed ON integration_events(processed_at) WHERE processed_at IS NULL;

-- Phase 2 Phoenix Nexus (ADR-001) : referentiel CMDB distinct, jamais ecrit
-- directement par l'ITAM - uniquement via le consommateur d'evenements outbox
-- (server/lib/cmdb-sync.js). source_system/source_identifier = meme pattern
-- que pour toute donnee synchronisee depuis une source externe (section 8
-- du cahier d'architecture).
CREATE TABLE IF NOT EXISTS configuration_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ci_type TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Archived')),
  source_system TEXT NOT NULL,
  source_identifier TEXT NOT NULL,
  equipment_class TEXT,
  department_id INTEGER REFERENCES departments(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_system, source_identifier)
);

CREATE TABLE IF NOT EXISTS ci_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_ci_id INTEGER NOT NULL REFERENCES configuration_items(id),
  target_ci_id INTEGER NOT NULL REFERENCES configuration_items(id),
  relationship_type TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_ci_id, target_ci_id, relationship_type)
);

-- Phase 3 Phoenix Nexus : SAM minimal (position de licence = droits - consommation).
-- metric = unite de comptage du contrat : named_user/subscription se comptent par
-- agent, device/core par asset (voir routes/sam.js pour la regle de coherence).
CREATE TABLE IF NOT EXISTS software_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL,
  metric TEXT NOT NULL CHECK(metric IN ('named_user','device','core','subscription')),
  category TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vendor, name)
);

CREATE TABLE IF NOT EXISTS licence_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES software_products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK(quantity >= 0),
  annual_cost REAL NOT NULL DEFAULT 0 CHECK(annual_cost >= 0),
  contract_ref TEXT,
  renewal_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS software_installations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES software_products(id) ON DELETE CASCADE,
  agent_id INTEGER REFERENCES agents(id),
  asset_id INTEGER REFERENCES assets(id),
  units INTEGER NOT NULL DEFAULT 1 CHECK(units >= 1),
  source TEXT NOT NULL DEFAULT 'manual',
  last_used_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  CHECK((agent_id IS NULL) != (asset_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_install_agent ON software_installations(product_id, agent_id) WHERE agent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_install_asset ON software_installations(product_id, asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entitlements_renewal ON licence_entitlements(renewal_date);
`);

// --- Idempotent migrations (upgrades from v1.0 → v1.4) ---
const colsOf = (t) => {
  try { return db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name); } catch { return []; }
};

const uCols = colsOf('users');
if (uCols.length) {
  // SQLite refuse ADD COLUMN ... UNIQUE : colonne simple, puis index unique (bug reel trouve en testant une mise a niveau).
  if (!uCols.includes('oid')) db.exec(`ALTER TABLE users ADD COLUMN oid TEXT`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_users_oid ON users(oid)`);
  if (!uCols.includes('status')) db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  if (!uCols.includes('language')) db.exec(`ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en'`);
  if (!uCols.includes('last_login_at')) db.exec(`ALTER TABLE users ADD COLUMN last_login_at TEXT`);
}

// Phase 1 Phoenix Nexus - ADR-001 : distingue les categories "Nominative"
// (declenche le futur evenement CMDB sur check-out / statut in_use) des
// categories "Infrastructure" (OT/reseau - declenche sur le futur statut
// deploye, pas encore modelise ici : voir note dans lib/events.js).
const catCols = colsOf('categories');
const needsEquipmentClassBackfill = catCols.length && !catCols.includes('equipment_class');
if (needsEquipmentClassBackfill) {
  db.exec(`ALTER TABLE categories ADD COLUMN equipment_class TEXT NOT NULL DEFAULT 'Nominative'
    CHECK(equipment_class IN ('Nominative','Infrastructure'))`);
  // Le backfill lui-meme est fait plus bas, APRES le seed des categories par
  // defaut (PLC, NETWORK, ...) - sinon il s'execute avant leur insertion et
  // ne trouve rien a corriger (bug reel trouve en testant le 24/08/2026).
}

// Departments used across the site
const seedDept = db.prepare('INSERT OR IGNORE INTO departments (code, name) VALUES (?, ?)');
[
  ['GEN', 'General'], ['OPS', 'Operations'], ['WH', 'Warehouse'],
  ['SALES', 'Sales'], ['HR', 'HR'], ['CLEAN', 'Cleaning'],
  ['IT', 'IT'], ['MNT', 'Maintenance'],
].forEach(([c, n]) => seedDept.run(c, n));

// Default CMDB categories
const seedCat = db.prepare('INSERT OR IGNORE INTO categories (code, name, kind, consumable) VALUES (?, ?, ?, ?)');
[
  ['PTX', 'PTX / Handheld terminal', 'IT', 0],
  ['LAPTOP', 'Laptop', 'IT', 0],
  ['DESKTOP', 'Desktop / Workstation', 'IT', 0],
  ['MONITOR', 'Monitor', 'IT', 0],
  ['PRINTER', 'Printer', 'IT', 0],
  ['PHONE', 'Mobile phone', 'IT', 0],
  ['RADIO', 'Radio / Walkie-talkie', 'IT', 0],
  ['NETWORK', 'Network equipment', 'IT', 0],
  ['PLC', 'PLC / Automation', 'OT', 0],
  ['SENSOR', 'Sensor / Scanner (OT)', 'OT', 0],
  ['CCTV', 'CCTV / Access control', 'OT', 0],
  ['CONVEYOR', 'Conveyor / BHS equipment', 'OT', 0],
  ['VACUUM', 'Vacuum cleaner', 'BUSINESS', 0],
  ['TROLLEY', 'Trolley / Cart', 'BUSINESS', 0],
  ['TOOL', 'Tool', 'BUSINESS', 0],
  ['CLOTH', 'Cloths / Wipes', 'BUSINESS', 1],
  ['PPE', 'PPE (gloves, masks, ...)', 'BUSINESS', 1],
  ['SUPPLY', 'Cleaning supplies', 'BUSINESS', 1],
].forEach(a => seedCat.run(...a));

if (needsEquipmentClassBackfill) {
  // Executé ICI, apres le seed des categories par defaut - categories OT
  // (kind='OT') et reseau (cas explicite, IT mais pas nominatif) classees
  // Infrastructure ; le reste reste au defaut Nominative de la colonne.
  db.exec(`UPDATE categories SET equipment_class = 'Infrastructure' WHERE kind = 'OT' OR code = 'NETWORK'`);
}

// One-time data migration from the legacy PTX-only tables
const legacy = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ptx'`).get();
if (legacy) {
  const migrated = db.prepare(`SELECT COUNT(*) n FROM assets`).get().n;
  if (migrated === 0) {
    const ptxCat = db.prepare(`SELECT id FROM categories WHERE code='PTX'`).get().id;
    const lc = colsOf('ptx');
    const has = (c) => lc.includes(c);
    const rows = db.prepare(`SELECT * FROM ptx`).all();
    const ins = db.prepare(`INSERT INTO assets
      (id, asset_code, serial, category_id, status, department_id, current_agent_id, notes,
       last_operator_id, last_status_change_at, repair_ticket, repair_vendor, repair_sent_at,
       repair_returned_at, repair_notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const tx = db.transaction(() => {
      rows.forEach(r => ins.run(
        r.id, r.ptx_code, r.imei || null, ptxCat, r.status, r.department_id || null,
        r.current_agent_id || null, r.notes || null,
        has('last_operator_id') ? r.last_operator_id || null : null,
        has('last_status_change_at') ? r.last_status_change_at || null : null,
        has('bac_ticket') ? r.bac_ticket || null : null,
        has('bac_ticket') && r.bac_ticket ? 'Legacy vendor (unspecified)' : null,
        has('bac_sent_at') ? r.bac_sent_at || null : null,
        has('bac_returned_at') ? r.bac_returned_at || null : null,
        has('bac_notes') ? r.bac_notes || null : null,
        r.created_at, r.updated_at
      ));
      const le = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ptx_events'`).get();
      if (le) {
        const evIns = db.prepare(`INSERT INTO asset_events
          (asset_id, agent_id, user_id, event_type, status_after, department_id, category_id, notes, created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`);
        db.prepare(`SELECT * FROM ptx_events`).all().forEach(e => {
          const type = e.event_type === 'bac_send' ? 'repair_send'
            : e.event_type === 'bac_return' ? 'repair_return' : e.event_type;
          evIns.run(e.ptx_id, e.agent_id, e.user_id, type, e.status_after, e.department_id, ptxCat, e.notes, e.created_at);
        });
      }
    });
    tx();
    if (rows.length) console.log(`[db] migrated ${rows.length} PTX into the generic asset table`);
  }
}

// Migrations numerotees (voir server/lib/migrate.js) : sauvegarde automatique, transaction par migration, refus d'une base trop recente.
const APP_VERSION = createRequire(import.meta.url)('../package.json').version;
runMigrations(db, { dbPath: DB_PATH, migrations, appVersion: APP_VERSION });

console.log(`[db] SQLite ready at ${DB_PATH}`);
