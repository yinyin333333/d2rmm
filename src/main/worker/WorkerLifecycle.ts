import type {
  IPCSerializedError,
  WorkerLifecycleIPCMessage,
} from 'bridge/IPC';
import { isI18nError } from '../../shared/i18n';

export type SendWorkerLifecycleMessage = (
  message: WorkerLifecycleIPCMessage,
) => Promise<void>;

export function serializeWorkerInitializationError(
  error: unknown,
): IPCSerializedError {
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

export async function runWorkerInitialization(
  initialize: () => Promise<void>,
  send: SendWorkerLifecycleMessage,
  exit: (code: number) => void,
): Promise<void> {
  try {
    await initialize();
    await send({ control: 'worker-ready' });
  } catch (error) {
    console.error(error);
    try {
      await send({
        control: 'worker-init-failed',
        error: serializeWorkerInitializationError(error),
      });
    } catch (sendError) {
      console.error(sendError);
    }
    exit(1);
  }
}
