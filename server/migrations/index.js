// Registre des migrations de schema. Versions strictement contigues a partir de 2 (la version 1 est la ligne de base).
//
// Ajouter une migration :
//   1. creer server/migrations/002_nom.js :  export default { version: 2, name: 'nom', up(db) { db.exec('ALTER TABLE ...'); } };
//   2. l'importer et l'ajouter a la liste ci-dessous, dans l'ordre.
//   3. ajouter un test dans server/test/migrations.test.js. Ne JAMAIS modifier une migration deja publiee : en ajouter une nouvelle.
export const migrations = [];
