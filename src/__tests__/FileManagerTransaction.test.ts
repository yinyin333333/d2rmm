import type { IBridgeAPI } from 'bridge/BridgeAPI';
import type { ConsoleAPI } from 'bridge/ConsoleAPI';
import { InstallationRuntime } from '../main/worker/InstallationRuntime';

function createRuntime(): {
  runtime: InstallationRuntime;
  warn: jest.Mock;
} {
  const warn = jest.fn();
  const bridge = {
    isGameFile: jest.fn().mockResolvedValue(false),
  } as unknown as IBridgeAPI;
  const consoleAPI = {
    debug: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    warn,
  } as unknown as ConsoleAPI;

  return {
    runtime: new InstallationRuntime(
      bridge,
      consoleAPI,
      {
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
      },
      [],
    ),
    warn,
  };
}

describe('FileManager per-mod transaction', () => {
  it('rolls back existing/new file data, status, and operations', async () => {
    const { runtime, warn } = createRuntime();
    const manager = runtime.fileManager;
    manager.setData('global/excel/x.txt', Buffer.from('before'));

    manager.beginTransaction();
    await manager.read('global/excel/x.txt', 'A');
    manager.setData('global/excel/x.txt', Buffer.from('from A'));
    await manager.write('global/excel/x.txt', 'A');
    manager.setData('global/excel/y.txt', Buffer.from('new from A'));
    await manager.write('global/excel/y.txt', 'A');
    manager.rollbackTransaction();

    expect(manager.getData('global/excel/x.txt')?.toString()).toBe('before');
    expect(manager.modified('global/excel/x.txt')).toBe(false);
    expect(manager.exists('global/excel/y.txt')).toBe(false);
    expect(manager.getModifiedFiles()).toEqual([]);

    await manager.write('global/excel/x.txt', 'B');
    expect(warn).not.toHaveBeenCalled();
  });

  it('commits successful changes and prevents nested transactions', async () => {
    const { runtime } = createRuntime();
    const manager = runtime.fileManager;

    manager.beginTransaction();
    expect(() => manager.beginTransaction()).toThrow(/transaction/i);
    manager.setData('global/excel/x.txt', Buffer.from('committed'));
    await manager.write('global/excel/x.txt', 'A');
    manager.commitTransaction();

    expect(manager.getData('global/excel/x.txt')?.toString()).toBe('committed');
    expect(manager.modified('global/excel/x.txt')).toBe(true);
    expect(() => manager.rollbackTransaction()).toThrow(/transaction/i);
  });

  it('restores the cached game-file result on rollback', async () => {
    const { runtime } = createRuntime();
    const manager = runtime.fileManager;
    const isGameFile = runtime.BridgeAPI.isGameFile as jest.Mock;
    isGameFile.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    manager.beginTransaction();
    await expect(manager.gameFile('global/excel/x.txt')).resolves.toBe(true);
    manager.rollbackTransaction();

    await expect(manager.gameFile('global/excel/x.txt')).resolves.toBe(false);
    expect(isGameFile).toHaveBeenCalledTimes(2);
  });

  it('caches a successful game-file lookup for repeated conflict checks', async () => {
    const { runtime } = createRuntime();
    const manager = runtime.fileManager;
    const isGameFile = runtime.BridgeAPI.isGameFile as jest.Mock;
    isGameFile.mockResolvedValue(true);

    await expect(manager.gameFile('global/excel/x.txt')).resolves.toBe(true);
    await expect(manager.gameFile('GLOBAL\\EXCEL\\X.TXT')).resolves.toBe(true);

    expect(isGameFile).toHaveBeenCalledTimes(1);
  });
});
