import { db } from '../db.js';

/**
 * Écrit un événement dans la table outbox `integration_events`, dans la même
 * transaction que l'appelant (SQLite + better-sqlite3 : pas de transaction
 * distribuée nécessaire tant que tout reste dans la même base).
 *
 * Phase 1 : on émet, personne ne consomme encore. Le futur worker CMDB
 * (Phase 2) lira les lignes `processed_at IS NULL`, créera/archivera le CI
 * correspondant, puis marquera la ligne traitée.
 *
 * NOTE OUVERTE (à trancher en Phase 2, pas ici) : le statut applicatif actuel
 * ne distingue pas "Attribué" (nominatif) de "Déployé" (infra/OT) - les deux
 * se traduisent aujourd'hui par status='in_use'. equipment_class (catégorie)
 * est donc inclus dans le payload pour que le futur consommateur CMDB sache
 * comment interpréter l'événement, sans qu'on ait eu besoin d'ajouter un
 * nouveau statut applicatif ni de toucher au cycle de vie existant maintenant.
 */
export function emitIntegrationEvent(entityType, entityId, eventType, payload) {
  db.prepare(
    `INSERT INTO integration_events (event_type, entity_type, entity_id, payload) VALUES (?,?,?,?)`
  ).run(eventType, entityType, entityId, JSON.stringify(payload));
}
