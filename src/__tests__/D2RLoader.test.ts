import {
  D2R_LOADER_CONFIG_FILES,
  normalizeD2RLoaderSettings,
  parseD2RLoaderTomlSettings,
  updateD2RLoaderConfig,
  updateD2RLoaderIni,
  updateD2RLoaderToml,
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
    expect(output).toContain(
      '[Advanced.Logging]\r\ndetect_early_crashes = true',
    );
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

describe('D2RLoader TOML writer', () => {
  it('prefers TOML before INI when both config files exist', () => {
    expect(D2R_LOADER_CONFIG_FILES.map(({ fileName }) => fileName)).toEqual([
      'D2RLoader.toml',
      'D2RLoader.ini',
    ]);
  });

  it('parses existing TOML keys while excluding dynamic font registrations', () => {
    const input = [
      '# header',
      '',
      '[d2rcore.items]',
      '# Show socket counts on normal/superior ground items.',
      'show_ground_sockets = false',
      '',
      '[d2rcore.fonts]',
      'MyFont = "MyFont.ttf"',
      '',
      '[d2rloader]',
      '# Automatically pass -mod and -txt with this value.',
      'default_mod = ""',
      '',
      '[d2rloader.developer.logs]',
      'json_resources = false',
      '',
    ].join('\n');

    const settings = parseD2RLoaderTomlSettings(input);

    expect(settings.map(({ id }) => id)).toEqual([
      'd2rcore.items.show_ground_sockets',
      'd2rloader.default_mod',
      'd2rloader.developer.logs.json_resources',
    ]);
    expect(settings[0]).toMatchObject({
      value: false,
      valueType: 'boolean',
      description: 'Show socket counts on normal/superior ground items.',
    });
  });

  it('updates existing TOML keys while preserving comments and table order', () => {
    const input = [
      '# header',
      '',
      '[d2rcore.items]',
      '# Show socket counts on normal/superior ground items.',
      'show_ground_sockets = false',
      '',
      '[d2rcore.stash]',
      'set_shared_tabs = 5',
      '',
      '[d2rloader]',
      '# current mod',
      'default_mod = "OldMod"',
      'global_plugins = true',
      '',
      '[d2rloader.developer.logs]',
      'json_resources = false',
      '',
    ].join('\n');

    const output = updateD2RLoaderToml(input, {
      ...SETTINGS,
      tomlSettings: {
        'd2rcore.items.show_ground_sockets': true,
        'd2rcore.stash.set_shared_tabs': 6,
        'd2rloader.global_plugins': false,
        'd2rloader.developer.logs.json_resources': true,
      },
    });

    expect(output).toContain('# header\n\n[d2rcore.items]');
    expect(output).toContain(
      '# Show socket counts on normal/superior ground items.\nshow_ground_sockets = true',
    );
    expect(output).toContain('# current mod\ndefault_mod = "D2RMMRE"');
    expect(output).toContain('set_shared_tabs = 6');
    expect(output).toContain('global_plugins = false');
    expect(output).toContain('json_resources = true');
    expect(output.indexOf('[d2rcore.items]')).toBeLessThan(
      output.indexOf('[d2rcore.stash]'),
    );
    expect(output.indexOf('[d2rcore.stash]')).toBeLessThan(
      output.indexOf('[d2rloader]'),
    );
  });

  it('does not insert missing TOML keys or tables', () => {
    const output = updateD2RLoaderConfig(
      '[d2rloader]\ndefault_mod = "Old"\n',
      {
        ...SETTINGS,
        tomlSettings: {
          'd2rloader.skip_title_screen': true,
        },
      },
      'toml',
    );

    expect(output).toContain('default_mod = "D2RMMRE"');
    expect(output).not.toContain('skip_title_screen');
    expect(output).not.toContain('[d2rloader.developer]');
  });

  it('clamps known TOML numeric limits', () => {
    const output = updateD2RLoaderToml(
      '[d2rcore.stash]\nset_shared_tabs = 5\nset_materials_limit = 99\n',
      {
        ...SETTINGS,
        tomlSettings: {
          'd2rcore.stash.set_shared_tabs': 1,
          'd2rcore.stash.set_materials_limit': 999,
        },
      },
    );

    expect(output).toContain('set_shared_tabs = 5');
    expect(output).toContain('set_materials_limit = 255');
  });
});
