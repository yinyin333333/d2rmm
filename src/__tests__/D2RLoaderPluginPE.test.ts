import { inspectD2RLoaderPluginPE } from '../main/worker/D2RLoaderPluginPE';
import { createTestD2RLoaderPluginPE } from '../testFixtures/D2RLoaderPluginPEFixture';

describe('D2RLoader plugin PE inspection', () => {
  it('reads exports, PluginInfo, resources, and config references without loading the DLL', () => {
    const result = inspectD2RLoaderPluginPE(
      createTestD2RLoaderPluginPE({
        configReference: 'ForceLarzukSockets.json',
        embeddedConfig: 'socket_count = 6\n',
      }),
    );

    expect(result).not.toBeNull();
    expect(result?.hasRequiredExports).toBe(true);
    expect(result?.pluginInfo).toEqual({
      apiVersion: 3,
      author: 'D2RMM',
      description: 'Synthetic plugin fixture',
      flags: 5,
      id: 'test-plugin',
      infoSize: 72,
      name: 'Test Plugin',
      version: '1.2.3',
    });
    expect(result?.manifestApiVersion).toBe(3);
    expect(result?.embeddedConfig).toBe('socket_count = 6\n');
    expect(result?.referencedConfigFileNames).toEqual(
      new Set(['forcelarzuksockets.json']),
    );
  });

  it('rejects truncated files and raw export-name substrings as PE metadata', () => {
    expect(inspectD2RLoaderPluginPE(Buffer.from('MZ'))).toBeNull();
    expect(
      inspectD2RLoaderPluginPE(
        Buffer.from('MZ\0D2RLoaderGetPluginInfo\0D2RLoaderLoadPlugin\0'),
      ),
    ).toBeNull();
  });
});
