import { spawn } from 'child_process';
import type { EventEmitter } from 'events';
import path from 'path';

type SpawnedProcess = Pick<EventEmitter, 'on' | 'once' | 'removeListener'> & {
  unref: () => void;
};

export type DetachedSpawnOptions = {
  cwd: string;
  detached: true;
  stdio: 'ignore';
};

export type SpawnProcess = (
  executablePath: string,
  args: string[],
  options: DetachedSpawnOptions,
) => SpawnedProcess;

const spawnProcessDefault: SpawnProcess = (executablePath, args, options) =>
  spawn(executablePath, args, options);

const consumeLateError = (_error: Error): void => undefined;

export async function launchDetachedProcess(
  executablePath: string,
  args: string[] = [],
  spawnProcess: SpawnProcess = spawnProcessDefault,
): Promise<number> {
  const child = spawnProcess(executablePath, args, {
    cwd: path.dirname(executablePath),
    detached: true,
    stdio: 'ignore',
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      child.removeListener('spawn', onSpawn);
      child.on('error', consumeLateError);
      reject(error);
    };
    const onSpawn = (): void => {
      child.removeListener('error', onError);
      child.on('error', consumeLateError);
      try {
        child.unref();
      } catch {
        // The process has already spawned. A failed unref only affects whether
        // this worker keeps the event loop alive, not whether launch succeeded.
      }
      resolve();
    };

    child.once('error', onError);
    child.once('spawn', onSpawn);
  });

  return 0;
}
