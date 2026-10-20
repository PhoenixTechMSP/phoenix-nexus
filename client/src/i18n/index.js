import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './en.json';
import fr from './fr.json';
import nl from './nl.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, fr: { translation: fr }, nl: { translation: nl } },
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr', 'nl'],
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    // Default language is EN (fallbackLng); the browser locale is ignored on
    // purpose. Only an explicit user choice, stored in localStorage, changes it.

    detection: {
      order: ['localStorage'],
      lookupLocalStorage: 'ptx_lang',
      caches: ['localStorage'],
    },

  });

export default i18n;
