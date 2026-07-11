import type { IInstallModsOptions, Mod } from 'bridge/BridgeAPI';
import type { ResourceLimits } from '../main/worker/ResourceBudget';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { copySourceTreeBounded } from '../main/worker/DataSourceResourceGuard';
import { InstallationRuntime } from '../main/worker/InstallationRuntime';
import { getModAPI } from '../main/worker/ModAPI';

jest.mock('main/worker/CascLib', () => ({
  readCString: jest.fn(),
}));

describe('data source in-memory copy bounds', () => {
  let tempRoot: string;
  let sourceRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-data-bound-'));
    sourceRoot = path.join(tempRoot, 'source');
    mkdirSync(path.join(sourceRoot, 'nested'), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'first.bin'), Buffer.alloc(8, 1));
    writeFileSync(path.join(sourceRoot, 'nested', 'second.bin'), Buffer.alloc(16, 2));
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function limits(overrides: Partial<ResourceLimits> = {}): ResourceLimits {
    return {
      maxBytes: 1024,
      maxDepth: 16,
      maxEntries: 100,
      ...overrides,
    };
  }

  it('copies a normal small tree with exact byte accounting', () => {
    const copied = new Map<string, Buffer>();

    const result = copySourceTreeBounded({
      destinationPath: 'global',
      fileExists: () => false,
      limits: limits(),
      overwrite: false,
      setFileData: (filePath, data) => copied.set(filePath, data),
      sourcePath: sourceRoot,
    });

    expect(result.usage).toEqual({ bytes: 24, entries: 4, maxDepth: 3 });
    expect(result.paths.sort()).toEqual([
      path.join('global', 'first.bin'),
      path.join('global', 'nested', 'second.bin'),
    ]);
    expect(copied.get(path.join('global', 'first.bin'))).toEqual(
      Buffer.alloc(8, 1),
    );
  });

  it.each([
    ['bytes', { maxBytes: 23 }, /byte limit/i],
    ['count', { maxEntries: 3 }, /entry count/i],
    ['depth', { maxDepth: 2 }, /depth limit/i],
  ] as const)(
    'rejects the tree at the %s preflight before setting any data',
    (_kind, limitOverrides, message) => {
      const setFileData = jest.fn();

      expect(() =>
        copySourceTreeBounded({
          destinationPath: 'global',
          fileExists: () => false,
          limits: limits(limitOverrides),
          overwrite: false,
          setFileData,
          sourcePath: sourceRoot,
        }),
      ).toThrow(message);
      expect(setFileData).not.toHaveBeenCalled();
    },
  );
});

describe('current data-mod retention evidence', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-data-retention-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  it('reproduces copied data remaining in FileManager until final flush', async () => {
    const mod: Mod = {
      config: {},
      id: 'Retention',
      info: { name: 'Retention', type: 'data', version: '1.0.0' },
    };
    const appRoot = path.join(tempRoot, 'app');
    const dataRoot = path.join(appRoot, 'mods', mod.id, 'data');
    mkdirSync(path.join(dataRoot, 'nested'), { recursive: true });
    writeFileSync(path.join(dataRoot, 'first.bin'), Buffer.alloc(8, 1));
    writeFileSync(
      path.join(dataRoot, 'nested', 'second.bin'),
      Buffer.alloc(16, 2),
    );

    const options: IInstallModsOptions = {
      dataPath: path.join(tempRoot, 'game', 'data'),
      gamePath: path.join(tempRoot, 'game'),
      isDirectMode: false,
      isDryRun: true,
      isPreExtractedData: true,
      mergedPath: path.join(tempRoot, 'output', 'Fake.mpq', 'data'),
      normalizeOutputCRLF: false,
      outputModName: 'Fake',
      preExtractedDataPath: path.join(tempRoot, 'source'),
      savesPath: path.join(tempRoot, 'saves'),
    };
    const runtime = new InstallationRuntime(
      {
        getAppPath: async () => appRoot,
      } as never,
      console,
      options,
      [mod],
    );
    runtime.mod = mod;

    await getModAPI(runtime).copyDataModFiles();

    const retained = runtime.fileManager.getModifiedFiles();
    expect(retained).toHaveLength(2);
    expect(
      retained.reduce((total, file) => total + file.data.length, 0),
    ).toBe(24);
  });
});
