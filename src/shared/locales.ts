export const DEFAULT_LOCALE = 'en-US';

export const SUPPORTED_LOCALES = [
  'en-US',
  'de-DE',
  'fr-FR',
  'es-ES',
  'es-MX',
  'it-IT',
  'pl-PL',
  'pt-BR',
  'ru-RU',
  'ko-KR',
  'zh-TW',
  'zh-CN',
  'ja-JP',
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  'en-US': 'English (US)',
  'de-DE': 'Deutsch',
  'fr-FR': 'Français',
  'es-ES': 'Español (España)',
  'es-MX': 'Español (México)',
  'it-IT': 'Italiano',
  'pl-PL': 'Polski',
  'pt-BR': 'Português (Brasil)',
  'ru-RU': 'Русский',
  'ko-KR': '한국어',
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
  'ja-JP': '日本語',
};

const DEFAULT_LOCALE_BY_LANGUAGE: Record<string, SupportedLocale> = {
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  ja: 'ja-JP',
  ko: 'ko-KR',
  pl: 'pl-PL',
  pt: 'pt-BR',
  ru: 'ru-RU',
  zh: 'zh-CN',
};

export function normalizeLocale(
  locale: string | null | undefined,
): SupportedLocale {
  if (locale == null || locale.trim() === '') return DEFAULT_LOCALE;

  const normalized = locale.trim().replace(/_/g, '-');
  const exact = SUPPORTED_LOCALES.find(
    (supportedLocale) =>
      supportedLocale.toLowerCase() === normalized.toLowerCase(),
  );
  if (exact != null) return exact;

  const [language = '', regionOrScript = ''] = normalized
    .toLowerCase()
    .split('-');
  if (
    language === 'zh' &&
    ['hk', 'mo', 'tw', 'hant'].includes(regionOrScript)
  ) {
    return 'zh-TW';
  }

  return DEFAULT_LOCALE_BY_LANGUAGE[language] ?? DEFAULT_LOCALE;
}
