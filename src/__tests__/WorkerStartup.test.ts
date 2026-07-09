const mockInitI18n = jest.fn();

jest.mock('../main/worker/AppInfoAPI', () => ({
  initAppInfoAPI: jest.fn(),
}));
jest.mock('../main/worker/BridgeAPI', () => ({
  initBridgeAPI: jest.fn(),
}));
jest.mock('../main/worker/CascLib', () => ({
  initCascLib: jest.fn(),
}));
jest.mock('../main/worker/ConsoleAPI', () => ({
  initConsoleAPI: jest.fn(),
}));
jest.mock('../main/worker/EventAPI', () => ({
  initEventAPI: jest.fn(),
}));
jest.mock('../main/worker/IPC', () => ({
  initIPC: jest.fn(),
}));
jest.mock('../main/worker/ModUpdaterAPI', () => ({
  initModUpdaterAPI: jest.fn(),
}));
jest.mock('../main/worker/asar', () => ({
  initAsar: jest.fn(),
}));
jest.mock('../main/worker/i18n', () => ({
  initI18n: mockInitI18n,
}));
jest.mock('../main/worker/quickjs', () => ({
  initQuickJS: jest.fn(),
}));

describe('worker startup', () => {
  const originalDisconnect = process.disconnect;
  const originalExitCode = process.exitCode;

  afterEach(() => {
    Object.defineProperty(process, 'disconnect', {
      configurable: true,
      value: originalDisconnect,
    });
    process.exitCode = originalExitCode;
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.resetModules();
    mockInitI18n.mockReset();
  });

  it('disconnects with a failure status when initialization fails', async () => {
    const error = new Error('initialization failed');
    const disconnect = jest.fn();
    mockInitI18n.mockRejectedValue(error);
    Object.defineProperty(process, 'disconnect', {
      configurable: true,
      value: disconnect,
    });
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'debug').mockImplementation();

    await import('../main/worker/worker');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(console.error).toHaveBeenCalledWith(error);
    expect(process.exitCode).toBe(1);
    expect(disconnect).toHaveBeenCalled();
  });
});
