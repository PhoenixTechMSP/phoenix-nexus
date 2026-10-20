/**
 * Convertit une erreur SQLite (better-sqlite3) en message destine a
 * l'utilisateur, sans exposer le schema interne (noms de tables/colonnes).
 *
 * Contexte : l'app renvoyait e.message tel quel dans ~14 reponses d'erreur,
 * par exemple "UNIQUE constraint failed: ci_relationships.source_ci_id, ..."
 * (trouve par un test navigateur sur la page CMDB, puis audite sur tout le
 * serveur). Rester informatif (on nomme le champ en doublon) sans reveler la
 * table ni la structure.
 */
export function friendlyDbError(e) {
  const code = e && e.code;
  const msg = (e && e.message) || '';

  if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
    // "UNIQUE constraint failed: agents.matricule" ou "...: t.a, t.b, t.c"
    const m = msg.match(/UNIQUE constraint failed:\s*(.+)$/);
    if (m) {
      const fields = m[1].split(',').map(s => s.trim().split('.').pop()).filter(Boolean);
      return `A record with the same ${fields.join(' / ')} already exists`;
    }
    return 'A record with the same value already exists';
  }
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return 'A referenced record does not exist';
  if (code === 'SQLITE_CONSTRAINT_NOTNULL') return 'A required field is missing';
  if (code === 'SQLITE_CONSTRAINT_CHECK') return 'A field has an invalid value';

  console.error('[db] unexpected error:', e);
  return 'The request could not be completed';
}
