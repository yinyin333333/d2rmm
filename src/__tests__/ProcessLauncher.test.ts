import { EventEmitter } from 'events';
import path from 'path';
import type { SpawnProcess } from '../main/worker/ProcessLauncher';
import { launchDetachedProcess } from '../main/worker/ProcessLauncher';

class FakeChildProcess extends EventEmitter {
  public unref = jest.fn<void, []>();
}

describe('launchDetachedProcess', () => {
  const executablePath = path.join('fake-game', 'D2R.exe');
  const args = ['-mod', 'D2RMM', '-txt'];

  function createSpawnProcess(child: FakeChildProcess): jest.MockedFunction<SpawnProcess> {
    return jest.fn<ReturnType<SpawnProcess>, Parameters<SpawnProcess>>(
      () => child,
    );
  }

  it('waits for spawn and preserves the detached launch options', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnProcess(child);
    let settled = false;

    const pending = launchDetachedProcess(executablePath, args, spawnProcess);
    pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(child.unref).not.toHaveBeenCalled();
    expect(spawnProcess).toHaveBeenCalledWith(executablePath, args, {
      cwd: path.dirname(executablePath),
      detached: true,
      stdio: 'ignore',
    });

    child.emit('spawn');

    await expect(pending).resolves.toBe(0);
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it('rejects and consumes an asynchronous error before spawn', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnProcess(child);
    const expected = new Error('executable not found');
    const pending = launchDetachedProcess(executablePath, args, spawnProcess);

    child.emit('error', expected);

    await expect(pending).rejects.toBe(expected);
    expect(child.unref).not.toHaveBeenCalled();
    expect(() => child.emit('error', new Error('late error'))).not.toThrow();
  });

  it('rejects a synchronous spawn throw', async () => {
    const expected = new Error('synchronous spawn failure');
    const spawnProcess: SpawnProcess = () => {
      throw expected;
    };

    await expect(
      launchDetachedProcess(executablePath, args, spawnProcess),
    ).rejects.toBe(expected);
  });

  it('keeps a late error consumer after the spawn event', async () => {
    const child = new FakeChildProcess();
    const pending = launchDetachedProcess(
      executablePath,
      args,
      createSpawnProcess(child),
    );

    child.emit('spawn');
    await expect(pending).resolves.toBe(0);

    expect(child.listenerCount('error')).toBeGreaterThan(0);
    expect(() => child.emit('error', new Error('late error'))).not.toThrow();
  });

  it('does not report launch failure when unref throws after spawn', async () => {
    const child = new FakeChildProcess();
    child.unref.mockImplementation(() => {
      throw new Error('unref failed');
    });
    const pending = launchDetachedProcess(
      executablePath,
      args,
      createSpawnProcess(child),
    );

    child.emit('spawn');

    await expect(pending).resolves.toBe(0);
    expect(child.unref).toHaveBeenCalledTimes(1);
  });
});
