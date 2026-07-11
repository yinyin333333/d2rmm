import type { IBridgeAPI, Mod } from 'bridge/BridgeAPI';
import type { ConsoleAPI } from 'bridge/ConsoleAPI';

jest.mock('main/worker/CascLib', () => ({
  readCString: (buffer: Buffer) => buffer.toString('utf8'),
}));

import { InstallationRuntime } from '../main/worker/InstallationRuntime';
import { getModAPI } from '../main/worker/ModAPI';
import { runModTransaction } from '../main/worker/ModTransaction';

const options = {
  dataPath: 'fake-data',
  gamePath: 'fake-game',
  isDirectMode: false,
  isDryRun: false,
  isPreExtractedData: true,
  mergedPath: 'fake-output',
  normalizeOutputCRLF: false,
  outputModName: 'FakeOutput',
  preExtractedDataPath: 'fake-source',
  savesPath: 'fake-saves',
};

function createMod(id: string): Mod {
  return {
    config: {},
    id,
    info: { name: id, type: 'd2rmm', version: '1.0.0' },
  } as Mod;
}

function createRuntime(): {
  bridge: IBridgeAPI;
  runtime: InstallationRuntime;
} {
  const bridge = {
    isGameFile: jest.fn().mockResolvedValue(false),
    readBinaryFile: jest.fn().mockResolvedValue([1, 2, 3]),
    readFile: jest.fn().mockResolvedValue(Buffer.from('100')),
    writeBinaryFile: jest.fn().mockResolvedValue(true),
  } as unknown as IBridgeAPI;
  const consoleAPI = {
    debug: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
  } as unknown as ConsoleAPI;
  const mods = [createMod('A'), createMod('B')];
  return {
    bridge,
    runtime: new InstallationRuntime(bridge, consoleAPI, options, mods),
  };
}

describe('per-mod transaction integration', () => {
  it('stages save writes and exposes them to later reads without touching disk', async () => {
    const { bridge, runtime } = createRuntime();
    runtime.mod = createMod('A');
    const api = getModAPI(runtime);

    await runModTransaction(runtime, async () => {
      await api.writeSaveFile('Hero.d2s', [9, 8, 7]);
      await expect(api.readSaveFile('Hero.d2s')).resolves.toEqual([9, 8, 7]);
    });

    expect(bridge.writeBinaryFile).not.toHaveBeenCalled();
    expect(bridge.readBinaryFile).not.toHaveBeenCalled();
    expect(runtime.saveFiles.getPendingWrites()).toEqual([
      { data: [9, 8, 7], filePath: 'Hero.d2s' },
    ]);
    expect(runtime.modsInstalled).toEqual(['A']);
  });

  it('rolls back file, save, next-string ID, and success ID after failure', async () => {
    const { runtime } = createRuntime();
    runtime.fileManager.setData('global/excel/x.txt', Buffer.from('before'));
    runtime.mod = createMod('A');
    const apiA = getModAPI(runtime);

    await expect(
      runModTransaction(runtime, async () => {
        runtime.fileManager.setData(
          'global/excel/x.txt',
          Buffer.from('failed A'),
        );
        await runtime.fileManager.write('global/excel/x.txt', 'A');
        await apiA.writeSaveFile('Hero.d2s', [9]);
        await expect(apiA.getNextStringID()).resolves.toBe(100);
        throw new Error('synthetic mod failure');
      }),
    ).rejects.toThrow('synthetic mod failure');

    expect(runtime.fileManager.getData('global/excel/x.txt')?.toString()).toBe(
      'before',
    );
    expect(runtime.fileManager.modified('global/excel/x.txt')).toBe(false);
    expect(runtime.saveFiles.getPendingWrites()).toEqual([]);
    expect(runtime.modsInstalled).toEqual([]);

    runtime.mod = createMod('B');
    const apiB = getModAPI(runtime);
    await runModTransaction(runtime, async () => {
      await expect(apiB.getNextStringID()).resolves.toBe(100);
    });
    expect(runtime.modsInstalled).toEqual(['B']);
  });
});
