import { app } from 'electron';
import fs from 'fs';
import i18next from 'i18next';
import path from 'path';
import { I18N_RESOURCES } from '../shared/i18nResources';
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '../shared/locales';

export function getLocaleConfigPath(): string {
  return path.join(app.getPath('userData'), 'd2rmm-locale.json');
}

function getSavedLocale(): SupportedLocale | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(getLocaleConfigPath(), 'utf8'),
    ) as { locale?: unknown };
    return typeof parsed.locale === 'string'
      ? normalizeLocale(parsed.locale)
      : null;
  } catch {
    return null;
  }
}

function getSystemLocale(): string {
  try {
    return app.getLocale();
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? DEFAULT_LOCALE;
  }
}

export function getInitialLocale(): SupportedLocale {
  return getSavedLocale() ?? normalizeLocale(getSystemLocale());
}

export function getCurrentLocale(): SupportedLocale {
  return normalizeLocale(i18next.resolvedLanguage ?? i18next.language);
}

export async function initI18n(): Promise<void> {
  await i18next.init({
    fallbackLng: DEFAULT_LOCALE,
    lng: getInitialLocale(),
    resources: I18N_RESOURCES,
    supportedLngs: SUPPORTED_LOCALES,
    interpolation: { escapeValue: false },
  });
}
