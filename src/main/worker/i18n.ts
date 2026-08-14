import i18next from 'i18next';
import { I18N_RESOURCES } from '../../shared/i18nResources';
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from '../../shared/locales';

export async function initI18n(): Promise<void> {
  await i18next.init({
    fallbackLng: DEFAULT_LOCALE,
    lng: normalizeLocale(
      process.env.LOCALE ??
        Intl.DateTimeFormat().resolvedOptions().locale ??
        DEFAULT_LOCALE,
    ),
    resources: I18N_RESOURCES,
    supportedLngs: SUPPORTED_LOCALES,
    interpolation: { escapeValue: false },
  });
}
