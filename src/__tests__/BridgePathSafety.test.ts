import type { IInstallModsOptions } from 'bridge/BridgeAPI';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { BridgeAPI } from '../main/worker/BridgeAPI';

let mockAppPath = '';

jest.mock('../main/worker/AppInfoAPI', () => ({
  getAppPath: () => mockAppPath,
  getBaseSavesPath: () => mockAppPath,
}));
jest.mock('../main/worker/IPC', () => ({
  consumeAPI: (name: string, localAPI: object = {}) =>
    name === 'EventAPI'
      ? { ...localAPI, send: () => Promise.resolve() }
      : localAPI,
  provideAPI: jest.fn(),
}));
jest.mock('../main/worker/CascLib', () => ({
  CASC_ERROR_FILE_OFFLINE: 0,
  CASC_FEATURE_ALLOW_DOWNLOAD: 0,
  getCascLib: jest.fn(),
  getLastCascLibError: jest.fn(),
  makeCascOpenStorageArgs: jest.fn(),
  readCString: jest.fn(),
}));
jest.mock('../main/worker/third-party/d2s/index', () => ({}));
jest.mock('source-map', () => {
  const actual = jest.requireActual<typeof import('source-map')>('source-map');
  return {
    ...actual,
    SourceMapConsumer: jest.fn().mockImplementation(() => ({
      destroy: () => undefined,
      eachMapping: () => undefined,
      originalPositionFor: () => ({
        column: null,
        line: null,
        name: null,
        source: null,
      }),
    })),
  };
});

function getInstallOptions(
  overrides: Partial<IInstallModsOptions> = {},
): IInstallModsOptions {
  const gamePath = path.join(mockAppPath, 'game');
  return {
    dataPath: path.join(gamePath, 'data'),
    gamePath,
    isDirectMode: false,
    isDryRun: false,
    isPreExtractedData: true,
    mergedPath: path.join(gamePath, 'mods', 'D2RMM', 'D2RMM.mpq', 'data'),
    normalizeOutputCRLF: false,
    outputModName: 'D2RMM',
    preExtractedDataPath: path.join(gamePath, 'extracted-data'),
    savesPath: path.join(mockAppPath, 'saves'),
    ...overrides,
  };
}

describe('BridgeAPI path safety', () => {
  beforeEach(() => {
    mockAppPath = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-path-test-'));
  });

  afterEach(() => {
    rmSync(mockAppPath, { force: true, recursive: true });
  });

  it('rejects mod IDs that escape the mods directory', async () => {
    await expect(BridgeAPI.readModConfig('..')).rejects.toThrow(
      'outside of allowed directory',
    );
  });

  it('rejects TypeScript imports that escape the current mod directory', async () => {
    const modPath = path.join(mockAppPath, 'mods', 'example');
    mkdirSync(modPath, { recursive: true });
    writeFileSync(path.join(modPath, 'mod.ts'), "import '../../outside';\n");
    writeFileSync(path.join(mockAppPath, 'outside.ts'), 'export {};\n');

    await expect(BridgeAPI.readModCode('example')).rejects.toThrow(
      'outside of allowed directory',
    );
  });

  it('allows TypeScript imports within the current mod directory', async () => {
    const modPath = path.join(mockAppPath, 'mods', 'example');
    mkdirSync(modPath, { recursive: true });
    writeFileSync(path.join(modPath, 'mod.ts'), "import './helper';\n");
    writeFileSync(path.join(modPath, 'helper.ts'), 'export {};\n');

    await expect(BridgeAPI.readModCode('example')).resolves.toEqual([
      expect.stringContaining("require.register('./helper'"),
      expect.any(String),
    ]);
  });

  it('rejects a pre-extracted input inside the output tree', async () => {
    const mergedPath = path.join(
      mockAppPath,
      'game',
      'mods',
      'D2RMM',
      'D2RMM.mpq',
      'data',
    );

    await expect(
      BridgeAPI.installMods(
        [],
        getInstallOptions({
          mergedPath,
          preExtractedDataPath: path.join(mergedPath, 'source'),
        }),
      ),
    ).rejects.toThrow('overlaps the output directory');
  });

  it('rejects direct mode when input and output are the same directory', async () => {
    const dataPath = path.join(mockAppPath, 'game', 'data');

    await expect(
      BridgeAPI.installMods(
        [],
        getInstallOptions({
          dataPath,
          isDirectMode: true,
          preExtractedDataPath: `${dataPath}${path.sep}`,
        }),
      ),
    ).rejects.toThrow('overlaps the output directory');
  });

  it('allows a pre-extracted input outside the output tree', async () => {
    await expect(
      BridgeAPI.installMods([], getInstallOptions()),
    ).resolves.toEqual([]);
  });

  it('keeps a sibling saves directory absolute', async () => {
    const options = getInstallOptions({ savesPath: `${mockAppPath}-sibling` });

    await BridgeAPI.installMods([], options);

    const modInfo = JSON.parse(
      readFileSync(
        path.resolve(options.mergedPath, '..', 'modinfo.json'),
        'utf8',
      ),
    ) as { savepath: string };
    expect(modInfo.savepath).toBe(path.resolve(options.savesPath));
  });
});
