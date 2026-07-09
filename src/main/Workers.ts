import { ChildProcess, fork } from 'child_process';
import { app } from 'electron';
import path from 'path';
import { tl } from '../shared/i18n';
import { registerWorker, unregisterWorker } from './IPC';

const workers: Set<ChildProcess> = new Set();

export function getWorkers(): Set<ChildProcess> {
  return new Set(workers);
}

export async function spawnNewWorker(): Promise<void> {
  if (workers.size > 0) {
    return;
  }

  return new Promise((resolve, reject) => {
    let hasSpawned = false;
    let hasSettled = false;
    const rejectSpawn = (error: Error): void => {
      if (hasSettled) {
        return;
      }
      hasSettled = true;
      reject(error);
    };

    try {
      const worker = !app.isPackaged
        ? fork('./src/main/worker/worker.ts', [], {
            execArgv: ['-r', 'ts-node/register/transpile-only'],
          })
        : fork(path.join(__dirname, 'worker.js'));

      worker.on('error', (error) => {
        console.error(tl('main.worker.error'), error);
        if (!hasSpawned) {
          rejectSpawn(error);
        }
      });

      worker.on('spawn', () => {
        if (hasSettled) {
          return;
        }
        hasSpawned = true;
        workers.add(worker);
        registerWorker(worker);
        hasSettled = true;
        resolve();
      });

      worker.on('exit', (code, sign) => {
        console.error(
          tl('main.worker.catastrophicFailure', {
            code: code ?? 'null',
            signal: sign ?? 'null',
          }),
        );
        unregisterWorker(worker);
        workers.delete(worker);
        if (!hasSpawned) {
          rejectSpawn(
            new Error(
              `Worker exited before spawning (code: ${code ?? 'null'}, signal: ${sign ?? 'null'}).`,
            ),
          );
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}
