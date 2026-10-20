import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';

const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'fr', label: 'FR' },
  { code: 'nl', label: 'NL' },
];

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const change = async (code) => {
    i18n.changeLanguage(code);
    localStorage.setItem('ptx_lang', code);
    if (localStorage.getItem('ptx_token')) {
      try { await api('/users/me', { method: 'PATCH', body: { language: code } }); } catch {}
    }
  };
  return (
    <select
      value={i18n.resolvedLanguage || 'en'}
      onChange={(e) => change(e.target.value)}
      className="lang-switcher"
      aria-label="Language"
    >
      {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
    </select>
  );
}
