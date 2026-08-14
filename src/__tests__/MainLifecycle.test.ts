import { EventEmitter } from 'events';
import { createMainLifecycleCoordinator } from '../main/MainLifecycle';

type FakeWindow = { id: number };

describe('macOS main process lifecycle', () => {
  it('rebinds every recreated window while process services initialize once', async () => {
    const bindWindow = jest.fn().mockResolvedValue(undefined);
    const initAppInfoAPI = jest.fn().mockResolvedValue(undefined);
    const initConsoleAPI = jest.fn().mockResolvedValue(undefined);
    const initEventAPI = jest.fn().mockResolvedValue(undefined);
    const initLocaleAPI = jest.fn().mockResolvedValue(undefined);
    const initNxmProtocolAPI = jest.fn().mockResolvedValue(undefined);
    const initRequestAPI = jest.fn().mockResolvedValue(undefined);
    const initShellAPI = jest.fn().mockResolvedValue(undefined);
    const spawnWorker = jest.fn().mockResolvedValue(undefined);
    const lifecycle = createMainLifecycleCoordinator<FakeWindow>({
      bindWindow,
      initAppInfoAPI,
      initConsoleAPI,
      initEventAPI,
      initLocaleAPI,
      initNxmProtocolAPI,
      initRequestAPI,
      initShellAPI,
      spawnWorker,
    });
    const app = new EventEmitter();
    let nextWindowID = 0;
    let currentWindow: FakeWindow | null = null;
    let pendingActivation = Promise.resolve();

    const createWindow = async (): Promise<void> => {
      currentWindow = { id: ++nextWindowID };
      await lifecycle.attachWindow(currentWindow);
    };
    const closeWindow = (): void => {
      currentWindow = null;
    };
    app.on('activate', () => {
      pendingActivation =
        currentWindow == null ? createWindow() : Promise.resolve();
    });

    await createWindow();
    for (let i = 0; i < 3; i++) {
      closeWindow();
      app.emit('activate');
      await pendingActivation;
    }

    expect(bindWindow.mock.calls.map(([window]) => window.id)).toEqual([
      1, 2, 3, 4,
    ]);
    for (const initialize of [
      initAppInfoAPI,
      initConsoleAPI,
      initEventAPI,
      initLocaleAPI,
      initNxmProtocolAPI,
      initRequestAPI,
      initShellAPI,
      spawnWorker,
    ]) {
      expect(initialize).toHaveBeenCalledTimes(1);
    }
  });
});
