import type { AsAsyncSerializableAPI, AsyncSerializableAPI } from 'bridge/API';
import type {
  IPCMessage,
  IPCMessageRequest,
  IPCMessageResponse,
  IPCMessageSuccessResponse,
  IPCTransportClosedMessage,
  RendererIPCMessage,
  WorkerIPCMessage,
} from 'bridge/IPC';
import type { SerializableType } from 'bridge/Serializable';
import { ChildProcess } from 'child_process';
import { BrowserWindow, ipcMain } from 'electron';
import {
  createIPCErrorResponse,
  createNamedIPCError,
  createTransportClosedError,
  createUnknownMethodError,
  deserializeIPCError,
  getOwnCallableAPIHandler,
  invokeIPCHandler,
  serializeIPCError,
} from '../shared/IPC';
import { PendingRequestRegistry } from '../shared/PendingRequestRegistry';

type ProvidedAPI = {
  api: AsyncSerializableAPI<unknown>;
  broadcast: boolean;
};

type Renderer = BrowserWindow['webContents'];
type MainRequestDestination = Renderer | ChildProcess;
type IPCResult = IPCMessageSuccessResponse['result'];

export type MainConsumeAPIOptions = {
  destination?: 'renderer' | 'worker';
  timeoutMs?: number;
};

type RegisteredWorker = {
  messageListener: (message: WorkerIPCMessage) => void;
  ready: boolean;
  rendererRequestIds: Set<string>;
};

const REGISTERED_APIS = new Map<string, ProvidedAPI>();
const PENDING_REQUESTS = new PendingRequestRegistry<
  MainRequestDestination,
  IPCResult
>();
const workers = new Map<ChildProcess, RegisteredWorker>();

let REQUEST_COUNT = 0;
let renderer: Renderer | null = null;
let isRendererIPCListenerRegistered = false;

export function provideAPI<T extends AsyncSerializableAPI<T>>(
  namespace: string,
  api: AsAsyncSerializableAPI<T>,
  broadcast: boolean = false,
): void {
  REGISTERED_APIS.set(namespace, { api, broadcast });
}

function getProvidedAPI(message: IPCMessageRequest):
  | {
      broadcast: boolean;
      handler: NonNullable<ReturnType<typeof getOwnCallableAPIHandler>>;
    }
  | undefined {
  const provided = REGISTERED_APIS.get(message.namespace);
  const handler = getOwnCallableAPIHandler(provided?.api, message.api);
  return handler == null
    ? undefined
    : { broadcast: provided?.broadcast ?? false, handler };
}

function forEachReadyWorker(callback: (worker: ChildProcess) => void): void {
  workers.forEach(({ ready }, worker) => {
    if (ready) {
      callback(worker);
    }
  });
}

function getReadyWorker():
  | { registration: RegisteredWorker; worker: ChildProcess }
  | undefined {
  for (const [worker, registration] of workers) {
    if (registration.ready) {
      return { registration, worker };
    }
  }
  return undefined;
}

