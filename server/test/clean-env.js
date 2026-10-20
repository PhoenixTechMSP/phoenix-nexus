// Rend les tests HERMETIQUES : a importer en PREMIER dans chaque fichier de test.
// Un test qui depend de l'environnement du shell est un test qui echoue "chez l'autre" sans explication : une session
// avec NODE_ENV=production, DEMO_MODE=1 ou TRUST_PROXY=1 deja exporte (ou une commande precedente qui en laisse) changeait
// le comportement des serveurs lances par les tests (imports bloques, /api/demo actif, adresse IP lue dans un en-tete...).
// Chaque test fixe ensuite explicitement ce dont il a besoin.
export const AMBIENT_VARS = [
  'NODE_ENV', 'PORT', 'DB_PATH', 'JWT_SECRET', 'TRUST_PROXY', 'LOGIN_MAX_ATTEMPTS',
  'DEMO_MODE', 'DEMO_PASSWORD', 'DEMO_RESET_ON_START', 'ADMIN_EMAIL', 'ADMIN_PASSWORD',
  'SSO_ENABLED', 'SSO_TENANT_ID', 'SSO_CLIENT_ID', 'SSO_CLIENT_SECRET', 'SSO_REDIRECT_URI', 'SSO_ALLOWED_DOMAINS', 'SSO_DEFAULT_ROLE',
];
for (const k of AMBIENT_VARS) delete process.env[k];
