import type { IInstallModsOptions } from 'bridge/BridgeAPI';
import { constants as bufferConstants } from 'buffer';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'fs';
import os from 'os';
import path from 'path';
import { BridgeAPI, getRuntime } from '../main/worker/BridgeAPI';

const CASC_ERROR_FILE_OFFLINE = 4350;

const mockCascLib = {
  CascCloseFile: jest.fn(),
  CascCloseStorage: jest.fn(),
  CascGetFileSize64: jest.fn(),
  CascOpenFile: jest.fn(),
  CascOpenStorage: jest.fn(),
  CascOpenStorageEx: jest.fn(),
  CascReadFile: jest.fn(),
  GetCascError: jest.fn(),
};
const mockGetLastCascLibError = jest.fn(
  (errorCode?: number) => `mock CASC error ${errorCode ?? 5}`,
);

jest.mock('main/worker/AppInfoAPI', () => ({
  getAppPath: () => 'C:\\D2RMM-F18-FAKE\\app',
  getBaseSavesPath: () => 'C:\\D2RMM-F18-FAKE\\base-saves',
}));

jest.mock('main/worker/CascLib', () => ({
  CASC_ERROR_FILE_OFFLINE: 4350,
  CASC_FEATURE_ALLOW_DOWNLOAD: 0x00002000,
  getCascLib: () => mockCascLib,
  getLastCascLibError: (...args: unknown[]) =>
    mockGetLastCascLibError(...(args as [number?])),
  makeCascOpenStorageArgs: jest.fn(() => ({})),
  readCString: jest.fn(),
}));

jest.mock('main/worker/third-party/d2s/index', () => ({
  read: jest.fn(),
  readConstantData: jest.fn(),
  setConstantData: jest.fn(),
  stash: {
    read: jest.fn(),
    write: jest.fn(),
  },
  write: jest.fn(),
}));

const TEN_MIB = 10 * 1024 * 1024;

let tempRoot: string;
let gamePathA: string;
let gamePathAlias: string;
let gamePathB: string;
let configuredFileSize: number | bigint;
let nextStorageID: number;
let nextFileID: number;

function makeOptions(id: string): IInstallModsOptions {
  const root = path.join(tempRoot, id);
  return {
    gamePath: gamePathA,
    isDryRun: true,
    isPreExtractedData: false,
    mergedPath: path.join(root, 'mods', 'output', 'output.mpq', 'data'),
    normalizeOutputCRLF: false,
    outputModName: `output-${id}`,
    preExtractedDataPath: path.join(root, 'pre-extracted'),
    savesPath: path.join(root, 'saves'),
  };
}

function configureSuccessfulNativeAPI(): void {
  configuredFileSize = 1;
  nextStorageID = 0;
  nextFileID = 0;
  mockCascLib.CascCloseFile.mockReset().mockReturnValue(true);
  mockCascLib.CascCloseStorage.mockReset().mockReturnValue(true);
  mockCascLib.CascGetFileSize64.mockReset().mockImplementation(
    (_file: unknown, sizeOut: (number | bigint)[]) => {
      sizeOut[0] = configuredFileSize;
      return true;
    },
  );
  mockCascLib.CascOpenFile.mockReset().mockImplementation(
    (
      _storage: unknown,
      _filePath: string,
      _locale: number,
      _flags: number,
      fileOut: unknown[],
    ) => {
      fileOut[0] = { fileID: ++nextFileID };
      return true;
    },
  );
  mockCascLib.CascOpenStorage.mockReset();
  mockCascLib.CascOpenStorageEx.mockReset().mockImplementation(
    (
      _storagePath: string,
      _options: object,
      online: boolean,
      storageOut: unknown[],
    ) => {
      storageOut[0] = { online, storageID: ++nextStorageID };
      return true;
    },
  );
  mockCascLib.CascReadFile.mockReset().mockImplementation(
    (
      _file: unknown,
      buffer: Buffer,
      requestedSize: number,
      bytesReadOut: number[],
    ) => {
      const bytesRead = Math.min(Number(configuredFileSize), requestedSize);
      if (bytesRead > 0) {
        buffer[0] = 0x11;
        buffer[bytesRead - 1] = 0x7f;
      }
      bytesReadOut[0] = bytesRead;
      return true;
    },
  );
  mockCascLib.GetCascError.mockReset().mockReturnValue(5);
  mockGetLastCascLibError.mockClear();
}

