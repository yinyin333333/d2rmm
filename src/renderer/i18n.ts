import i18next from 'i18next';
import enUS from 'locales/en-US.json';
import { initReactI18next } from 'react-i18next';

export async function initI18n(): Promise<void> {
  await i18next.use(initReactI18next).init({
    lng: 'en-US',
    resources: {
      'en-US': { translation: enUS },
    },
    interpolation: {
      // React already escapes values, no need for i18next to do it
      escapeValue: false,
    },
  });
}
