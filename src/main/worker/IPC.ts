import type {
  AsAsyncSerializableAPI,
  AsyncSerializableAPI,
} from 'bridge/API';
import type {
  IPCMessage,
  IPCMessageRequest,
  IPCMessageResponse,
  IPCMessageSuccessResponse,
} from 'bridge/IPC';
import type { SerializableType } from 'bridge/Serializable';
import {
  createIPCErrorResponse,
  createTransportClosedError,
  createUnknownMethodError,
  deserializeIPCError,
  getOwnCallableAPIHandler,
  invokeIPCHandler,
} from '../../shared/IPC';
import { PendingRequestRegistry } from '../../shared/PendingRequestRegistry';

type ProvidedAPI = {
  api: AsyncSerializableAPI<unknown>;
  broadcast: boolean;
};

type IPCResult = IPCMessageSuccessResponse['result'];

export type WorkerConsumeAPIOptions = {
  timeoutMs?: number;
};

const REGISTERED_APIS = new Map<string, ProvidedAPI>();
const PENDING_REQUESTS = new PendingRequestRegistry<'main', IPCResult>();

let REQUEST_COUNT = 0;

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
      handler: NonNullable<
        ReturnType<typeof getOwnCallableAPIHandler>
      >;
    }
  | undefined {
  const provided = REGISTERED_APIS.get(message.namespace);
  const handler = getOwnCallableAPIHandler(provided?.api, message.api);
  return handler == null
    ? undefined
    : { broadcast: provided?.broadcast ?? false, handler };
}

function sendToMain(message: IPCMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.send == null || process.connected === false) {
      reject(createTransportClosedError('Main IPC transport is closed.'));
      return;
    }
    try {
      process.send(message, (error) => {
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

function settlePendingResponse(message: IPCMessageResponse): boolean {
  return message.error != null
    ? PENDING_REQUESTS.reject(message.id, deserializeIPCError(message.error))
    : PENDING_REQUESTS.resolve(message.id, message.result);
}

function handleRequest(message: IPCMessageRequest): void {
  const provided = getProvidedAPI(message);
  if (provided == null) {
    void sendToMain(
      createIPCErrorResponse(
        message.id,
        createUnknownMethodError(message.namespace, message.api),
      ),
    ).catch(console.error);
    return;
  }

  void invokeIPCHandler(provided.handler, message.args)
    .then((result) => {
      if (!provided.broadcast) {
        return sendToMain({ id: message.id, result });
      }
      return undefined;
    })
    .catch((error) => {
      if (provided.broadcast) {
        console.error(error);
      } else {
        void sendToMain(createIPCErrorResponse(message.id, error)).catch(
          console.error,
        );
      }
    });
}

const messageListener = (message: IPCMessage): void => {
  if (message.args != null) {
    handleRequest(message);
  } else {
    settlePendingResponse(message);
  }
};

const disconnectListener = (): void => {
  PENDING_REQUESTS.rejectAll(
    createTransportClosedError('Main IPC transport is closed.'),
  );
};

export async function initIPC(): Promise<void> {
  process.on('message', messageListener);
  process.on('disconnect', disconnectListener);
}

export function consumeAPI<T, TLocalAPI extends object = Record<string, never>>(
  namespace: string,
  localAPI: TLocalAPI = {} as TLocalAPI,
  broadcast: boolean = false,
  options: WorkerConsumeAPIOptions = {},
): TLocalAPI & T {
  return new Proxy(localAPI, {
    get: (target, api) => {
      if (Object.prototype.hasOwnProperty.call(target, api)) {
        return target[api as keyof typeof target];
      }
      return (...args: SerializableType[]) => {
        const id = `worker:${REQUEST_COUNT++}`;
        const request: IPCMessageRequest = {
          id,
          namespace,
          api: String(api),
          args,
        };
        if (broadcast) {
          return sendToMain(request);
        }

        return new Promise<IPCResult>((resolve, reject) => {
          PENDING_REQUESTS.add({
            destination: 'main',
            id,
            reject,
            resolve,
            timeoutMs: options.timeoutMs,
          });
          void sendToMain(request).catch((error) => {
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
