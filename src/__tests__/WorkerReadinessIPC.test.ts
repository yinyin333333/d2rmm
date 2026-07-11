import type { IPCMessageRequest } from 'bridge/IPC';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

const mockIpcMainOn = jest.fn();

jest.mock('electron', () => ({
  ipcMain: {
    on: (...args: unknown[]) => mockIpcMainOn(...args),
  },
}));

class FakeChildProcess extends EventEmitter {
  send = jest.fn((...args: unknown[]) => {
    const callback = args.find((arg) => typeof arg === 'function') as
      | ((error: Error | null) => void)
      | undefined;
    callback?.(null);
    return true;
  });
}

function asChildProcess(worker: FakeChildProcess): ChildProcess {
  return worker as unknown as ChildProcess;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('main IPC worker readiness', () => {
  it('allows initializing worker requests but blocks outbound traffic until ready', async () => {
    const renderer = {
      isDestroyed: () => false,
      mainFrame: {},
      send: jest.fn(),
    };
    await initIPC({ webContents: renderer } as never);
    const ipcListener = mockIpcMainOn.mock.calls.find(
      ([channel]) => channel === 'ipc',
    )?.[1] as (
      event: Electron.IpcMainEvent,
      message: IPCMessageRequest,
    ) => void;
    expect(ipcListener).toBeDefined();

    provideAPI('WorkerInitializationTestAPI', {
      getInitializationValue: async () => 'initialized',
    });

    const worker = new FakeChildProcess();
    const child = asChildProcess(worker);
    registerWorker(child);

    worker.emit('message', {
      id: 'worker:init',
      namespace: 'WorkerInitializationTestAPI',
      api: 'getInitializationValue',
      args: [],
    });
    await flushPromises();
    expect(worker.send).toHaveBeenCalledWith(
      {
        id: 'worker:init',
        result: 'initialized',
      },
      expect.any(Function),
    );

    worker.send.mockClear();
    const rendererEvent = {
      sender: renderer,
      senderFrame: renderer.mainFrame,
    } as unknown as Electron.IpcMainEvent;
    ipcListener(rendererEvent, {
      id: 'renderer:before-ready',
      namespace: 'WorkerOnlyTestAPI',
      api: 'ping',
      args: [],
    });
    expect(worker.send).not.toHaveBeenCalled();

    markWorkerReady(child);
    ipcListener(rendererEvent, {
      id: 'renderer:after-ready',
      namespace: 'WorkerOnlyTestAPI',
      api: 'ping',
      args: [],
    });
    expect(worker.send).toHaveBeenCalledWith(
      {
        id: 'renderer:after-ready',
        namespace: 'WorkerOnlyTestAPI',
        api: 'ping',
        args: [],
      },
      expect.any(Function),
    );

    unregisterWorker(child);
  });

  it('does not forward worker lifecycle controls as API messages', async () => {
    const renderer = { isDestroyed: () => false, send: jest.fn() };
    await initIPC({ webContents: renderer } as never);
    const worker = new FakeChildProcess();
    const child = asChildProcess(worker);
    registerWorker(child);

    worker.emit('message', { control: 'worker-ready' });
    await flushPromises();

    expect(renderer.send).not.toHaveBeenCalled();
    expect(worker.send).not.toHaveBeenCalled();
    unregisterWorker(child);
  });
});

// Import after the Electron mock so the IPC module registers against the fake.
import {
  initIPC,
  markWorkerReady,
  provideAPI,
  registerWorker,
  unregisterWorker,
} from 'main/IPC';
