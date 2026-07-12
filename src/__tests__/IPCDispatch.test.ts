import type { IPCMessageRequest } from 'bridge/IPC';
import {
  consumeAPI,
  initIPC,
  markWorkerReady,
  provideAPI,
  registerWorker,
  unregisterWorker,
} from 'main/IPC';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

const mockIpcMainOn = jest.fn();

jest.mock('electron', () => ({
  ipcMain: {
    on: (...args: unknown[]) => mockIpcMainOn(...args),
  },
}));

class FakeChildProcess extends EventEmitter {
  connected = true;

  send = jest.fn((...args: unknown[]) => {
    const callback = args.find((arg) => typeof arg === 'function') as
      | ((error: Error | null) => void)
      | undefined;
    callback?.(null);
    return true;
  });
}

class FakeWebContents extends EventEmitter {
  destroyed = false;
  readonly mainFrame = {};

  send = jest.fn();

  isDestroyed = (): boolean => this.destroyed;

  destroy(): void {
    this.destroyed = true;
    this.emit('destroyed');
  }
}

function asChildProcess(worker: FakeChildProcess): ChildProcess {
  return worker as unknown as ChildProcess;
}

function rendererEvent(renderer: FakeWebContents): Electron.IpcMainEvent {
  return {
    sender: renderer,
    senderFrame: renderer.mainFrame,
  } as unknown as Electron.IpcMainEvent;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function initializeMainIPC(
  renderer: FakeWebContents,
): Promise<(event: Electron.IpcMainEvent, message: IPCMessageRequest) => void> {
  await initIPC({ webContents: renderer } as never);
  return mockIpcMainOn.mock.calls[mockIpcMainOn.mock.calls.length - 1][1];
}

describe('main IPC deterministic dispatch', () => {
  it('handles a known main API locally without forwarding it to a worker', async () => {
    const renderer = new FakeWebContents();
    const listener = await initializeMainIPC(renderer);
    const worker = new FakeChildProcess();
    const child = asChildProcess(worker);
    registerWorker(child);
    markWorkerReady(child);
    const ping = jest.fn(async () => 'pong');
    provideAPI('KnownMainDispatchTestAPI', { ping });

    listener(rendererEvent(renderer), {
      id: 'renderer:known-main',
      namespace: 'KnownMainDispatchTestAPI',
      api: 'ping',
      args: [],
    });
    await flushPromises();

    expect(ping).toHaveBeenCalledTimes(1);
    expect(renderer.send).toHaveBeenCalledWith('ipc', {
      id: 'renderer:known-main',
      result: 'pong',
    });
    expect(worker.send).not.toHaveBeenCalled();
    unregisterWorker(child);
  });

  it('returns a structured not-ready error when no ready worker can route a request', async () => {
    const renderer = new FakeWebContents();
    const listener = await initializeMainIPC(renderer);

    listener(rendererEvent(renderer), {
      id: 'renderer:not-ready',
      namespace: 'MissingWorkerTestAPI',
      api: 'ping',
      args: [],
    });
    await flushPromises();

    expect(renderer.send).toHaveBeenCalledWith(
      'ipc',
      expect.objectContaining({
        id: 'renderer:not-ready',
        error: expect.objectContaining({ name: 'WorkerNotReadyError' }),
      }),
    );
  });

  it.each(['constructor', 'notCallable', 'syncThrow'])(
    'turns unsafe worker-origin method %s into a structured error',
    async (api) => {
      const renderer = new FakeWebContents();
      await initializeMainIPC(renderer);
      const worker = new FakeChildProcess();
      const child = asChildProcess(worker);
      registerWorker(child);
      provideAPI('UnsafeMainDispatchTestAPI', {
        notCallable: 'not a function',
        syncThrow: () => {
          throw new Error('synchronous handler failure');
        },
      } as never);

      expect(() =>
        worker.emit('message', {
          id: `worker:${api}`,
          namespace: 'UnsafeMainDispatchTestAPI',
          api,
          args: [],
        }),
      ).not.toThrow();
      await flushPromises();

      expect(worker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          id: `worker:${api}`,
          error: expect.objectContaining({
            name: api === 'syncThrow' ? 'Error' : 'IPCUnknownMethodError',
          }),
        }),
        expect.any(Function),
      );
      unregisterWorker(child);
    },
  );

  it('tracks renderer requests and reports them when the selected worker closes', async () => {
    const renderer = new FakeWebContents();
    const listener = await initializeMainIPC(renderer);
    const worker = new FakeChildProcess();
    const child = asChildProcess(worker);
    registerWorker(child);
    markWorkerReady(child);

    listener(rendererEvent(renderer), {
      id: 'renderer:worker-pending',
      namespace: 'WorkerOnlyDispatchTestAPI',
      api: 'ping',
      args: [],
    });
    await flushPromises();
    expect(worker.send).toHaveBeenCalledTimes(1);

    unregisterWorker(child);

    expect(renderer.send).toHaveBeenCalledWith(
      'ipc',
      expect.objectContaining({
        control: 'transport-closed',
        destination: 'worker',
        requestIds: ['renderer:worker-pending'],
      }),
    );
  });

  it('rejects main-origin renderer calls immediately after renderer destruction', async () => {
    const renderer = new FakeWebContents();
    await initializeMainIPC(renderer);
    const liveAPI = consumeAPI<{ ping(): Promise<void> }>(
      'LiveRendererPendingTestAPI',
    );
    let pendingRejection: Error | null = null;
    const pendingRequest = liveAPI.ping().catch((error: Error) => {
      pendingRejection = error;
    });
    renderer.destroy();
    const api = consumeAPI<{ ping(): Promise<void> }>(
      'DestroyedRendererTestAPI',
    );
    let rejection: Error | null = null;

    void api.ping().catch((error: Error) => {
      rejection = error;
    });
    await flushPromises();

    await pendingRequest;
    expect(pendingRejection).toMatchObject({
      name: 'IPCTransportClosedError',
    });
    expect(rejection).toMatchObject({ name: 'IPCTransportClosedError' });
  });

  it('rejects main-origin worker calls when that worker unregisters', async () => {
    const renderer = new FakeWebContents();
    await initializeMainIPC(renderer);
    const worker = new FakeChildProcess();
    const child = asChildProcess(worker);
    registerWorker(child);
    markWorkerReady(child);
    const api = consumeAPI<{ ping(): Promise<void> }>(
      'MainWorkerPendingTestAPI',
      {},
      false,
      { destination: 'worker' },
    );

    const request = api.ping();
    unregisterWorker(child);

    await expect(request).rejects.toMatchObject({
      name: 'IPCTransportClosedError',
    });
  });

  it('returns a failed worker send to the originating renderer once', async () => {
    const renderer = new FakeWebContents();
    const listener = await initializeMainIPC(renderer);
    const worker = new FakeChildProcess();
    const child = asChildProcess(worker);
    registerWorker(child);
    markWorkerReady(child);
    const sendError = new Error('main-to-worker send failed');
    worker.send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args.find((arg) => typeof arg === 'function') as
        | ((error: Error | null) => void)
        | undefined;
      callback?.(sendError);
      return false;
    });

    listener(rendererEvent(renderer), {
      id: 'renderer:failed-worker-send',
      namespace: 'FailedWorkerSendTestAPI',
      api: 'ping',
      args: [],
    });
    await flushPromises();

    expect(renderer.send).toHaveBeenCalledWith(
      'ipc',
      expect.objectContaining({
        id: 'renderer:failed-worker-send',
        error: expect.objectContaining({
          message: 'main-to-worker send failed',
        }),
      }),
    );
    renderer.send.mockClear();
    unregisterWorker(child);
    expect(renderer.send).not.toHaveBeenCalled();
  });

  it('preserves Event/Console-style broadcast delivery exactly once', async () => {
    const renderer = new FakeWebContents();
    const listener = await initializeMainIPC(renderer);
    const worker = new FakeChildProcess();
    const child = asChildProcess(worker);
    registerWorker(child);
    markWorkerReady(child);
    const send = jest.fn(async () => {});
    provideAPI('BroadcastDispatchTestAPI', { send }, true);

    listener(rendererEvent(renderer), {
      id: 'renderer:broadcast',
      namespace: 'BroadcastDispatchTestAPI',
      api: 'send',
      args: ['renderer-event'],
    });
    await flushPromises();

    expect(send).toHaveBeenCalledTimes(1);
    expect(worker.send).toHaveBeenCalledTimes(1);
    expect(renderer.send).not.toHaveBeenCalled();

    send.mockClear();
    worker.send.mockClear();
    renderer.send.mockClear();
    worker.emit('message', {
      id: 'worker:broadcast',
      namespace: 'BroadcastDispatchTestAPI',
      api: 'send',
      args: ['worker-event'],
    });
    await flushPromises();

    expect(send).toHaveBeenCalledTimes(1);
    expect(renderer.send).toHaveBeenCalledTimes(1);
    expect(renderer.send).toHaveBeenCalledWith('ipc', {
      id: 'worker:broadcast',
      namespace: 'BroadcastDispatchTestAPI',
      api: 'send',
      args: ['worker-event'],
    });
    expect(worker.send).not.toHaveBeenCalled();
    unregisterWorker(child);
  });

  it('registers one ipcMain listener while rebinding requests to the latest renderer', async () => {
    const firstRenderer = new FakeWebContents();
    const secondRenderer = new FakeWebContents();
    await initIPC({ webContents: firstRenderer } as never);
    await initIPC({ webContents: secondRenderer } as never);
    const ping = jest.fn(async () => 'pong');
    provideAPI('RendererRebindTestAPI', { ping });

    const ipcListeners = mockIpcMainOn.mock.calls
      .filter(([channel]) => channel === 'ipc')
      .map(
        ([, listener]) =>
          listener as (
            event: Electron.IpcMainEvent,
            message: IPCMessageRequest,
          ) => void,
      );
    expect(ipcListeners).toHaveLength(1);

    for (const listener of ipcListeners) {
      listener(rendererEvent(secondRenderer), {
        id: 'renderer:rebound-once',
        namespace: 'RendererRebindTestAPI',
        api: 'ping',
        args: [],
      });
    }
    await flushPromises();

    expect(ping).toHaveBeenCalledTimes(1);
    expect(firstRenderer.send).not.toHaveBeenCalled();
    expect(secondRenderer.send).toHaveBeenCalledTimes(1);
    expect(secondRenderer.send).toHaveBeenCalledWith('ipc', {
      id: 'renderer:rebound-once',
      result: 'pong',
    });
  });

  it('rejects old-renderer pending requests when a new renderer is bound', async () => {
    const firstRenderer = new FakeWebContents();
    const secondRenderer = new FakeWebContents();
    await initIPC({ webContents: firstRenderer } as never);
    const api = consumeAPI<{ ping(): Promise<void> }>(
      'OldRendererPendingTestAPI',
      {},
      false,
      { timeoutMs: 25 },
    );
    const pendingRequest = api.ping();

    await initIPC({ webContents: secondRenderer } as never);

    await expect(pendingRequest).rejects.toMatchObject({
      name: 'IPCTransportClosedError',
    });
  });

  it('does not let a late old-renderer destroy clear new renderer requests', async () => {
    const firstRenderer = new FakeWebContents();
    const secondRenderer = new FakeWebContents();
    await initIPC({ webContents: firstRenderer } as never);
    await initIPC({ webContents: secondRenderer } as never);
    const ipcListener = mockIpcMainOn.mock.calls.find(
      ([channel]) => channel === 'ipc',
    )?.[1] as (
      event: Electron.IpcMainEvent,
      message: IPCMessageRequest,
    ) => void;
    const worker = new FakeChildProcess();
    const child = asChildProcess(worker);
    registerWorker(child);
    markWorkerReady(child);

    ipcListener(rendererEvent(secondRenderer), {
      id: 'renderer:new-pending',
      namespace: 'WorkerAfterRendererRebindTestAPI',
      api: 'ping',
      args: [],
    });
    firstRenderer.destroy();
    worker.emit('message', {
      id: 'renderer:new-pending',
      result: 'pong',
    });
    await flushPromises();

    expect(secondRenderer.send).toHaveBeenCalledWith('ipc', {
      id: 'renderer:new-pending',
      result: 'pong',
    });
    unregisterWorker(child);
  });

  it('does not deliver an old in-flight main response to a rebound renderer', async () => {
    const firstRenderer = new FakeWebContents();
    const secondRenderer = new FakeWebContents();
    await initIPC({ webContents: firstRenderer } as never);
    const ipcListener = mockIpcMainOn.mock.calls.find(
      ([channel]) => channel === 'ipc',
    )?.[1] as (
      event: Electron.IpcMainEvent,
      message: IPCMessageRequest,
    ) => void;
    let resolvePing!: (value: string) => void;
    provideAPI('SlowRendererRebindTestAPI', {
      ping: () =>
        new Promise<string>((resolve) => {
          resolvePing = resolve;
        }),
    });

    ipcListener(rendererEvent(firstRenderer), {
      id: 'renderer:old-in-flight',
      namespace: 'SlowRendererRebindTestAPI',
      api: 'ping',
      args: [],
    });
    await initIPC({ webContents: secondRenderer } as never);
    resolvePing('pong');
    await flushPromises();

    expect(firstRenderer.send).not.toHaveBeenCalled();
    expect(secondRenderer.send).not.toHaveBeenCalled();
  });
});
