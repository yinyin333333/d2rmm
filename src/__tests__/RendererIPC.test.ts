import type { IPCMessage, IPCTransportClosedMessage } from 'bridge/IPC';
import type { RendererIPCBridge } from 'bridge/RendererIPCBridge';

type RendererIPCModule = typeof import('renderer/IPC');

function createBridge(): {
  bridge: RendererIPCBridge;
  getListener: () => (
    event: Electron.IpcRendererEvent,
    message: IPCMessage | IPCTransportClosedMessage,
  ) => void;
  send: jest.Mock;
} {
  let listener:
    | ((
        event: Electron.IpcRendererEvent,
        message: IPCMessage | IPCTransportClosedMessage,
      ) => void)
    | null = null;
  const send = jest.fn();
  const bridge = {
    addListener: jest.fn((newListener) => {
      listener = newListener;
      return newListener;
    }),
    removeAllListeners: jest.fn(),
    removeListener: jest.fn(),
    send,
  } as RendererIPCBridge;
  return {
    bridge,
    getListener: () => {
      if (listener == null) {
        throw new Error('Renderer IPC listener was not registered.');
      }
      return listener;
    },
    send,
  };
}

async function loadRendererIPC(
  bridge: RendererIPCBridge,
): Promise<RendererIPCModule> {
  Object.defineProperty(window, 'IPCBridge', {
    configurable: true,
    value: bridge,
  });
  let ipc: RendererIPCModule | null = null;
  jest.isolateModules(() => {
    ipc = require('renderer/IPC') as RendererIPCModule;
  });
  await ipc!.initIPC();
  return ipc!;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('renderer IPC deterministic lifecycle', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('rejects only worker-destination requests named by a transport-close control', async () => {
    const { bridge, getListener, send } = createBridge();
    const ipc = await loadRendererIPC(bridge);
    const workerAPI = ipc.consumeAPI<{ ping(): Promise<void> }>(
      'RendererWorkerDestinationTestAPI',
      {},
      false,
      { destination: 'worker' },
    );
    const mainAPI = ipc.consumeAPI<{ ping(): Promise<void> }>(
      'RendererMainDestinationTestAPI',
    );
    let workerError: Error | null = null;
    let mainError: Error | null = null;
    const workerPromise = workerAPI.ping().catch((error: Error) => {
      workerError = error;
    });
    const mainPromise = mainAPI.ping().catch((error: Error) => {
      mainError = error;
    });
    const workerRequest = send.mock.calls[0][0] as IPCMessage;
    const mainRequest = send.mock.calls[1][0] as IPCMessage;

    getListener()({} as Electron.IpcRendererEvent, {
      control: 'transport-closed',
      destination: 'worker',
      error: {
        name: 'IPCTransportClosedError',
        message: 'worker closed',
        stack: undefined,
      },
      requestIds: [workerRequest.id],
    });
    await flushPromises();

    expect(workerError).toMatchObject({ name: 'IPCTransportClosedError' });
    expect(mainError).toBeNull();

    getListener()({} as Electron.IpcRendererEvent, {
      id: mainRequest.id,
      result: undefined,
    });
    await Promise.all([workerPromise, mainPromise]);
  });

  it.each(['constructor', 'notCallable', 'syncThrow'])(
    'returns a structured error for unsafe renderer method %s',
    async (api) => {
      const { bridge, getListener, send } = createBridge();
      const ipc = await loadRendererIPC(bridge);
      ipc.provideAPI('UnsafeRendererDispatchTestAPI', {
        notCallable: 'not a function',
        syncThrow: () => {
          throw new Error('renderer synchronous failure');
        },
      } as never);

      expect(() =>
        getListener()({} as Electron.IpcRendererEvent, {
          id: `main:${api}`,
          namespace: 'UnsafeRendererDispatchTestAPI',
          api,
          args: [],
        }),
      ).not.toThrow();
      await flushPromises();

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          id: `main:${api}`,
          error: expect.objectContaining({
            name: api === 'syncThrow' ? 'Error' : 'IPCUnknownMethodError',
          }),
        }),
      );
    },
  );

  it('rejects pending requests when renderer IPC disconnects', async () => {
    const { bridge, getListener } = createBridge();
    const ipc = await loadRendererIPC(bridge);
    const api = ipc.consumeAPI<{ ping(): Promise<void> }>(
      'RendererDisconnectPendingTestAPI',
      {},
      false,
      { destination: 'worker' },
    );
    let rejection: Error | null = null;
    const request = api.ping().catch((error: Error) => {
      rejection = error;
    });

    getListener()({} as Electron.IpcRendererEvent, {
      id: 'main:disconnect',
      namespace: 'RendererIPCAPI',
      api: 'disconnect',
      args: [],
    });
    await request;

    expect(rejection).toMatchObject({ name: 'IPCTransportClosedError' });
    expect(bridge.removeAllListeners).toHaveBeenCalledTimes(1);
  });

  it('rejects a synchronous bridge send failure', async () => {
    const { bridge, send } = createBridge();
    const ipc = await loadRendererIPC(bridge);
    const sendError = new Error('renderer send failed');
    send.mockImplementationOnce(() => {
      throw sendError;
    });
    const api = ipc.consumeAPI<{ ping(): Promise<void> }>(
      'RendererSendFailureTestAPI',
    );

    await expect(api.ping()).rejects.toBe(sendError);
  });
});
