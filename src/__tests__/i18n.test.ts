import { te, tl } from '../shared/i18n';

describe('i18n errors', () => {
  it('creates a single-entry localization chain without an inner error', () => {
    const error = te('settings.d2rLoader.missingExe');

    expect(error.__d2rmm_i18n_list).toEqual([
      tl('settings.d2rLoader.missingExe'),
    ]);
    expect(error.__d2rmm_i18n_list).not.toContain('undefined');
  });
});
