import {
  normalizeD2RLoaderSettings,
  updateD2RLoaderIni,
} from '../main/worker/D2RLoader';

const SETTINGS = {
  defaultMod: 'D2RMMRE',
  skipTitleScreen: true,
  showGroundSockets: true,
  extraSharedTabs: 3,
  forceTcpip: true,
  globalPlugins: false,
  devConsole: true,
  detectEarlyCrashes: true,
  damageIndicator: 2,
  jsonResourceLoads: true,
};

describe('D2RLoader INI writer', () => {
  it('updates known keys while preserving comments and section order', () => {
    const input = [
      '; header',
      '',
      '[Game]',
      '; current mod',
      'default_mod = "OldMod"',
      '',
      '[Items]',
      'show_ground_sockets = false',
      '',
      '[Advanced.Logging]',
      'damage_indicator = 0',
      '',
    ].join('\r\n');

    const output = updateD2RLoaderIni(input, SETTINGS);

    expect(output).toContain('; header\r\n\r\n[Game]');
    expect(output).toContain('; current mod\r\ndefault_mod = "D2RMMRE"');
    expect(output.indexOf('[Game]')).toBeLessThan(output.indexOf('[Items]'));
    expect(output.indexOf('[Items]')).toBeLessThan(
      output.indexOf('[Advanced.Logging]'),
    );
  });

  it('writes booleans as lowercase and integers unquoted', () => {
    const output = updateD2RLoaderIni('[Game]\r\n', SETTINGS);

    expect(output).toContain('skip_title_screen = true');
    expect(output).toContain('extra_shared_tabs = 3');
    expect(output).toContain('damage_indicator = 2');
  });

  it('inserts missing keys into existing sections', () => {
    const output = updateD2RLoaderIni('[Game]\r\ndefault_mod = "Old"\r\n', {
      ...SETTINGS,
      skipTitleScreen: false,
    });

    expect(output).toContain(
      '[Game]\r\ndefault_mod = "D2RMMRE"\r\nskip_title_screen = false',
    );
  });

  it('adds missing sections', () => {
    const output = updateD2RLoaderIni(
      '[Game]\r\ndefault_mod = "Old"\r\n',
      SETTINGS,
    );

    expect(output).toContain('[Advanced]\r\nglobal_plugins = false');
    expect(output).toContain('[Advanced.Logging]\r\ndetect_early_crashes = true');
  });

  it('clamps numeric settings', () => {
    const normalized = normalizeD2RLoaderSettings({
      ...SETTINGS,
      extraSharedTabs: -5,
      damageIndicator: 9,
    });

    expect(normalized.extraSharedTabs).toBe(0);
    expect(normalized.damageIndicator).toBe(0);
  });
});
