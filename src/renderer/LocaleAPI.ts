import type { ILocaleAPI } from 'bridge/LocaleAPI';
import { consumeAPI, provideAPI } from 'renderer/IPC';
import i18next from 'i18next';
import { normalizeLocale, type SupportedLocale } from 'shared/locales';

function getLocale(): SupportedLocale {
  return normalizeLocale(i18next.resolvedLanguage ?? i18next.language);
}

async function setLocale(locale: SupportedLocale): Promise<void> {
  await i18next.changeLanguage(normalizeLocale(locale));
}

export async function initLocaleAPI(): Promise<void> {
  provideAPI('LocaleAPI', { getLocale, setLocale } as ILocaleAPI, true);
}

export const LocaleAPI = consumeAPI<ILocaleAPI, Pick<ILocaleAPI, 'getLocale'>>(
  'LocaleAPI',
  { getLocale },
  true,
);
