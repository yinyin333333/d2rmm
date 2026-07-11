import type { IInstallModsOptions, Mod } from 'bridge/BridgeAPI';
import { BridgeAPI, getRuntime } from '../main/worker/BridgeAPI';

const mockEventSend = jest.fn().mockResolvedValue(undefined);
const mockScopeDispose = jest.fn();
const mockScopeManage = jest.fn((value: unknown) => value);
const mockCreateQuickJSContext = jest.fn();
const mockGetQuickJSProxyAPI = jest.fn(() => ({}));

jest.mock('quickjs-emscripten', () => ({
  Scope: jest.fn(() => ({
    dispose: mockScopeDispose,
    manage: mockScopeManage,
  })),
}));

jest.mock('source-map', () => ({
  SourceMapConsumer: jest.fn(() =>
    Promise.reject(new Error('synthetic source-map failure')),
  ),
  SourceMapGenerator: jest.fn(),
}));

jest.mock('main/worker/quickjs', () => ({
  getQuickJS: () => ({
    newContext: () => mockCreateQuickJSContext(),
  }),
  getQuickJSProxyAPI: () => mockGetQuickJSProxyAPI(),
}));

jest.mock('main/worker/AppInfoAPI', () => ({
  getAppPath: () => 'C:\\D2RMM-TD04-FAKE\\app',
  getBaseSavesPath: () => 'C:\\D2RMM-TD04-FAKE\\base-saves',
}));

jest.mock('main/worker/EventAPI', () => ({
  EventAPI: {
    send: (...args: unknown[]) => mockEventSend(...args),
  },
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

const mockedSourceMapConsumer = jest.requireMock('source-map')
  .SourceMapConsumer as jest.Mock;

const options: IInstallModsOptions = {
  gamePath: 'C:\\D2RMM-TD04-FAKE\\game',
  isDryRun: true,
  isPreExtractedData: true,
  mergedPath: 'C:\\D2RMM-TD04-FAKE\\output\\Fake.mpq\\data',
  normalizeOutputCRLF: false,
  outputModName: 'Fake',
  preExtractedDataPath: 'C:\\D2RMM-TD04-FAKE\\source',
  savesPath: 'C:\\D2RMM-TD04-FAKE\\saves',
};

const mod: Mod = {
  config: {},
  id: 'RuntimeFailure',
  info: {
    name: 'RuntimeFailure',
    type: 'd2rmm',
    version: '1.0.0',
  },
};

describe('BridgeAPI QuickJS scope cleanup', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    mockEventSend.mockClear();
    mockScopeDispose.mockClear();
    mockScopeManage.mockClear();
    mockCreateQuickJSContext.mockReset();
    mockGetQuickJSProxyAPI.mockClear();

    mockCreateQuickJSContext.mockReturnValue({
      evalCodeAsync: jest
        .fn()
        .mockRejectedValue(new Error('synthetic QuickJS runtime failure')),
      global: {},
      setProp: jest.fn(),
      unwrapResult: jest.fn(),
    });
  });

  afterEach(() => {
    expect(getRuntime()).toBeNull();
  });

  it('disposes the scope when source-map processing also fails', async () => {
    jest
      .spyOn(BridgeAPI, 'readModCode')
      .mockResolvedValue(['while (true) {}', '{"version":3}']);

    await expect(BridgeAPI.installMods([mod], options)).rejects.toThrow(
      'synthetic source-map failure',
    );

    expect(mockCreateQuickJSContext).toHaveBeenCalledTimes(1);
    expect(mockedSourceMapConsumer).toHaveBeenCalledTimes(1);
    expect(mockScopeDispose).toHaveBeenCalledTimes(1);
  });
});
