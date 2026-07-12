import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

const mockFork = jest.fn();
const mockMarkWorkerReady = jest.fn();
const mockRegisterWorker = jest.fn();
const mockUnregisterWorker = jest.fn();

jest.mock('child_process', () => ({
  fork: (...args: unknown[]) => mockFork(...args),
}));

jest.mock('electron', () => ({
  app: { isPackaged: false },
}));

jest.mock('main/IPC', () => ({
  markWorkerReady: (...args: unknown[]) => mockMarkWorkerReady(...args),
  registerWorker: (...args: unknown[]) => mockRegisterWorker(...args),
  unregisterWorker: (...args: unknown[]) => mockUnregisterWorker(...args),
}));

class FakeChildProcess extends EventEmitter {
  connected = true;

  kill = jest.fn(() => true);
}

function asChildProcess(worker: FakeChildProcess): ChildProcess {
  return worker as unknown as ChildProcess;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('spawnNewWorker', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    jest.useRealTimers();
  });

  it('tracks the child on OS spawn but resolves only after worker-ready', async () => {
    const worker = new FakeChildProcess();
    mockFork.mockReturnValue(asChildProcess(worker));

    const result = spawnNewWorker({ readyTimeoutMs: 1_000 });
    let resolved = false;
    void result.then(() => {
      resolved = true;
    });

    worker.emit('spawn');
    await flushPromises();

    expect(resolved).toBe(false);
    expect(getWorkers()).toContain(asChildProcess(worker));
    expect(mockRegisterWorker).toHaveBeenCalledTimes(1);
    expect(mockRegisterWorker).toHaveBeenCalledWith(asChildProcess(worker));
    expect(mockMarkWorkerReady).not.toHaveBeenCalled();

    worker.emit('message', { control: 'worker-ready' });
    await expect(result).resolves.toBeUndefined();

    expect(mockMarkWorkerReady).toHaveBeenCalledTimes(1);
    expect(mockMarkWorkerReady).toHaveBeenCalledWith(asChildProcess(worker));

    worker.emit('exit', 0, null);
    expect(getWorkers()).not.toContain(asChildProcess(worker));
  });

  it('rejects an explicit initialization failure once and cleans the child', async () => {
    const worker = new FakeChildProcess();
    mockFork.mockReturnValue(asChildProcess(worker));
    const result = spawnNewWorker({ readyTimeoutMs: 1_000 });

    worker.emit('spawn');
    worker.emit('message', {
      control: 'worker-init-failed',
      error: {
        name: 'WorkerInitError',
        message: 'QuickJS failed to initialize',
        stack: 'worker stack',
      },
    });

    await expect(result).rejects.toMatchObject({
      name: 'WorkerInitError',
      message: 'QuickJS failed to initialize',
      stack: 'worker stack',
    });
    expect(worker.kill).toHaveBeenCalledTimes(1);
    expect(mockUnregisterWorker).toHaveBeenCalledTimes(1);
    expect(getWorkers()).not.toContain(asChildProcess(worker));

    worker.emit('exit', 1, null);
    expect(mockUnregisterWorker).toHaveBeenCalledTimes(1);
  });

  it.each(['error', 'exit', 'disconnect'] as const)(
    'rejects when %s happens after spawn but before ready',
    async (eventName) => {
      const worker = new FakeChildProcess();
      mockFork.mockReturnValue(asChildProcess(worker));
      const result = spawnNewWorker({ readyTimeoutMs: 1_000 });

      worker.emit('spawn');
      if (eventName === 'error') {
        worker.emit('error', new Error('worker transport error'));
      } else if (eventName === 'exit') {
        worker.emit('exit', 1, null);
      } else {
        worker.connected = false;
        worker.emit('disconnect');
      }

      await expect(result).rejects.toBeInstanceOf(Error);
      expect(mockUnregisterWorker).toHaveBeenCalledTimes(1);
      expect(getWorkers()).not.toContain(asChildProcess(worker));
    },
  );

  it('rejects and kills an initializing worker at the ready timeout', async () => {
    jest.useFakeTimers();
    const worker = new FakeChildProcess();
    mockFork.mockReturnValue(asChildProcess(worker));
    const result = spawnNewWorker({ readyTimeoutMs: 1_000 });

    worker.emit('spawn');
    jest.advanceTimersByTime(1_000);

    await expect(result).rejects.toThrow('timed out');
    expect(worker.kill).toHaveBeenCalledTimes(1);
    expect(mockUnregisterWorker).toHaveBeenCalledTimes(1);
    expect(getWorkers()).not.toContain(asChildProcess(worker));
  });
});

// Import after the mocks so the module uses the fake process and IPC transports.
import { getWorkers, spawnNewWorker } from 'main/Workers';
