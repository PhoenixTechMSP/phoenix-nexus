/**
 * Mode demonstration (DEMO_MODE=1) : instance publique destinee a etre montree.
 * - les comptes de demo et leur mot de passe sont affiches sur la page de connexion (publics PAR CONCEPTION) ;
 * - les imports de fichiers sont desactives : sur une instance ou n'importe qui peut se connecter, un
 *   fichier XLSX piege exploiterait la faille connue de la bibliotheque xlsx (voir CHANGELOG, Security) ;
 * - les donnees sont reinitialisees a chaque demarrage (scripts/demo-setup.js, redemarrage nocturne).
 * Hors mode demo, rien de tout cela n'est expose : /api/demo renvoie { enabled: false }.
 */
export const DEMO = process.env.DEMO_MODE === '1';

export const DEMO_ACCOUNTS = [
  { email: 'demo-manager@demo.local', role: 'manager', full_name: 'Demo Manager' },
  { email: 'demo-staff@demo.local', role: 'staff', full_name: 'Demo Staff' },
];

export function demoInfo() {
  if (!DEMO) return { enabled: false };
  return {
    enabled: true,
    password: process.env.DEMO_PASSWORD || '',
    accounts: DEMO_ACCOUNTS.map(({ email, role }) => ({ email, role })),
    imports_disabled: true,
  };
}

/** Bloque les routes d'import en mode demo (403 explicite, avant toute lecture du fichier). */
export function blockInDemo(feature) {
  return (req, res, next) => {
    if (!DEMO) return next();
    res.status(403).json({ error: `${feature} is disabled on the demo instance` });
  };
}
