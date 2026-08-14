import type { ILocaleAPI } from 'bridge/LocaleAPI';
import { writeFileSync } from 'fs';
import i18next from 'i18next';
import { normalizeLocale, type SupportedLocale } from '../shared/locales';
import { consumeAPI, provideAPI } from './IPC';
import { getCurrentLocale, getLocaleConfigPath } from './i18n';

function getLocale(): SupportedLocale {
  return getCurrentLocale();
}

async function setLocale(locale: SupportedLocale): Promise<void> {
  const normalizedLocale = normalizeLocale(locale);
  await i18next.changeLanguage(normalizedLocale);
  writeFileSync(
    getLocaleConfigPath(),
    JSON.stringify({ locale: normalizedLocale }, null, 2),
    'utf8',
  );
}

export async function initLocaleAPI(): Promise<void> {
  provideAPI('LocaleAPI', { getLocale, setLocale } as ILocaleAPI, true);
}

export const LocaleAPI = consumeAPI<ILocaleAPI, Pick<ILocaleAPI, 'getLocale'>>(
  'LocaleAPI',
  { getLocale },
  true,
);
