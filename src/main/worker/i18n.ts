import i18next from 'i18next';
import enUS from '../../locales/en-US.json';

export async function initI18n(): Promise<void> {
  await i18next.init({
    lng: 'en-US',
    resources: {
      'en-US': { translation: enUS },
    },
    interpolation: { escapeValue: false },
  });
}
