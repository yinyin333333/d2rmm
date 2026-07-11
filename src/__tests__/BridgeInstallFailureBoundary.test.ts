import type { IInstallModsOptions, Mod } from 'bridge/BridgeAPI';

const mockEventSend = jest.fn().mockResolvedValue(undefined);
const mockApplyD2RLoaderPrerequisites = jest.fn().mockResolvedValue(undefined);

jest.mock('main/worker/AppInfoAPI', () => ({
  getAppPath: () => 'C:\\D2RMM-F05-FAKE\\app',
  getBaseSavesPath: () => 'C:\\D2RMM-F05-FAKE\\base-saves',
}));

jest.mock('main/worker/EventAPI', () => ({
  EventAPI: {
    send: (...args: unknown[]) => mockEventSend(...args),
  },
}));

jest.mock('main/worker/D2RLoaderPrerequisites', () => ({
  applyD2RLoaderPrerequisites: (...args: unknown[]) =>
    mockApplyD2RLoaderPrerequisites(...args),
  clearD2RLoaderOutputDirectory: jest.fn().mockResolvedValue(null),
}));

jest.mock('main/worker/CascLib', () => ({
  CASC_ERROR_FILE_OFFLINE: 4350,
  CASC_FEATURE_ALLOW_DOWNLOAD: 0x00002000,
  getCascLib: jest.fn(),
  getLastCascLibError: jest.fn(),
  makeCascOpenStorageArgs: jest.fn(),
  readCString: jest.fn(),
}));

jest.mock('main/worker/third-party/d2s/index', () => ({
  read: jest.fn(),
  setConstantData: jest.fn(),
  stash: { read: jest.fn(), write: jest.fn() },
  write: jest.fn(),
}));

import { BridgeAPI, getRuntime } from '../main/worker/BridgeAPI';

const options: IInstallModsOptions = {
  dataPath: 'C:\\D2RMM-F05-FAKE\\game\\data',
  gamePath: 'C:\\D2RMM-F05-FAKE\\game',
  isDirectMode: false,
  isDryRun: false,
  isPreExtractedData: true,
  mergedPath:
    'C:\\D2RMM-F05-FAKE\\output\\Fake.mpq\\data',
  normalizeOutputCRLF: false,
  outputModName: 'Fake',
  preExtractedDataPath: 'C:\\D2RMM-F05-FAKE\\source',
  savesPath: 'C:\\D2RMM-F05-FAKE\\saves',
};

function failedMod(): Mod {
  return {
    config: {},
    id: 'Failed',
    info: { name: 'Failed', type: 'd2rmm', version: '1.0.0' },
  };
}

describe('BridgeAPI install commit boundary', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    mockEventSend.mockClear();
    mockApplyD2RLoaderPrerequisites.mockReset();
    mockApplyD2RLoaderPrerequisites.mockResolvedValue(undefined);
  });

  afterEach(() => {
    expect(getRuntime()).toBeNull();
  });

  it('treats zero selected mods as a no-op without replacing output', async () => {
    const deleteFile = jest.spyOn(BridgeAPI, 'deleteFile');
    const writeFile = jest.spyOn(BridgeAPI, 'writeFile');
    const writeTxt = jest.spyOn(BridgeAPI, 'writeTxt');
    const writeBinaryFile = jest.spyOn(BridgeAPI, 'writeBinaryFile');

    await expect(BridgeAPI.installMods([], options)).resolves.toEqual([]);

    expect(deleteFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(writeTxt).not.toHaveBeenCalled();
    expect(writeBinaryFile).not.toHaveBeenCalled();
  });

  it('preserves output and saves when every selected mod fails to compile', async () => {
    jest
      .spyOn(BridgeAPI, 'readModCode')
      .mockRejectedValue(new Error('synthetic compile failure'));
    const deleteFile = jest.spyOn(BridgeAPI, 'deleteFile');
    const writeFile = jest.spyOn(BridgeAPI, 'writeFile');
    const writeTxt = jest.spyOn(BridgeAPI, 'writeTxt');
    const writeBinaryFile = jest.spyOn(BridgeAPI, 'writeBinaryFile');

    await expect(
      BridgeAPI.installMods([failedMod()], options),
    ).resolves.toEqual([]);

    expect(deleteFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(writeTxt).not.toHaveBeenCalled();
    expect(writeBinaryFile).not.toHaveBeenCalled();
  });

  it('applies selected D2RLoader prerequisites before parsing mod code', async () => {
    const prerequisiteError = new Error('synthetic prerequisite failure');
    mockApplyD2RLoaderPrerequisites.mockRejectedValueOnce(prerequisiteError);
    const readModCode = jest.spyOn(BridgeAPI, 'readModCode');

    await expect(
      BridgeAPI.installMods([failedMod()], {
        ...options,
        useD2RLoader: true,
      }),
    ).rejects.toBe(prerequisiteError);

    expect(mockApplyD2RLoaderPrerequisites).toHaveBeenCalledTimes(1);
    expect(readModCode).not.toHaveBeenCalled();
  });
});
