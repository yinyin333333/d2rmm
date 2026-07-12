import type {
  AnyAsyncSerializableAPIMethod,
  AsyncSerializableAPI,
} from 'bridge/API';
import type {
  IPCMessageErrorResponse,
  IPCSerializedError,
} from 'bridge/IPC';
import type { SerializableType } from 'bridge/Serializable';
import { isI18nError } from './i18n';

export function createNamedIPCError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

export function createUnknownMethodError(
  namespace: string,
  api: string,
): Error {
  return createNamedIPCError(
    'IPCUnknownMethodError',
    `Unknown IPC method "${namespace}.${api}".`,
  );
}

export function createTransportClosedError(message: string): Error {
  return createNamedIPCError('IPCTransportClosedError', message);
}

export function serializeIPCError(error: unknown): IPCSerializedError {
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));
  return {
    name: normalizedError.name,
    message: normalizedError.message,
    stack: normalizedError.stack,
    ...(isI18nError(normalizedError) && {
      __d2rmm_i18n_list: normalizedError.__d2rmm_i18n_list,
    }),
  };
}

export function deserializeIPCError(serialized: IPCSerializedError): Error {
  const error = createNamedIPCError(serialized.name, serialized.message);
  error.stack = serialized.stack;
  if (serialized.__d2rmm_i18n_list != null) {
    (
      error as Error & {
        __d2rmm_i18n_list: typeof serialized.__d2rmm_i18n_list;
      }
    ).__d2rmm_i18n_list = serialized.__d2rmm_i18n_list;
  }
  return error;
}

export function createIPCErrorResponse(
  id: string,
  error: unknown,
): IPCMessageErrorResponse {
  return { id, error: serializeIPCError(error) };
}

export function getOwnCallableAPIHandler(
  api: AsyncSerializableAPI<unknown> | undefined,
  method: string,
): AnyAsyncSerializableAPIMethod | null {
  if (api == null || !Object.prototype.hasOwnProperty.call(api, method)) {
    return null;
  }
  const handler = (api as unknown as Record<string, unknown>)[method];
  return typeof handler === 'function'
    ? (handler as AnyAsyncSerializableAPIMethod)
    : null;
}

export async function invokeIPCHandler(
  handler: AnyAsyncSerializableAPIMethod,
  args: SerializableType[],
): Promise<void | SerializableType | SerializableType[]> {
  return handler(...args);
}
