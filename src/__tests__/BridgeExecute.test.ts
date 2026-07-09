import { EventEmitter } from 'events';
import { BridgeAPI } from '../main/worker/BridgeAPI';

const mockSpawn = jest.fn();

jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));
jest.mock('../main/worker/IPC', () => ({
  consumeAPI: (_name: string, localAPI: unknown = {}) => localAPI,
  provideAPI: jest.fn(),
}));
jest.mock('../main/worker/CascLib', () => ({
  CASC_ERROR_FILE_OFFLINE: 0,
  CASC_FEATURE_ALLOW_DOWNLOAD: 0,
  getCascLib: jest.fn(),
  getLastCascLibError: jest.fn(),
  makeCascOpenStorageArgs: jest.fn(),
  readCString: jest.fn(),
}));
jest.mock('../main/worker/third-party/d2s/index', () => ({}));

function createChild(): EventEmitter & { unref: jest.Mock } {
  return Object.assign(new EventEmitter(), { unref: jest.fn() });
}

describe('BridgeAPI.execute', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('rejects when the executable cannot be started', async () => {
    const child = createChild();
    mockSpawn.mockReturnValue(child);

    const result = BridgeAPI.execute('missing.exe');
    child.emit('error', new Error('not found'));

    await expect(result).rejects.toThrow('not found');
    expect(child.unref).not.toHaveBeenCalled();
  });

  it('resolves only after the child has started', async () => {
    const child = createChild();
    mockSpawn.mockReturnValue(child);

    const result = BridgeAPI.execute('game.exe');
    child.emit('spawn');

    await expect(result).resolves.toBe(0);
    expect(child.unref).toHaveBeenCalledTimes(1);
  });
});
