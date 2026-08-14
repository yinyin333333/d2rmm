import i18next from 'i18next';
import { I18N_RESOURCES } from '../shared/i18nResources';
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from '../shared/locales';

describe('locale normalization', () => {
  it.each(SUPPORTED_LOCALES)('preserves supported locale %s', (locale) => {
    expect(normalizeLocale(locale)).toBe(locale);
  });

  it.each([
    ['ko', 'ko-KR'],
    ['pt_PT', 'pt-BR'],
    ['zh-Hant', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-SG', 'zh-CN'],
    ['en-GB', 'en-US'],
  ])('maps system locale %s to %s', (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });

  it.each([null, undefined, '', 'unsupported'])(
    'falls back to English for %s',
    (locale) => {
      expect(normalizeLocale(locale)).toBe(DEFAULT_LOCALE);
    },
  );

  it('loads restored translations for newly added UI', async () => {
    const instance = i18next.createInstance();
    await instance.init({
      fallbackLng: DEFAULT_LOCALE,
      lng: 'ko-KR',
      resources: I18N_RESOURCES,
      supportedLngs: SUPPORTED_LOCALES,
    });

    expect(instance.t('tabs.settings')).toBe('설정');
    expect(instance.t('tabs.plugins')).toBe('플러그인');
    expect(instance.t('settings.status.disabled')).toBe('사용 안 함');
  });

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE))(
    'contains every current UI key with intact placeholders in %s',
    (locale) => {
      const resources = I18N_RESOURCES as Record<
        string,
        { translation: Record<string, string> }
      >;
      const english = resources[DEFAULT_LOCALE].translation;
      const translation = resources[locale].translation;
      const uiKeys = Object.keys(english).filter((key) =>
        /^(d2rLoader|install|modlist|plugins|run|settings|tabs)\./.test(key),
      );
      const placeholders = (value: string): string[] =>
        Array.from(value.matchAll(/{{\s*([^}]+?)\s*}}/g), (match) =>
          match[1].trim(),
        ).sort();

      for (const key of uiKeys) {
        expect(Object.prototype.hasOwnProperty.call(translation, key)).toBe(
          true,
        );
        expect(placeholders(translation[key])).toEqual(
          placeholders(english[key]),
        );
      }
    },
  );
});
