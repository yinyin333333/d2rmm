import {
  D2R_LOADER_CONFIG_FILE,
  parseD2RLoaderTomlSettings,
  updateD2RLoaderConfig,
  updateD2RLoaderToml,
} from '../main/worker/D2RLoader';

const SETTINGS = {
  defaultMod: 'D2RMMRE',
};

describe('D2RLoader TOML config', () => {
  it('uses the D2RLoader TOML config path', () => {
    expect(D2R_LOADER_CONFIG_FILE).toEqual({
      fileName: 'd2rloader.toml',
      relativePath: ['d2rloader', 'config', 'd2rloader.toml'],
    });
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
      'text_locale = ""',
      '',
      '[d2rloader.developer.logs]',
      'json_resources = false',
      '',
    ].join('\n');

    const settings = parseD2RLoaderTomlSettings(input);

    expect(settings.map(({ id }) => id)).toEqual([
      'd2rcore.items.show_ground_sockets',
      'd2rloader.default_mod',
      'd2rloader.text_locale',
      'd2rloader.developer.logs.json_resources',
    ]);
    expect(settings[0]).toMatchObject({
      value: false,
      valueType: 'boolean',
      description: 'Show socket counts on normal/superior ground items.',
    });
  });

  it('parses primitive and raw TOML values dynamically', () => {
    const settings = parseD2RLoaderTomlSettings(
      [
        '[d2rloader]',
        'skip_title_screen = false',
        'text_locale = "enUS"',
        'startup_delay = 1.5',
        'locales = ["enUS"]',
      ].join('\n'),
    );

    expect(settings.map(({ id, value, valueType }) => ({
      id,
      value,
      valueType,
    }))).toEqual([
      {
        id: 'd2rloader.skip_title_screen',
        value: false,
        valueType: 'boolean',
      },
      { id: 'd2rloader.text_locale', value: 'enUS', valueType: 'string' },
      { id: 'd2rloader.startup_delay', value: 1.5, valueType: 'float' },
      { id: 'd2rloader.locales', value: '["enUS"]', valueType: 'raw' },
    ]);
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
      'add_shared_tabs = 0',
      '',
      '[d2rloader]',
      '# current mod',
      'default_mod = "OldMod"',
      'show_tcpip_button = false # keep this comment',
      '',
      '[d2rloader.advanced]',
      'allow_global_extensions = true',
      '',
      '[d2rloader.developer.logs]',
      'json_resources = false',
      '',
    ].join('\n');

    const output = updateD2RLoaderToml(input, {
      ...SETTINGS,
      tomlSettings: {
        'd2rcore.items.show_ground_sockets': true,
        'd2rcore.stash.add_shared_tabs': 3,
        'd2rloader.show_tcpip_button': true,
        'd2rloader.advanced.allow_global_extensions': false,
        'd2rloader.developer.logs.json_resources': true,
      },
    });

    expect(output).toContain('# header\n\n[d2rcore.items]');
    expect(output).toContain(
      '# Show socket counts on normal/superior ground items.\nshow_ground_sockets = true',
    );
    expect(output).toContain('# current mod\ndefault_mod = "D2RMMRE"');
    expect(output).toContain('add_shared_tabs = 3');
    expect(output).toContain('show_tcpip_button = true # keep this comment');
    expect(output).toContain('allow_global_extensions = false');
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
    );

    expect(output).toContain('default_mod = "D2RMMRE"');
    expect(output).not.toContain('skip_title_screen');
    expect(output).not.toContain('[d2rloader.developer]');
  });

  it('clamps known TOML numeric limits', () => {
    const output = updateD2RLoaderToml(
      '[d2rcore.stash]\nadd_shared_tabs = 0\nset_materials_limit = 99\n',
      {
        ...SETTINGS,
        tomlSettings: {
          'd2rcore.stash.add_shared_tabs': -1,
          'd2rcore.stash.set_materials_limit': 999,
        },
      },
    );

    expect(output).toContain('add_shared_tabs = 0');
    expect(output).toContain('set_materials_limit = 255');
  });
});
