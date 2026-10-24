import { useTranslation } from 'react-i18next';

// Ecran de chargement : la mascotte pulse doucement (desactive si l'utilisateur reduit les animations).
// Les deux variantes d'image suivent le theme comme sur la page de connexion (voir styles.css).
export default function BrandLoader({ inline = false }) {
  const { t } = useTranslation();
  return (
    <div className={`brand-loader${inline ? ' inline' : ''}`} role="status" aria-live="polite" data-testid="brand-loader">
      <img className="logo-on-light" src="/brand/phoenix-logo.png" alt="" width="72" height="72" />
      <img className="logo-on-dark" src="/brand/phoenix-logo-on-dark.png" alt="" width="72" height="72" />
      <span>{t('common.loading')}</span>
    </div>
  );
}
