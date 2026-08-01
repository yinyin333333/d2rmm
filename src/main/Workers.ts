import type { IPCSerializedError, WorkerLifecycleIPCMessage } from 'bridge/IPC';
import { ChildProcess, fork } from 'child_process';
import { app } from 'electron';
import path from 'path';
import { tl } from '../shared/i18n';
import { markWorkerReady, registerWorker, unregisterWorker } from './IPC';

const workers: Set<ChildProcess> = new Set();

// Worker startup only performs local IPC/API, QuickJS WASM, and CascLib setup.
// Two minutes is deliberately a generous hang guard rather than a performance
// target; focused tests inject a short timeout instead of waiting for it.
export const DEFAULT_WORKER_READY_TIMEOUT_MS = 120_000;

export type SpawnNewWorkerOptions = {
  readyTimeoutMs?: number;
};

type WorkerPhase = 'created' | 'initializing' | 'ready' | 'failed' | 'closed';

export function getWorkers(): Set<ChildProcess> {
  return new Set(workers);
}

function isWorkerLifecycleIPCMessage(
  message: unknown,
): message is WorkerLifecycleIPCMessage {
  if (
    typeof message !== 'object' ||
    message == null ||
    !('control' in message)
  ) {
    return false;
  }
  const control = (message as { control?: unknown }).control;
  return control === 'worker-ready' || control === 'worker-init-failed';
}

function deserializeWorkerError(serialized: IPCSerializedError): Error {
  const error = new Error(serialized.message);
  error.name = serialized.name;
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

function makeWorkerExitError(
  code: number | null,
  signal: NodeJS.Signals | null,
): Error {
  return new Error(
    `Worker exited before initialization completed (code ${
      code ?? 'null'
    }, signal ${signal ?? 'null'}).`,
  );
}

export function spawnNewWorker(
  options: SpawnNewWorkerOptions = {},
): Promise<void> {
  const readyTimeoutMs =
    options.readyTimeoutMs ?? DEFAULT_WORKER_READY_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let worker: ChildProcess;
    let phase: WorkerPhase = 'created';
    let isTransportRegistered = false;
    let readyTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearReadyTimeout = (): void => {
      if (readyTimeout != null) {
        clearTimeout(readyTimeout);
        readyTimeout = null;
      }
    };

    const unregisterTransport = (): void => {
      if (isTransportRegistered) {
        isTransportRegistered = false;
        unregisterWorker(worker);
      }
    };

    const removeTerminalListeners = (): void => {
      worker.off('error', onError);
      worker.off('exit', onExit);
      worker.off('disconnect', onDisconnect);
      worker.off('message', onLifecycleMessage);
      worker.off('spawn', onSpawn);
    };

    const killWorker = (): void => {
      try {
        if (!worker.killed) {
          worker.kill();
        }
      } catch (error) {
        console.error(tl('main.worker.error'), error);
      }
    };

    const failInitialization = (error: Error, kill: boolean): void => {
      if (phase === 'ready' || phase === 'failed' || phase === 'closed') {
        return;
      }
      phase = 'failed';
      clearReadyTimeout();
      worker.off('message', onLifecycleMessage);
      worker.off('spawn', onSpawn);
      unregisterTransport();
      workers.delete(worker);
      if (kill) {
        killWorker();
      }
      reject(error);
    };

    const closeReadyWorker = (): void => {
      if (phase !== 'ready') {
        return;
      }
      phase = 'closed';
      clearReadyTimeout();
      unregisterTransport();
      workers.delete(worker);
      removeTerminalListeners();
    };

    const onLifecycleMessage = (message: unknown): void => {
      if (phase !== 'initializing' || !isWorkerLifecycleIPCMessage(message)) {
        return;
      }
      if (message.control === 'worker-init-failed') {
        failInitialization(deserializeWorkerError(message.error), true);
        return;
      }

      try {
        markWorkerReady(worker);
      } catch (error) {
        failInitialization(
          error instanceof Error ? error : new Error(String(error)),
          true,
        );
        return;
      }
      phase = 'ready';
      clearReadyTimeout();
      worker.off('message', onLifecycleMessage);
      worker.off('spawn', onSpawn);
      resolve();
    };

    const onSpawn = (): void => {
      if (phase !== 'created') {
        return;
      }
      phase = 'initializing';
      workers.add(worker);
      isTransportRegistered = true;
      try {
        // Initializing workers need this inbound transport for AppInfoAPI.
        // main/renderer outbound traffic remains blocked until markWorkerReady.
        registerWorker(worker);
      } catch (error) {
        failInitialization(
          error instanceof Error ? error : new Error(String(error)),
          true,
        );
      }
    };

    const onError = (error: Error): void => {
      if (phase === 'failed' || phase === 'closed') {
        return;
      }
      console.error(tl('main.worker.error'), error);
      if (phase !== 'ready') {
        failInitialization(error, phase === 'initializing');
      }
    };

    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (phase === 'created' || phase === 'initializing') {
        failInitialization(makeWorkerExitError(code, signal), false);
        removeTerminalListeners();
        return;
      }
      if (phase === 'ready') {
        console.error(
          tl('main.worker.catastrophicFailure', {
            code: code ?? 'null',
            signal: signal ?? 'null',
          }),
        );
        closeReadyWorker();
        return;
      }
      removeTerminalListeners();
    };

    const onDisconnect = (): void => {
      if (phase === 'created' || phase === 'initializing') {
        failInitialization(
          new Error('Worker disconnected before initialization completed.'),
          true,
        );
        return;
      }
      closeReadyWorker();
    };

    try {
      worker = !app.isPackaged
        ? fork('./src/main/worker/worker.ts', [], {
            execArgv: ['-r', 'ts-node/register/transpile-only'],
          })
        : fork(path.join(__dirname, 'worker.js'));
    } catch (error) {
      reject(error);
      return;
    }

    worker.on('error', onError);
    worker.on('exit', onExit);
    worker.on('disconnect', onDisconnect);
    worker.on('message', onLifecycleMessage);
    worker.on('spawn', onSpawn);

    readyTimeout = setTimeout(() => {
      failInitialization(
        new Error(`Worker initialization timed out after ${readyTimeoutMs}ms.`),
        true,
      );
    }, readyTimeoutMs);
  });
}
