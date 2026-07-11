import { PendingRequestRegistry } from 'shared/PendingRequestRegistry';

describe('PendingRequestRegistry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('settles each request once and clears its timeout', () => {
    const registry = new PendingRequestRegistry<'main' | 'worker', string>();
    const resolve = jest.fn();
    const reject = jest.fn();
    registry.add({
      destination: 'worker',
      id: 'request:1',
      reject,
      resolve,
      timeoutMs: 1_000,
    });

    expect(registry.size).toBe(1);
    expect(registry.resolve('request:1', 'done')).toBe(true);
    expect(registry.resolve('request:1', 'late')).toBe(false);
    expect(registry.reject('request:1', new Error('late'))).toBe(false);
    jest.advanceTimersByTime(1_000);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('done');
    expect(reject).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  it('uses no wall-clock timeout unless one is explicitly supplied', () => {
    const registry = new PendingRequestRegistry<'main', string>();
    const reject = jest.fn();
    registry.add({
      destination: 'main',
      id: 'request:no-timeout',
      reject,
      resolve: jest.fn(),
    });

    jest.advanceTimersByTime(24 * 60 * 60 * 1_000);

    expect(reject).not.toHaveBeenCalled();
    expect(registry.size).toBe(1);
  });

  it('supports an explicit injectable timeout without leaking the request', () => {
    const registry = new PendingRequestRegistry<'main', string>();
    const reject = jest.fn();
    registry.add({
      destination: 'main',
      id: 'request:timeout',
      reject,
      resolve: jest.fn(),
      timeoutMs: 250,
    });

    jest.advanceTimersByTime(250);

    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][0]).toMatchObject({
      name: 'IPCRequestTimeoutError',
    });
    expect(registry.size).toBe(0);
  });

  it('rejects only the requested destination and can then reject all', () => {
    const registry = new PendingRequestRegistry<'main' | 'worker', string>();
    const mainReject = jest.fn();
    const workerReject = jest.fn();
    registry.add({
      destination: 'main',
      id: 'main:1',
      reject: mainReject,
      resolve: jest.fn(),
    });
    registry.add({
      destination: 'worker',
      id: 'worker:1',
      reject: workerReject,
      resolve: jest.fn(),
    });

    expect(
      registry.rejectDestination('worker', new Error('worker closed')),
    ).toBe(1);
    expect(workerReject).toHaveBeenCalledTimes(1);
    expect(mainReject).not.toHaveBeenCalled();
    expect(registry.getDestination('worker:1')).toBeUndefined();
    expect(registry.getDestination('main:1')).toBe('main');

    expect(registry.rejectAll(new Error('all closed'))).toBe(1);
    expect(mainReject).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });
});
