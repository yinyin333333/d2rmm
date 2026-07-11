import type { IPCMessage } from 'bridge/IPC';

type WorkerIPCModule = typeof import('main/worker/IPC');

type ProcessMessageListener = (message: IPCMessage) => void;

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('worker IPC deterministic lifecycle', () => {
  let originalSendDescriptor: PropertyDescriptor | undefined;
  let processOn: jest.SpyInstance;
  let listeners: Map<string, (...args: unknown[]) => void>;
  let send: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    listeners = new Map();
    originalSendDescriptor = Object.getOwnPropertyDescriptor(process, 'send');
    send = jest.fn((...args: unknown[]) => {
      const callback = args.find((arg) => typeof arg === 'function') as
        | ((error: Error | null) => void)
        | undefined;
      callback?.(null);
      return true;
    });
    Object.defineProperty(process, 'send', {
      configurable: true,
      value: send,
      writable: true,
    });
    const originalOn = process.on.bind(process);
    processOn = jest.spyOn(process, 'on').mockImplementation(
      ((event: string, listener: (...args: unknown[]) => void) => {
        if (event === 'message' || event === 'disconnect') {
          listeners.set(event, listener);
          return process;
        }
        return originalOn(event as never, listener as never);
      }) as typeof process.on,
    );
  });

  afterEach(() => {
    processOn.mockRestore();
    if (originalSendDescriptor == null) {
      delete (process as NodeJS.Process & { send?: unknown }).send;
    } else {
      Object.defineProperty(process, 'send', originalSendDescriptor);
    }
  });

  async function loadWorkerIPC(): Promise<WorkerIPCModule> {
    let ipc: WorkerIPCModule | null = null;
    jest.isolateModules(() => {
      ipc = require('main/worker/IPC') as WorkerIPCModule;
    });
    await ipc!.initIPC();
    return ipc!;
  }

  it.each(['constructor', 'notCallable', 'syncThrow'])(
    'returns a structured error for unsafe method %s without losing the listener',
    async (api) => {
      const ipc = await loadWorkerIPC();
      ipc.provideAPI(
        'UnsafeWorkerDispatchTestAPI',
        {
          notCallable: 'not a function',
          syncThrow: () => {
            throw new Error('worker synchronous failure');
          },
        } as never,
      );
      const messageListener = listeners.get('message') as ProcessMessageListener;

      expect(() =>
        messageListener({
          id: `main:${api}`,
          namespace: 'UnsafeWorkerDispatchTestAPI',
          api,
          args: [],
        }),
      ).not.toThrow();
      await flushPromises();

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          id: `main:${api}`,
          error: expect.objectContaining({
            name:
              api === 'syncThrow' ? 'Error' : 'IPCUnknownMethodError',
          }),
        }),
        expect.any(Function),
      );
    },
  );

  it('rejects all pending main requests on process disconnect', async () => {
    const ipc = await loadWorkerIPC();
    const api = ipc.consumeAPI<{ ping(): Promise<void> }>(
      'WorkerDisconnectPendingTestAPI',
    );
    let rejection: Error | null = null;
    const request = api.ping().catch((error: Error) => {
      rejection = error;
    });

    const disconnectListener = listeners.get('disconnect');
    expect(disconnectListener).toBeDefined();
    disconnectListener?.();
    await request;

    expect(rejection).toMatchObject({ name: 'IPCTransportClosedError' });
  });

  it('rejects a request when process.send reports an asynchronous failure', async () => {
    const ipc = await loadWorkerIPC();
    const sendError = new Error('worker send failed');
    send.mockImplementationOnce((...args: unknown[]) => {
      const callback = args.find((arg) => typeof arg === 'function') as
        | ((error: Error | null) => void)
        | undefined;
      callback?.(sendError);
      return false;
    });
    const api = ipc.consumeAPI<{ ping(): Promise<void> }>(
      'WorkerSendFailureTestAPI',
    );

    await expect(api.ping()).rejects.toBe(sendError);
  });
});
