import i18next, { type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import vi from './vi.json';
import { groupAreaFiles, mergeLocale, type LocaleTree } from './merge-locales';
import type { Language } from '../lib/ui-prefs';

// Feature areas: `locales/<area>.<lang>.json`, merged under `<area>` (see merge-locales.ts).
const areaFiles = groupAreaFiles(
  import.meta.glob<LocaleTree>('./locales/*.json', { eager: true, import: 'default' }),
);

export const resources = {
  vi: { translation: mergeLocale(vi, areaFiles.vi) },
  en: { translation: mergeLocale(en, areaFiles.en) },
} as const;

/**
 * Initializes the shared i18next instance synchronously (resources are bundled).
 * Vietnamese is the default and the fallback; English is complete.
 */
export function initI18n(language: Language): I18n {
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: 'vi',
      supportedLngs: ['vi', 'en'],
      interpolation: { escapeValue: false },
      returnNull: false,
      initAsync: false,
    });
  } else if (i18next.language !== language) {
    void i18next.changeLanguage(language);
  }
  return i18next;
}

export { i18next as i18n };