function sendToRenderer(
  target: Renderer | null,
  message: RendererIPCMessage,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (target == null || target.isDestroyed()) {
      reject(createTransportClosedError('Renderer IPC transport is closed.'));
      return;
    }
    try {
      target.send('ipc', message);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function sendToWorker(
  worker: ChildProcess,
  message: IPCMessage,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (worker.connected === false) {
      reject(createTransportClosedError('Worker IPC transport is closed.'));
      return;
    }
    try {
      worker.send(message, (error) => {
        if (error != null) {
          reject(error);
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

function sendBroadcast(request: IPCMessageRequest): void {
  if (renderer != null && !renderer.isDestroyed()) {
    void sendToRenderer(renderer, request).catch(console.error);
  }
  forEachReadyWorker((worker) => {
    void sendToWorker(worker, request).catch(console.error);
  });
}

function settlePendingResponse(message: IPCMessageResponse): boolean {
  return message.error != null
    ? PENDING_REQUESTS.reject(message.id, deserializeIPCError(message.error))
    : PENDING_REQUESTS.resolve(message.id, message.result);
}

export function consumeAPI<T, TLocalAPI extends object = Record<string, never>>(
  namespace: string,
  localAPI: TLocalAPI = {} as TLocalAPI,
  broadcast: boolean = false,
  options: MainConsumeAPIOptions = {},
): TLocalAPI & T {
  return new Proxy(localAPI, {
    get: (target, api) => {
      if (Object.prototype.hasOwnProperty.call(target, api)) {
        return target[api as keyof typeof target];
      }
      return (...args: SerializableType[]) => {
        const id = `main:${REQUEST_COUNT++}`;
        const request: IPCMessageRequest = {
          id,
          namespace,
          api: String(api),
          args,
        };
        if (broadcast) {
          sendBroadcast(request);
          return Promise.resolve();
        }

        return new Promise<IPCResult>((resolve, reject) => {
          const destination = options.destination ?? 'renderer';
          if (destination === 'renderer') {
            const targetRenderer = renderer;
            if (targetRenderer == null || targetRenderer.isDestroyed()) {
              reject(
                createTransportClosedError('Renderer IPC transport is closed.'),
              );
              return;
            }
            PENDING_REQUESTS.add({
              destination: targetRenderer,
              id,
              reject,
              resolve,
              timeoutMs: options.timeoutMs,
            });
            void sendToRenderer(targetRenderer, request).catch((error) => {
              PENDING_REQUESTS.reject(
                id,
                error instanceof Error ? error : new Error(String(error)),
              );
            });
            return;
          }

          const readyWorker = getReadyWorker();
          if (readyWorker == null) {
            reject(
              createNamedIPCError(
                'WorkerNotReadyError',
                'No ready worker is available.',
              ),
            );
            return;
          }
          PENDING_REQUESTS.add({
            destination: readyWorker.worker,
            id,
            reject,
            resolve,
            timeoutMs: options.timeoutMs,
          });
          void sendToWorker(readyWorker.worker, request).catch((error) => {
            PENDING_REQUESTS.reject(
              id,
              error instanceof Error ? error : new Error(String(error)),
            );
          });
        });
      };
    },
  }) as TLocalAPI & T;
}

export function unregisterWorker(
  worker: ChildProcess,
  reason: Error = createTransportClosedError('Worker IPC transport is closed.'),
): void {
  const registration = workers.get(worker);
  if (registration == null) {
    return;
  }
  worker.off('message', registration.messageListener);
  workers.delete(worker);
  PENDING_REQUESTS.rejectDestination(worker, reason);

  const requestIds = Array.from(registration.rendererRequestIds);
  registration.rendererRequestIds.clear();
  if (requestIds.length > 0 && renderer != null && !renderer.isDestroyed()) {
    const message: IPCTransportClosedMessage = {
      control: 'transport-closed',
      destination: 'worker',
      error: serializeIPCError(reason),
      requestIds,
    };
    void sendToRenderer(renderer, message).catch(console.error);
  }
}

export function markWorkerReady(worker: ChildProcess): void {
  const registration = workers.get(worker);
  if (registration == null) {
    throw new Error('Cannot mark an unregistered worker as ready.');
  }
  registration.ready = true;
}

function respondToWorker(worker: ChildProcess, message: IPCMessage): void {
  void sendToWorker(worker, message).catch(console.error);
}

function respondToRenderer(
  message: RendererIPCMessage,
  targetRenderer: Renderer | null = renderer,
): void {
  if (targetRenderer !== renderer) return;
  void sendToRenderer(targetRenderer, message).catch(console.error);
}

function handleWorkerRequest(
  worker: ChildProcess,
  message: IPCMessageRequest,
): void {
  const provided = getProvidedAPI(message);
  if (provided == null) {
    respondToWorker(
      worker,
      createIPCErrorResponse(
        message.id,
        createUnknownMethodError(message.namespace, message.api),
      ),
    );
    return;
  }

  void invokeIPCHandler(provided.handler, message.args)
    .then((result) => {
      if (!provided.broadcast) {
        respondToWorker(worker, { id: message.id, result });
      }
    })
    .catch((error) => {
      if (provided.broadcast) {
        console.error(error);
      } else {
        respondToWorker(worker, createIPCErrorResponse(message.id, error));
      }
    });

  if (provided.broadcast) {
    if (renderer != null && !renderer.isDestroyed()) {
      void sendToRenderer(renderer, message).catch(console.error);
    }
    forEachReadyWorker((otherWorker) => {
      if (otherWorker !== worker) {
        void sendToWorker(otherWorker, message).catch(console.error);
      }
    });
  }
}

function handleWorkerResponse(
  registration: RegisteredWorker,
  message: IPCMessageResponse,
): void {
  if (settlePendingResponse(message)) {
    return;
  }
  if (!registration.rendererRequestIds.delete(message.id)) {
    return;
  }
  respondToRenderer(message);
}

export function registerWorker(worker: ChildProcess): void {
  const registration: RegisteredWorker = {
    messageListener: () => {},
    ready: false,
    rendererRequestIds: new Set(),
  };
  const messageListener = (message: WorkerIPCMessage): void => {
    if ('control' in message) {
      return;
    }
    if (message.args != null) {
      handleWorkerRequest(worker, message);
    } else {
      handleWorkerResponse(registration, message);
    }
  };
  registration.messageListener = messageListener;
  workers.set(worker, registration);
  worker.on('message', messageListener);
}

function handleRendererRequest(
  message: IPCMessageRequest,
  targetRenderer: Renderer | null,
): void {
  const provided = getProvidedAPI(message);
  if (provided != null) {
    void invokeIPCHandler(provided.handler, message.args)
      .then((result) => {
        if (!provided.broadcast) {
          respondToRenderer({ id: message.id, result }, targetRenderer);
        }
      })
      .catch((error) => {
        if (provided.broadcast) {
          console.error(error);
        } else {
          respondToRenderer(
            createIPCErrorResponse(message.id, error),
            targetRenderer,
          );
        }
      });
    if (provided.broadcast) {
      forEachReadyWorker((worker) => {
        void sendToWorker(worker, message).catch(console.error);
      });
    }
    return;
  }

  const readyWorker = getReadyWorker();
  if (readyWorker == null) {
    respondToRenderer(
      createIPCErrorResponse(
        message.id,
        createNamedIPCError(
          'WorkerNotReadyError',
          'No ready worker is available.',
        ),
      ),
      targetRenderer,
    );
    return;
  }

  readyWorker.registration.rendererRequestIds.add(message.id);
  void sendToWorker(readyWorker.worker, message).catch((error) => {
    if (!readyWorker.registration.rendererRequestIds.delete(message.id)) {
      return;
    }
    respondToRenderer(
      createIPCErrorResponse(message.id, error),
      targetRenderer,
    );
  });
}

function handleRendererDestroyed(target: Renderer): void {
  const error = createTransportClosedError('Renderer IPC transport is closed.');
  PENDING_REQUESTS.rejectDestination(target, error);
  if (renderer !== target) return;
  workers.forEach((registration) => registration.rendererRequestIds.clear());
  renderer = null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasMessageID(
  message: unknown,
): message is Record<string, unknown> & { id: string } {
  return (
    isRecord(message) && typeof message.id === 'string' && message.id.length > 0
  );
}

function isSerializedIPCError(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.message === 'string' &&
    (value.stack == null || typeof value.stack === 'string') &&
    (value.__d2rmm_i18n_list == null || Array.isArray(value.__d2rmm_i18n_list))
  );
}

function isRendererIPCRequest(
  message: Record<string, unknown> & { id: string },
): boolean {
  return (
    typeof message.namespace === 'string' &&
    message.namespace.length > 0 &&
    typeof message.api === 'string' &&
    message.api.length > 0 &&
    Array.isArray(message.args) &&
    !hasOwn(message, 'result') &&
    !hasOwn(message, 'error') &&
    !hasOwn(message, 'control')
  );
}

function isRendererIPCResponse(
  message: Record<string, unknown> & { id: string },
): boolean {
  if (
    hasOwn(message, 'namespace') ||
    hasOwn(message, 'api') ||
    hasOwn(message, 'args') ||
    hasOwn(message, 'control')
  ) {
    return false;
  }
  const hasResult = hasOwn(message, 'result');
  const hasError = hasOwn(message, 'error');
  return (
    hasResult !== hasError && (!hasError || isSerializedIPCError(message.error))
  );
}

function isRendererIPCMessage(message: unknown): message is IPCMessage {
  if (!hasMessageID(message)) return false;
  return isRendererIPCRequest(message) || isRendererIPCResponse(message);
}

function handleRendererIPCMessage(
  event: Electron.IpcMainEvent,
  message: unknown,
): void {
  const targetRenderer = renderer;
  if (
    targetRenderer == null ||
    event.sender !== targetRenderer ||
    event.senderFrame !== targetRenderer.mainFrame
  ) {
    return;
  }
  if (!isRendererIPCMessage(message)) {
    if (hasMessageID(message)) {
      respondToRenderer(
        createIPCErrorResponse(
          message.id,
          createNamedIPCError(
            'IPCMalformedMessageError',
            'Malformed renderer IPC message.',
          ),
        ),
        targetRenderer,
      );
    }
    return;
  }
  if (message.args != null) {
    handleRendererRequest(message, targetRenderer);
  } else {
    settlePendingResponse(message);
  }
}

export async function initIPC(mainWindow: BrowserWindow): Promise<void> {
  const targetRenderer = mainWindow.webContents;
  if (renderer !== targetRenderer) {
    if (renderer != null) handleRendererDestroyed(renderer);
    renderer = targetRenderer;
    const rendererWithOnce = targetRenderer as Renderer & {
      once?: (event: 'destroyed', listener: () => void) => void;
    };
    rendererWithOnce.once?.('destroyed', () =>
      handleRendererDestroyed(targetRenderer),
    );
  }

  if (!isRendererIPCListenerRegistered) {
    ipcMain.on('ipc', handleRendererIPCMessage);
    isRendererIPCListenerRegistered = true;
  }
}
