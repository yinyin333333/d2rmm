import { promises as fs } from 'fs';
import path from 'path';
import { transferableAbortController } from 'util';
import type { IAppUpdaterAPI } from '../bridge/AppUpdaterAPI';
import {
  assertNoLinks,
  downloadPackage,
  stagePackage,
  validateInstallation,
} from '../main/AppUpdatePackage';
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
    rm: jest.fn().mockResolvedValue(undefined),
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
  let attempt = 0;
  let directory: string;
  beforeAll(() => {
    global.AbortController =
      nativeController.constructor as typeof AbortController;
    global.AbortSignal = nativeController.signal
      .constructor as typeof AbortSignal;
    initAppUpdaterAPI();
    api = (provideAPI as unknown as jest.Mock).mock.calls[0][1];
  });
  beforeEach(() => {
    jest.clearAllMocks();
    directory = path.join(
      path.dirname(process.execPath),
      `.d2rmm-update-test-${++attempt}`,
    );
    (fs.mkdtemp as jest.Mock).mockResolvedValue(directory);
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
      expect(fs.rm).not.toHaveBeenCalled();
      finish();
      await expect(preparing).rejects.toThrow('cancelled');
      expect(fs.rm).toHaveBeenCalledWith(directory, {
        recursive: true,
        force: true,
      });
      expect((await api.status()).log).toBeNull();
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
    await api.cancel();
    expect(fs.rm).not.toHaveBeenCalled();
  });

  test('keeps admission closed until cancelled preparation has finished deleting its files', async () => {
    await api.check();
    await api.prepare();
    let finish!: () => void;
    (fs.rm as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const cancelled = api.cancel();
    // assertNoLinks yields before removal starts.
    await Promise.resolve();
    const duplicate = api.cancel();
    await expect(api.check()).rejects.toThrow('already running');
    await expect(api.prepare()).rejects.toThrow('Check for an update');
    await expect(api.install()).rejects.toThrow('No validated update');
    expect(fs.rm).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([cancelled, duplicate]);
    expect((await api.status()).log).toBeNull();
    (fs.appendFile as jest.Mock).mockClear();
    await api.check();
    expect(fs.appendFile).not.toHaveBeenCalled();
  });

  test('waits for an in-flight directory creation before cleaning a cancelled attempt', async () => {
    await api.check();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finish!: (value: string) => void;
    (fs.mkdtemp as jest.Mock).mockImplementationOnce(() => {
      entered();
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    const preparing = api.prepare();
    await started;
    await api.cancel();
    expect(fs.rm).not.toHaveBeenCalled();
    finish(directory);
    await expect(preparing).rejects.toThrow('cancelled');
    expect(fs.rm).toHaveBeenCalledWith(directory, {
      recursive: true,
      force: true,
    });
  });

  test('retains failed validation diagnostics when the renderer cancels after the error', async () => {
    await api.check();
    (stagePackage as jest.Mock).mockRejectedValueOnce(
      new Error('invalid archive'),
    );
    await expect(api.prepare()).rejects.toThrow('invalid archive');
    await api.cancel();
    expect(fs.rm).not.toHaveBeenCalled();
    expect((await api.status()).message).toContain('invalid archive');
    expect((await api.status()).log).toBe(path.join(directory, 'download.log'));
    const failedDirectory = directory;
    directory = `${directory}-retry`;
    (fs.mkdtemp as jest.Mock).mockResolvedValueOnce(directory);
    await api.prepare();
    await api.cancel();
    expect(fs.rm).toHaveBeenCalledTimes(1);
    expect(fs.rm).toHaveBeenCalledWith(directory, {
      recursive: true,
      force: true,
    });
    expect(directory).not.toBe(failedDirectory);
  });

  test('reports cleanup failure and releases admission without logging into a partly deleted job', async () => {
    await api.check();
    await api.prepare();
    (fs.rm as jest.Mock).mockRejectedValueOnce(new Error('file locked'));
    await expect(api.cancel()).rejects.toThrow('file locked');
    expect((await api.status()).message).toContain(directory);
    expect((await api.status()).log).toBeNull();
    (fs.appendFile as jest.Mock).mockClear();
    await api.check();
    expect(fs.appendFile).not.toHaveBeenCalled();
  });

  test('cancels a retry during initial validation without deleting the earlier failed job', async () => {
    await api.check();
    (stagePackage as jest.Mock).mockRejectedValueOnce(
      new Error('invalid archive'),
    );
    await expect(api.prepare()).rejects.toThrow('invalid archive');
    let finish!: () => void;
    let entered!: () => void;
    let signal!: AbortSignal;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    (validateInstallation as jest.Mock).mockImplementationOnce(
      (_root, _version, _arch, requestSignal) => {
        signal = requestSignal;
        entered();
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    );
    const retry = api.prepare();
    await started;
    await api.cancel();
    expect(signal.aborted).toBe(true);
    finish();
    await expect(retry).rejects.toThrow('cancelled');
    expect(fs.rm).not.toHaveBeenCalled();
  });

  test.each(['outside installation', 'linked directory'])(
    'refuses cleanup of an %s',
    async (condition) => {
      await api.check();
      if (condition === 'outside installation') {
        directory = path.join(
          path.dirname(process.execPath),
          'unowned-directory',
        );
        (fs.mkdtemp as jest.Mock).mockResolvedValueOnce(directory);
      }
      await api.prepare();
      if (condition === 'linked directory')
        (assertNoLinks as jest.Mock).mockRejectedValueOnce(
          new Error('Linked update path'),
        );
      await expect(api.cancel()).rejects.toThrow(
        'Could not remove cancelled update files',
      );
      expect(fs.rm).not.toHaveBeenCalled();
    },
  );
});