async function openFakeStorage(gamePath = gamePathA): Promise<void> {
  await expect(BridgeAPI.openStorage(gamePath)).resolves.toBe(true);
}

describe('BridgeAPI CASC storage ownership', () => {
  beforeAll(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-f18-casc-'));
    gamePathA = path.join(tempRoot, 'game-a');
    gamePathAlias = path.join(tempRoot, 'game-a-alias');
    gamePathB = path.join(tempRoot, 'game-b');
    mkdirSync(path.join(gamePathA, 'alias-child'), { recursive: true });
    mkdirSync(gamePathB, { recursive: true });
    symlinkSync(
      gamePathA,
      gamePathAlias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  });

  beforeEach(() => {
    configureSuccessfulNativeAPI();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    mockCascLib.CascCloseStorage.mockReturnValue(true);
    await BridgeAPI.closeStorage();
    expect(getRuntime()).toBeNull();
  });

  afterAll(() => {
    const resolvedRoot = path.resolve(tempRoot);
    if (!resolvedRoot.startsWith(path.resolve(os.tmpdir()))) {
      throw new Error(`Refusing to remove non-temp fake root: ${resolvedRoot}`);
    }
    rmSync(resolvedRoot, { force: true, recursive: true });
  });

  it('reuses one handle for aliases of the same canonical game path', async () => {
    await openFakeStorage(gamePathA);
    await openFakeStorage(gamePathAlias);

    expect(mockCascLib.CascOpenStorageEx).toHaveBeenCalledTimes(1);
    expect(mockCascLib.CascCloseStorage).not.toHaveBeenCalled();
    expect(mockCascLib.CascOpenStorageEx).toHaveBeenCalledWith(
      `${realpathSync.native(gamePathA)}:osi`,
      expect.anything(),
      false,
      expect.any(Array),
    );
  });

  it('reopens the same canonical path online when forceOnline upgrades ownership', async () => {
    await openFakeStorage(gamePathA);
    await expect(BridgeAPI.openStorage(gamePathAlias, true)).resolves.toBe(
      true,
    );

    expect(mockCascLib.CascCloseStorage).toHaveBeenCalledTimes(1);
    expect(mockCascLib.CascOpenStorageEx).toHaveBeenCalledTimes(2);
    expect(mockCascLib.CascOpenStorageEx.mock.calls[0][2]).toBe(false);
    expect(mockCascLib.CascOpenStorageEx.mock.calls[1][2]).toBe(true);
  });

  it('closes the old handle before opening a different canonical game path', async () => {
    const events: string[] = [];
    mockCascLib.CascOpenStorageEx.mockImplementation(
      (
        _storagePath: string,
        _options: object,
        online: boolean,
        storageOut: unknown[],
      ) => {
        events.push('open');
        storageOut[0] = { online, storageID: ++nextStorageID };
        return true;
      },
    );
    mockCascLib.CascCloseStorage.mockImplementation(() => {
      events.push('close');
      return true;
    });

    await openFakeStorage(gamePathA);
    const firstHandle = mockCascLib.CascOpenStorageEx.mock.calls[0][3][0];
    await openFakeStorage(gamePathB);

    expect(events).toEqual(['open', 'close', 'open']);
    expect(mockCascLib.CascCloseStorage).toHaveBeenCalledWith(firstHandle);
    expect(mockCascLib.CascOpenStorageEx).toHaveBeenCalledTimes(2);
  });

  it('preserves the old state and forbids a new open when close fails', async () => {
    await openFakeStorage(gamePathA);
    mockCascLib.CascCloseStorage.mockReturnValue(false);

    await expect(BridgeAPI.openStorage(gamePathB)).rejects.toThrow(
      'Failed to close CASC storage',
    );
    expect(mockCascLib.CascOpenStorageEx).toHaveBeenCalledTimes(1);

    mockCascLib.CascCloseStorage.mockReturnValue(true);
    await openFakeStorage(gamePathAlias);
    expect(mockCascLib.CascOpenStorageEx).toHaveBeenCalledTimes(1);
  });

  it.each(['readD2SData', 'installMods'] as const)(
    'closes storage in finally when %s fails after opening it',
    async (operation) => {
      const actualOpenStorage = BridgeAPI.openStorage;
      jest
        .spyOn(BridgeAPI, 'openStorage')
        .mockImplementation(async (gamePath, forceOnline) => {
          await actualOpenStorage(gamePath, forceOnline);
          throw new Error(`stop ${operation} after fake open`);
        });
      mockCascLib.CascCloseStorage.mockImplementation(() => {
        expect(getRuntime()).not.toBeNull();
        return true;
      });

      const options = makeOptions(operation);
      const operationPromise =
        operation === 'readD2SData'
          ? BridgeAPI.readD2SData(options)
          : BridgeAPI.installMods([], options);

      await expect(operationPromise).rejects.toThrow(
        `stop ${operation} after fake open`,
      );
      expect(mockCascLib.CascCloseStorage).toHaveBeenCalledTimes(1);
      expect(getRuntime()).toBeNull();
    },
  );

  it('releases the F-04 runtime owner even when finally cannot close storage', async () => {
    const actualOpenStorage = BridgeAPI.openStorage;
    jest
      .spyOn(BridgeAPI, 'openStorage')
      .mockImplementation(async (gamePath, forceOnline) => {
        await actualOpenStorage(gamePath, forceOnline);
        throw new Error('stop operation after fake open');
      });
    mockCascLib.CascCloseStorage.mockReturnValue(false);

    await expect(
      BridgeAPI.installMods([], makeOptions('close-failure')),
    ).rejects.toThrow('Failed to close CASC storage');
    expect(mockCascLib.CascCloseStorage).toHaveBeenCalledTimes(1);
    expect(getRuntime()).toBeNull();
  });

  describe('exact file reads', () => {
    it.each([
      ['zero bytes', 0],
      ['one byte', 1],
      ['10 MiB', TEN_MIB],
      ['10 MiB plus one byte', TEN_MIB + 1],
      ['12 MiB as bigint', BigInt(12 * 1024 * 1024)],
    ])('reads %s using the queried size', async (_label, fileSize) => {
      configuredFileSize = fileSize;
      await openFakeStorage();

      const output = await BridgeAPI.extractFileToMemory('fake/data.bin');
      const expectedSize = Number(fileSize);

      expect(mockCascLib.CascGetFileSize64).toHaveBeenCalledTimes(1);
      expect(mockCascLib.CascReadFile).toHaveBeenCalledTimes(
        expectedSize === 0 ? 0 : 1,
      );
      if (expectedSize > 0) {
        expect(mockCascLib.CascReadFile.mock.calls[0][2]).toBe(expectedSize);
        if (expectedSize > 1) {
          expect(output[0]).toBe(0x11);
        }
        expect(output[expectedSize - 1]).toBe(0x7f);
      }
      expect(output).toHaveLength(expectedSize);
      expect(mockCascLib.CascCloseFile).toHaveBeenCalledTimes(1);
    });

    it('rejects a failed size query and closes the file exactly once', async () => {
      await openFakeStorage();
      mockCascLib.CascGetFileSize64.mockReturnValue(false);

      await expect(
        BridgeAPI.extractFileToMemory('fake/size-failure.bin'),
      ).rejects.toThrow('Failed to get file size');
      expect(mockCascLib.CascReadFile).not.toHaveBeenCalled();
      expect(mockCascLib.CascCloseFile).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'the Buffer or DWORD limit',
        BigInt(Math.min(bufferConstants.MAX_LENGTH, 0xffffffff)) + 1n,
      ],
      ['an unsafe numeric value', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects a size beyond %s before reading', async (_label, fileSize) => {
      configuredFileSize = fileSize;
      await openFakeStorage();

      await expect(
        BridgeAPI.extractFileToMemory('fake/oversize.bin'),
      ).rejects.toThrow(/file size|too large/i);
      expect(mockCascLib.CascReadFile).not.toHaveBeenCalled();
      expect(mockCascLib.CascCloseFile).toHaveBeenCalledTimes(1);
    });

    it('rejects a successful short read and closes the file exactly once', async () => {
      configuredFileSize = 1024;
      await openFakeStorage();
      mockCascLib.CascReadFile.mockImplementation(
        (
          _file: unknown,
          _buffer: Buffer,
          _requestedSize: number,
          bytesReadOut: number[],
        ) => {
          bytesReadOut[0] = 1023;
          return true;
        },
      );

      await expect(
        BridgeAPI.extractFileToMemory('fake/short.bin'),
      ).rejects.toThrow(/incomplete|expected 1024/i);
      expect(mockCascLib.CascCloseFile).toHaveBeenCalledTimes(1);
    });

    it('rejects a failed read and closes the file exactly once', async () => {
      configuredFileSize = 1024;
      await openFakeStorage();
      mockCascLib.CascReadFile.mockReturnValue(false);

      await expect(
        BridgeAPI.extractFileToMemory('fake/read-failure.bin'),
      ).rejects.toThrow('Failed to read file in CASC storage');
      expect(mockCascLib.CascCloseFile).toHaveBeenCalledTimes(1);
    });

    it.each(['size', 'read'] as const)(
      'reopens online after an offline %s failure and closes each file once',
      async (failurePoint) => {
        configuredFileSize = 4;
        await openFakeStorage();
        mockCascLib.GetCascError.mockReturnValueOnce(CASC_ERROR_FILE_OFFLINE);
        if (failurePoint === 'size') {
          mockCascLib.CascGetFileSize64.mockReturnValueOnce(
            false,
          ).mockImplementation(
            (_file: unknown, sizeOut: (number | bigint)[]) => {
              sizeOut[0] = configuredFileSize;
              return true;
            },
          );
        } else {
          mockCascLib.CascReadFile.mockReturnValueOnce(
            false,
          ).mockImplementation(
            (
              _file: unknown,
              buffer: Buffer,
              requestedSize: number,
              bytesReadOut: number[],
            ) => {
              buffer[0] = 0x11;
              buffer[requestedSize - 1] = 0x7f;
              bytesReadOut[0] = requestedSize;
              return true;
            },
          );
        }

        const output = await BridgeAPI.extractFileToMemory('fake/offline.bin');

        expect(output).toHaveLength(4);
        expect(mockCascLib.CascOpenStorageEx).toHaveBeenCalledTimes(2);
        expect(mockCascLib.CascOpenStorageEx.mock.calls[0][2]).toBe(false);
        expect(mockCascLib.CascOpenStorageEx.mock.calls[1][2]).toBe(true);
        expect(mockCascLib.CascCloseFile).toHaveBeenCalledTimes(2);
        expect(new Set(mockCascLib.CascCloseFile.mock.calls.flat()).size).toBe(
          2,
        );
      },
    );

    it('reports close failure after one close attempt', async () => {
      configuredFileSize = 1;
      await openFakeStorage();
      mockCascLib.CascCloseFile.mockReturnValue(false);

      await expect(
        BridgeAPI.extractFileToMemory('fake/close-failure.bin'),
      ).rejects.toThrow('Failed to close file in CASC storage');
      expect(mockCascLib.CascCloseFile).toHaveBeenCalledTimes(1);
    });
  });
});
