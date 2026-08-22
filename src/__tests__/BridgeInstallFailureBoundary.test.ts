import type { IInstallModsOptions, Mod } from 'bridge/BridgeAPI';
import { BridgeAPI, getRuntime } from '../main/worker/BridgeAPI';
import { SaveFileTransaction } from '../main/worker/SaveFileTransaction';

const mockEventSend = jest.fn().mockResolvedValue(undefined);
const mockApplyD2RLoaderPrerequisites = jest.fn().mockResolvedValue(undefined);
const mockApplyManagedD2RLoaderPackages = jest.fn().mockResolvedValue([]);
const mockClearD2RLoaderOutputDirectory = jest.fn().mockResolvedValue(null);

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
  clearD2RLoaderOutputDirectory: (...args: unknown[]) =>
    mockClearD2RLoaderOutputDirectory(...args),
}));

jest.mock('main/worker/D2RLoaderPluginAPI', () => ({
  applyManagedD2RLoaderPackages: (...args: unknown[]) =>
    mockApplyManagedD2RLoaderPackages(...args),
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

const options: IInstallModsOptions = {
  gamePath: 'C:\\D2RMM-F05-FAKE\\game',
  isDryRun: false,
  isPreExtractedData: true,
  mergedPath: 'C:\\D2RMM-F05-FAKE\\output\\Fake.mpq\\data',
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
    mockApplyManagedD2RLoaderPackages.mockReset();
    mockApplyManagedD2RLoaderPackages.mockResolvedValue([]);
    mockClearD2RLoaderOutputDirectory.mockReset();
    mockClearD2RLoaderOutputDirectory.mockResolvedValue(null);
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

  it('does not apply the temporarily disabled D2RLoader prerequisites', async () => {
    const prerequisiteError = new Error('synthetic prerequisite failure');
    mockApplyD2RLoaderPrerequisites.mockRejectedValueOnce(prerequisiteError);
    const readModCode = jest.spyOn(BridgeAPI, 'readModCode');

    await expect(
      BridgeAPI.installMods([failedMod()], {
        ...options,
        useD2RLoader: true,
      }),
    ).resolves.toEqual([]);

    // Restore these expectations when prerequisite pre-application is enabled.
    // expect(mockApplyD2RLoaderPrerequisites).toHaveBeenCalledTimes(1);
    // expect(readModCode).not.toHaveBeenCalled();
    expect(mockApplyD2RLoaderPrerequisites).not.toHaveBeenCalled();
    expect(readModCode).toHaveBeenCalled();
  });

  it('rebuilds generated D2RLoader output for an explicit loader-output sync', async () => {
    const deleteFile = jest.spyOn(BridgeAPI, 'deleteFile').mockResolvedValue(1);
    jest.spyOn(BridgeAPI, 'readFile').mockResolvedValue(null);
    jest.spyOn(BridgeAPI, 'createDirectory').mockResolvedValue(true);
    const writeTxt = jest.spyOn(BridgeAPI, 'writeTxt').mockResolvedValue(1);
    const saveFlush = jest.spyOn(SaveFileTransaction.prototype, 'flush');

    await expect(
      BridgeAPI.installMods([], {
        ...options,
        syncD2RLoaderOutput: true,
        useD2RLoader: true,
      }),
    ).resolves.toEqual([]);

    // Restore this expectation when prerequisite pre-application is enabled.
    // expect(mockApplyD2RLoaderPrerequisites).toHaveBeenCalledTimes(1);
    expect(mockApplyD2RLoaderPrerequisites).not.toHaveBeenCalled();
    expect(mockApplyManagedD2RLoaderPackages).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(
      'C:\\D2RMM-F05-FAKE\\output\\Fake.mpq',
      'None',
    );
    expect(mockClearD2RLoaderOutputDirectory).toHaveBeenCalledTimes(1);
    expect(writeTxt).toHaveBeenCalledWith(
      'C:\\D2RMM-F05-FAKE\\output\\Fake.mpq\\modinfo.json',
      'None',
      expect.any(String),
    );
    expect(saveFlush).not.toHaveBeenCalled();
  });

  it('reports zero-mod output sync as finalizing and reaches 100% only after the flush', async () => {
    let finishDelete!: (value: number) => void;
    const deletePending = new Promise<number>((resolve) => {
      finishDelete = resolve;
    });
    const deleteFile = jest
      .spyOn(BridgeAPI, 'deleteFile')
      .mockImplementationOnce(() => deletePending);
    jest.spyOn(BridgeAPI, 'readFile').mockResolvedValue(null);
    jest.spyOn(BridgeAPI, 'createDirectory').mockResolvedValue(true);
    jest.spyOn(BridgeAPI, 'writeTxt').mockResolvedValue(1);

    const installPromise = BridgeAPI.installMods([], {
      ...options,
      syncD2RLoaderOutput: true,
      useD2RLoader: true,
    });

    // The status send is awaited before the destructive output flush begins.
    for (
      let attempts = 0;
      attempts < 20 && !deleteFile.mock.calls.length;
      attempts += 1
    ) {
      await Promise.resolve();
    }
    expect(mockEventSend).toHaveBeenCalledWith('installationStatus', {
      phase: 'finalizing',
      installedModsCount: 0,
      totalModsCount: 0,
    });
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(mockEventSend).not.toHaveBeenCalledWith(
      'installationProgress',
      0,
      0,
    );

    finishDelete(1);
    await expect(installPromise).resolves.toEqual([]);

    expect(mockEventSend).toHaveBeenCalledWith('installationProgress', 0, 0);
    const finalizingOrder = mockEventSend.mock.invocationCallOrder.find(
      (_order, index) =>
        mockEventSend.mock.calls[index][0] === 'installationStatus',
    );
    const completeOrder = mockEventSend.mock.invocationCallOrder.find(
      (_order, index) =>
        mockEventSend.mock.calls[index][0] === 'installationProgress',
    );
    expect(finalizingOrder).toBeLessThan(completeOrder as number);
  });

  it('removes stale loader output when an explicit sync disables D2RLoader', async () => {
    const deleteFile = jest.spyOn(BridgeAPI, 'deleteFile').mockResolvedValue(1);
    jest.spyOn(BridgeAPI, 'readFile').mockResolvedValue(null);
    jest.spyOn(BridgeAPI, 'createDirectory').mockResolvedValue(true);
    jest.spyOn(BridgeAPI, 'writeTxt').mockResolvedValue(1);

    await expect(
      BridgeAPI.installMods([], {
        ...options,
        syncD2RLoaderOutput: true,
        useD2RLoader: false,
      }),
    ).resolves.toEqual([]);

    expect(mockApplyD2RLoaderPrerequisites).not.toHaveBeenCalled();
    expect(mockApplyManagedD2RLoaderPackages).not.toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalledWith(
      'C:\\D2RMM-F05-FAKE\\output\\Fake.mpq',
      'None',
    );
    expect(mockClearD2RLoaderOutputDirectory).toHaveBeenCalledTimes(1);
  });

  it('preserves output when managed package staging fails', async () => {
    const expectedError = new Error('synthetic managed package conflict');
    mockApplyManagedD2RLoaderPackages.mockRejectedValueOnce(expectedError);
    const deleteFile = jest.spyOn(BridgeAPI, 'deleteFile').mockResolvedValue(1);
    const writeTxt = jest.spyOn(BridgeAPI, 'writeTxt').mockResolvedValue(1);
    const writeBinaryFile = jest
      .spyOn(BridgeAPI, 'writeBinaryFile')
      .mockResolvedValue(1);

    await expect(
      BridgeAPI.installMods([], {
        ...options,
        syncD2RLoaderOutput: true,
        useD2RLoader: true,
      }),
    ).rejects.toBe(expectedError);

    expect(deleteFile).not.toHaveBeenCalled();
    expect(mockClearD2RLoaderOutputDirectory).not.toHaveBeenCalled();
    expect(writeTxt).not.toHaveBeenCalled();
    expect(writeBinaryFile).not.toHaveBeenCalled();
  });

  it('ignores legacy Direct Mode fields and performs a normal output sync', async () => {
    const deleteFile = jest.spyOn(BridgeAPI, 'deleteFile').mockResolvedValue(1);
    jest.spyOn(BridgeAPI, 'readFile').mockResolvedValue(null);
    jest.spyOn(BridgeAPI, 'createDirectory').mockResolvedValue(true);
    jest.spyOn(BridgeAPI, 'writeTxt').mockResolvedValue(1);
    const legacyOptions = {
      ...options,
      dataPath: 'C:\\D2RMM-F05-FAKE\\game\\data',
      isDirectMode: true,
      syncD2RLoaderOutput: true,
      useD2RLoader: true,
    } as IInstallModsOptions & {
      dataPath: string;
      isDirectMode: boolean;
    };

    await expect(BridgeAPI.installMods([], legacyOptions)).resolves.toEqual([]);

    // Restore this expectation when prerequisite pre-application is enabled.
    // expect(mockApplyD2RLoaderPrerequisites).toHaveBeenCalledTimes(1);
    expect(mockApplyD2RLoaderPrerequisites).not.toHaveBeenCalled();
    expect(mockApplyManagedD2RLoaderPackages).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(
      'C:\\D2RMM-F05-FAKE\\output\\Fake.mpq',
      'None',
    );
    expect(mockClearD2RLoaderOutputDirectory).toHaveBeenCalledTimes(1);
  });

  it('ignores an explicit loader-output sync during a dry run', async () => {
    const deleteFile = jest.spyOn(BridgeAPI, 'deleteFile').mockResolvedValue(1);

    await expect(
      BridgeAPI.installMods([], {
        ...options,
        isDryRun: true,
        syncD2RLoaderOutput: true,
        useD2RLoader: true,
      }),
    ).resolves.toEqual([]);

    expect(mockApplyD2RLoaderPrerequisites).not.toHaveBeenCalled();
    expect(mockApplyManagedD2RLoaderPackages).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(mockClearD2RLoaderOutputDirectory).not.toHaveBeenCalled();
  });

  it('does not replace output when every selected mod fails during a pending package sync', async () => {
    jest
      .spyOn(BridgeAPI, 'readModCode')
      .mockRejectedValue(new Error('synthetic compile failure'));
    const deleteFile = jest.spyOn(BridgeAPI, 'deleteFile').mockResolvedValue(1);

    await expect(
      BridgeAPI.installMods([failedMod()], {
        ...options,
        syncD2RLoaderOutput: true,
        useD2RLoader: true,
      }),
    ).resolves.toEqual([]);

    expect(mockApplyManagedD2RLoaderPackages).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(mockClearD2RLoaderOutputDirectory).not.toHaveBeenCalled();
  });
});
