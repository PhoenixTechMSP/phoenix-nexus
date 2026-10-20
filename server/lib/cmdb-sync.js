import { db } from '../db.js';

/**
 * Consomme les événements `integration_events` en attente et met à jour la
 * CMDB en conséquence. Jamais l'inverse (ADR-001, point 2 - flux unique
 * ITAM -> CMDB). Idempotent : upsert sur (source_system, source_identifier),
 * rejouer un événement déjà traité ne duplique rien.
 *
 * Simplification V1 assumée : appelé de façon quasi-synchrone juste après la
 * transaction ITAM (voir routes/assets.js), pas par un vrai worker/cron
 * séparé - acceptable à l'échelle actuelle (SQLite, une instance). À revoir
 * si un vrai worker devient nécessaire (volume, ou connecteurs externes
 * Phase 6 qui ont besoin de retry/latence tolérée).
 */
const upsertCi = db.prepare(`
  INSERT INTO configuration_items (ci_type, label, status, source_system, source_identifier, equipment_class, department_id)
  VALUES ('PhysicalAsset', ?, 'Active', 'ITAM', ?, ?, ?)
  ON CONFLICT(source_system, source_identifier) DO UPDATE SET
    status = 'Active', label = excluded.label, equipment_class = excluded.equipment_class,
    department_id = excluded.department_id, updated_at = CURRENT_TIMESTAMP
`);

const archiveCi = db.prepare(`
  UPDATE configuration_items SET status = 'Archived', updated_at = CURRENT_TIMESTAMP
  WHERE source_system = 'ITAM' AND source_identifier = ?
`);

const markProcessed = db.prepare(`UPDATE integration_events SET processed_at = CURRENT_TIMESTAMP WHERE id = ?`);
const getPending = db.prepare(`SELECT * FROM integration_events WHERE processed_at IS NULL ORDER BY id`);

export function processIntegrationEvents() {
  const pending = getPending.all();
  for (const ev of pending) {
    const payload = JSON.parse(ev.payload);
    if (ev.event_type === 'asset.activated') {
      upsertCi.run(payload.asset_code, String(ev.entity_id), payload.equipment_class || 'Nominative', payload.department_id || null);
    } else if (ev.event_type === 'asset.retired') {
      // Si aucun CI n'existe (asset retiré sans être jamais passé actif),
      // l'UPDATE ne touche simplement aucune ligne - pas une erreur.
      archiveCi.run(String(ev.entity_id));
    }
    markProcessed.run(ev.id);
  }
  return pending.length;
}

/**
 * Rattrapage idempotent pour les instances migrees : tout asset deja en
 * service (status='in_use') au moment ou la CMDB apparait n'a pas de CI, car
 * aucun evenement d'activation n'a jamais ete emis pour lui. On emet donc
 * l'evenement manquant via l'outbox (meme chemin ITAM -> CMDB que le flux
 * normal, ADR-001) plutot que d'ecrire dans la CMDB directement.
 *
 * Idempotent : ne cible que les assets sans CI. Les assets retires ou jamais
 * actives sont ignores volontairement (pas de CI fantome).
 * Retourne le nombre d'assets rattrapes.
 */
export function backfillActiveAssets() {
  const missing = db.prepare(`
    SELECT a.id, a.asset_code, a.department_id, c.equipment_class
    FROM assets a
    LEFT JOIN categories c ON c.id = a.category_id
    WHERE a.status = 'in_use'
      AND NOT EXISTS (
        SELECT 1 FROM configuration_items ci
        WHERE ci.source_system = 'ITAM' AND ci.source_identifier = CAST(a.id AS TEXT)
      )
  `).all();
  const emit = db.prepare(
    `INSERT INTO integration_events (event_type, entity_type, entity_id, payload) VALUES ('asset.activated','asset',?,?)`
  );
  db.transaction(() => {
    for (const a of missing) {
      emit.run(a.id, JSON.stringify({
        asset_code: a.asset_code,
        equipment_class: a.equipment_class || 'Nominative',
        department_id: a.department_id || null,
        backfill: true,
      }));
    }
  })();
  if (missing.length) processIntegrationEvents();
  return missing.length;
}
