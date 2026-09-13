import { promises as fs } from 'fs';
import { transferableAbortController } from 'util';
import type { IAppUpdaterAPI } from '../bridge/AppUpdaterAPI';
import { downloadPackage, stagePackage } from '../main/AppUpdatePackage';
import { initAppUpdaterAPI, isAppUpdateBusy } from '../main/AppUpdaterAPI';
import { freezeForUpdate, provideAPI } from '../main/IPC';

jest.mock(
  'electron',
  () => ({
    app: { isPackaged: true, getVersion: () => '1.0.0' },
    BrowserWindow: { getAllWindows: () => [] },
  }),
  { virtual: true },
);
jest.mock('../main/IPC', () => ({
  provideAPI: jest.fn(),
  freezeForUpdate: jest.fn(),
  resumeAfterUpdateFailure: jest.fn(),
}));
jest.mock('../main/Workers', () => ({}));
jest.mock('fs', () => ({
  promises: {
    appendFile: jest.fn().mockResolvedValue(undefined),
    mkdtemp: jest.fn().mockResolvedValue('temporary-update'),
    writeFile: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../main/AppUpdatePackage', () => ({
  updateRequestSignal: jest.requireActual('../main/AppUpdatePackage')
    .updateRequestSignal,
  selectRelease: () => ({ version: '1.1.0', asset: {} }),
  assertNoLinks: jest.fn().mockResolvedValue(undefined),
  validateInstallation: jest.fn().mockResolvedValue(undefined),
  downloadPackage: jest.fn().mockResolvedValue(undefined),
  stagePackage: jest.fn().mockResolvedValue(undefined),
}));

const windows =
  process.platform === 'win32' && process.arch === 'x64'
    ? describe
    : describe.skip;
windows('Windows update cancellation and handoff', () => {
  // Use Node's AbortSignal composition, also used by the Electron main process.
  const nativeController = transferableAbortController();
  const originalController = global.AbortController;
  const originalSignal = global.AbortSignal;
  const originalFetch = global.fetch;
  let api: IAppUpdaterAPI;
  beforeAll(() => {
    global.AbortController =
      nativeController.constructor as typeof AbortController;
    global.AbortSignal = nativeController.signal
      .constructor as typeof AbortSignal;
    initAppUpdaterAPI();
    api = (provideAPI as unknown as jest.Mock).mock.calls[0][1];
  });
  beforeEach(() => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] });
  });
  afterEach(async () => {
    await api.cancel();
  });
  afterAll(() => {
    global.AbortController = originalController;
    global.AbortSignal = originalSignal;
    global.fetch = originalFetch;
  });

  test('cancels a pending release lookup without blocking normal exit or accepting its late response', async () => {
    let respond!: (value: unknown) => void;
    let signal!: AbortSignal;
    (global.fetch as jest.Mock).mockImplementation((_url, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        respond = resolve;
      });
    });
    const checking = api.check();
    await Promise.resolve();
    expect(isAppUpdateBusy()).toBe(false);
    await api.cancel();
    expect(signal.aborted).toBe(true);
    await expect(api.check()).rejects.toThrow('already running');
    respond({ ok: true, json: async () => [] });
    await expect(checking).rejects.toThrow('cancelled');
    expect((await api.status()).phase).toBe('failed');
  });

  test.each(['downloading', 'validating'])(
    'cancels %s and never admits installation afterwards',
    async (phase) => {
      await api.check();
      let finish!: () => void;
      let entered!: () => void;
      let signal!: AbortSignal;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const fn = phase === 'downloading' ? downloadPackage : stagePackage;
      (fn as jest.Mock).mockImplementationOnce((...args) => {
        signal = args[phase === 'downloading' ? 3 : 4];
        entered();
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      });
      const preparing = api.prepare();
      await started;
      expect(isAppUpdateBusy()).toBe(false);
      await api.cancel();
      expect(signal.aborted).toBe(true);
      finish();
      await expect(preparing).rejects.toThrow('cancelled');
      await expect(api.install()).rejects.toThrow('No validated update');
      expect((await api.status()).phase).toBe('failed');
    },
  );

  test('blocks exit and cancellation only during installation handoff, and releases it on failure', async () => {
    await api.check();
    await api.prepare();
    expect(isAppUpdateBusy()).toBe(false);
    (freezeForUpdate as jest.Mock).mockImplementationOnce(() => {
      throw new Error('handoff failure');
    });
    let release!: () => void;
    (fs.writeFile as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const installing = api.install();
    expect(isAppUpdateBusy()).toBe(true);
    await expect(api.cancel()).rejects.toThrow('handoff');
    release();
    await expect(installing).rejects.toThrow('handoff failure');
    expect(isAppUpdateBusy()).toBe(false);
  });
});
