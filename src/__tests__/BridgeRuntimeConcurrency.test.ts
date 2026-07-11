import type { IInstallModsOptions } from 'bridge/BridgeAPI';
import type { ID2S } from 'bridge/third-party/d2s/d2/types';

const mockEventSend = jest.fn().mockResolvedValue(undefined);
const mockWriteD2S = jest.fn();

jest.mock('main/worker/AppInfoAPI', () => ({
  getAppPath: () => 'C:\\D2RMM-F04-FAKE\\app',
  getBaseSavesPath: () => 'C:\\D2RMM-F04-FAKE\\base-saves',
}));

jest.mock('main/worker/EventAPI', () => ({
  EventAPI: {
    send: (...args: unknown[]) => mockEventSend(...args),
  },
}));

jest.mock('main/worker/third-party/d2s/index', () => ({
  read: jest.fn(),
  setConstantData: jest.fn(),
  stash: {
    read: jest.fn(),
    write: jest.fn(),
  },
  write: (...args: unknown[]) => mockWriteD2S(...args),
}));

jest.mock('main/worker/CascLib', () => ({
  CASC_ERROR_FILE_OFFLINE: 4350,
  CASC_FEATURE_ALLOW_DOWNLOAD: 0x00002000,
  getCascLib: jest.fn(),
  getLastCascLibError: jest.fn(),
  makeCascOpenStorageArgs: jest.fn(),
  readCString: jest.fn(),
}));

import { BridgeAPI, getRuntime } from '../main/worker/BridgeAPI';

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function makeOptions(id: string): IInstallModsOptions {
  const root = `C:\\D2RMM-F04-FAKE\\${id}`;
  return {
    dataPath: `${root}\\data`,
    gamePath: `${root}\\game`,
    isDirectMode: false,
    isDryRun: true,
    isPreExtractedData: false,
    mergedPath: `${root}\\mods\\output\\output.mpq\\data`,
    normalizeOutputCRLF: false,
    outputModName: `output-${id}`,
    preExtractedDataPath: `${root}\\pre-extracted`,
    savesPath: `${root}\\saves`,
  };
}

describe('BridgeAPI runtime operation concurrency', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    mockEventSend.mockClear();
    mockWriteD2S.mockReset();
  });

  afterEach(() => {
    expect(getRuntime()).toBeNull();
  });

  it('rejects read immediately while install owns the runtime and preserves the install owner', async () => {
    const installOptions = makeOptions('install-first');
    const readOptions = makeOptions('read-second');
    const openBarrier = createDeferred<boolean>();
    const openStorage = jest
      .spyOn(BridgeAPI, 'openStorage')
      .mockReturnValue(openBarrier.promise);
    jest.spyOn(BridgeAPI, 'closeStorage').mockResolvedValue(true);

    const installPromise = BridgeAPI.installMods([], installOptions);
    expect(openStorage).toHaveBeenCalledTimes(1);
    const installRuntime = getRuntime();
    expect(installRuntime?.options).toBe(installOptions);

    const readPromise = BridgeAPI.readD2SData(readOptions);
    await expect(readPromise).rejects.toThrow(
      'Cannot start readD2SData while installMods is still running.',
    );
    expect(openStorage).toHaveBeenCalledTimes(1);
    expect(getRuntime()).toBe(installRuntime);
    expect(getRuntime()?.options).toBe(installOptions);

    openBarrier.resolve(true);
    await expect(installPromise).resolves.toEqual([]);
  });

  it('rejects write immediately while read owns the runtime and preserves the read owner', async () => {
    const readOptions = makeOptions('read-first');
    const writeOptions = makeOptions('write-second');
    const openBarrier = createDeferred<boolean>();
    const openStorage = jest
      .spyOn(BridgeAPI, 'openStorage')
      .mockReturnValue(openBarrier.promise);
    mockWriteD2S.mockRejectedValue(new Error('write unexpectedly entered'));

    const readPromise = BridgeAPI.readD2SData(readOptions);
    expect(openStorage).toHaveBeenCalledTimes(1);
    const readRuntime = getRuntime();
    expect(readRuntime?.options).toBe(readOptions);

    const writePromise = BridgeAPI.writeSaveFile(
      writeOptions,
      'write-second.d2s',
      {} as ID2S,
    );
    await expect(writePromise).rejects.toThrow(
      'Cannot start writeSaveFile while readD2SData is still running.',
    );
    expect(mockWriteD2S).not.toHaveBeenCalled();
    expect(getRuntime()).toBe(readRuntime);
    expect(getRuntime()?.options).toBe(readOptions);

    openBarrier.reject(new Error('stop read at the fake barrier'));
    await expect(readPromise).rejects.toThrow('stop read at the fake barrier');
  });

  it('rejects a second write immediately without changing the first save path or runtime', async () => {
    const firstOptions = makeOptions('write-first');
    const secondOptions = makeOptions('write-second');
    const writeBarrier = createDeferred<Buffer>();
    mockWriteD2S.mockReturnValueOnce(writeBarrier.promise);
    const readBinaryFile = jest
      .spyOn(BridgeAPI, 'readBinaryFile')
      .mockResolvedValue(null);
    const writeBinaryFile = jest
      .spyOn(BridgeAPI, 'writeBinaryFile')
      .mockResolvedValue(1);

    const firstWrite = BridgeAPI.writeSaveFile(
      firstOptions,
      'first.d2s',
      {} as ID2S,
    );
    expect(mockWriteD2S).toHaveBeenCalledTimes(1);
    const firstRuntime = getRuntime();
    expect(firstRuntime?.options).toBe(firstOptions);

    const secondWrite = BridgeAPI.writeSaveFile(
      secondOptions,
      'second.d2s',
      {} as ID2S,
    );
    await expect(secondWrite).rejects.toThrow(
      'Cannot start writeSaveFile while writeSaveFile is still running.',
    );
    expect(mockWriteD2S).toHaveBeenCalledTimes(1);
    expect(getRuntime()).toBe(firstRuntime);
    expect(getRuntime()?.options).toBe(firstOptions);

    writeBarrier.resolve(Buffer.from([1, 2, 3]));
    await expect(firstWrite).resolves.toBe(1);
    expect(readBinaryFile).toHaveBeenCalledWith('first.d2s', 'Saves');
    expect(writeBinaryFile).toHaveBeenCalledWith(
      'first.d2s',
      'Saves',
      [1, 2, 3],
    );
    expect(writeBinaryFile).not.toHaveBeenCalledWith(
      'second.d2s',
      expect.anything(),
      expect.anything(),
    );
  });
});
