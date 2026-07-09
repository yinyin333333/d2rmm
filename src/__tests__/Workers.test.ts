import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

const mockFork = jest.fn();
const mockRegisterWorker = jest.fn();
const mockUnregisterWorker = jest.fn();

jest.mock('electron', () => ({
  app: { isPackaged: false },
}));

jest.mock('child_process', () => ({
  fork: mockFork,
}));

jest.mock('../main/IPC', () => ({
  registerWorker: mockRegisterWorker,
  unregisterWorker: mockUnregisterWorker,
}));

function createWorker(): ChildProcess {
  return new EventEmitter() as ChildProcess;
}

describe('worker lifecycle', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.resetModules();
    mockFork.mockReset();
    mockRegisterWorker.mockReset();
    mockUnregisterWorker.mockReset();
  });

  it('tracks a spawned worker until it exits', async () => {
    jest.spyOn(console, 'error').mockImplementation();
    const worker = createWorker();
    mockFork.mockReturnValue(worker);
    const { getWorkers, spawnNewWorker } = await import('../main/Workers');

    const spawn = spawnNewWorker();
    worker.emit('spawn');
    await spawn;

    expect(getWorkers()).toEqual(new Set([worker]));
    expect(mockRegisterWorker).toHaveBeenCalledWith(worker);

    worker.emit('exit', 0, null);

    expect(getWorkers()).toEqual(new Set());
    expect(mockUnregisterWorker).toHaveBeenCalledWith(worker);
  });

  it('rejects when the worker cannot start', async () => {
    jest.spyOn(console, 'error').mockImplementation();
    const worker = createWorker();
    const error = new Error('Unable to start worker');
    mockFork.mockReturnValue(worker);
    const { getWorkers, spawnNewWorker } = await import('../main/Workers');

    const spawn = spawnNewWorker();
    worker.emit('error', error);

    await expect(spawn).rejects.toThrow(error);
    expect(getWorkers()).toEqual(new Set());
    expect(mockRegisterWorker).not.toHaveBeenCalled();
  });

  it('reuses the active worker when the application window is recreated', async () => {
    const worker = createWorker();
    mockFork.mockReturnValue(worker);
    const { spawnNewWorker } = await import('../main/Workers');

    const firstSpawn = spawnNewWorker();
    worker.emit('spawn');
    await firstSpawn;
    await spawnNewWorker();

    expect(mockFork).toHaveBeenCalledTimes(1);
    expect(mockRegisterWorker).toHaveBeenCalledTimes(1);
  });
});
