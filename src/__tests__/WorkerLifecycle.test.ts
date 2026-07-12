import { runWorkerInitialization } from 'main/worker/WorkerLifecycle';

describe('runWorkerInitialization', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('sends ready only after every initialization step has completed', async () => {
    let finishInitialization = (): void => {};
    const initialize = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishInitialization = resolve;
        }),
    );
    const send = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();

    const result = runWorkerInitialization(initialize, send, exit);
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();

    finishInitialization();
    await result;

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ control: 'worker-ready' });
    expect(exit).not.toHaveBeenCalled();
  });

  it('sends a serialized initialization error before exiting nonzero', async () => {
    const initializationError = new Error('CascLib failed');
    initializationError.name = 'CascLibInitializationError';
    initializationError.stack = 'worker initialization stack';
    const send = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();

    await runWorkerInitialization(
      async () => {
        throw initializationError;
      },
      send,
      exit,
    );

    expect(send).toHaveBeenCalledWith({
      control: 'worker-init-failed',
      error: {
        name: 'CascLibInitializationError',
        message: 'CascLib failed',
        stack: 'worker initialization stack',
      },
    });
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(
      exit.mock.invocationCallOrder[0],
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(consoleError).toHaveBeenCalledWith(initializationError);
  });

  it('still exits when the failure control cannot be delivered', async () => {
    const send = jest.fn().mockRejectedValue(new Error('IPC disconnected'));
    const exit = jest.fn();

    await runWorkerInitialization(
      async () => {
        throw new Error('initialization failed');
      },
      send,
      exit,
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
