import type { SupportedLocale } from 'shared/locales';

export type ILocaleAPI = {
  setLocale(locale: SupportedLocale): Promise<void>;
  getLocale(): SupportedLocale;
};
