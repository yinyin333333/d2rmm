import i18next from 'i18next';
import { I18N_RESOURCES } from 'shared/i18nResources';
import {
  DEFAULT_LOCALE,
  LOCALE_DISPLAY_NAMES,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from 'shared/locales';
import { initReactI18next } from 'react-i18next';

export { LOCALE_DISPLAY_NAMES };

export async function initI18n(): Promise<void> {
  await i18next.use(initReactI18next).init({
    fallbackLng: DEFAULT_LOCALE,
    lng: normalizeLocale(window.env.locale ?? navigator.language),
    resources: I18N_RESOURCES,
    supportedLngs: SUPPORTED_LOCALES,
    interpolation: {
      // React already escapes values, no need for i18next to do it
      escapeValue: false,
    },
  });
}
