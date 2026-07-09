import type { IPCMessageRequest } from 'bridge/IPC';

const mockIpcMainOn = jest.fn();

jest.mock('electron', () => ({
  ipcMain: { on: mockIpcMainOn },
}));

describe('main IPC initialization', () => {
  beforeEach(() => {
    jest.resetModules();
    mockIpcMainOn.mockReset();
  });

  it('keeps one listener and sends responses to the current window', async () => {
    const firstContents = {
      isDestroyed: () => false,
      send: jest.fn(),
    };
    const secondContents = {
      isDestroyed: () => false,
      send: jest.fn(),
    };
    const { initIPC, provideAPI } = await import('../main/IPC');

    await initIPC({ webContents: firstContents } as never);
    await initIPC({ webContents: secondContents } as never);
    provideAPI('TestAPI', { ping: async () => 'pong' });

    expect(mockIpcMainOn).toHaveBeenCalledTimes(1);
    const listener = mockIpcMainOn.mock.calls[0][1] as (
      event: unknown,
      message: IPCMessageRequest,
    ) => void;
    listener(
      {},
      {
        api: 'ping',
        args: [],
        id: 'renderer:1',
        namespace: 'TestAPI',
      },
    );
    await Promise.resolve();

    expect(firstContents.send).not.toHaveBeenCalled();
    expect(secondContents.send).toHaveBeenCalledWith('ipc', {
      id: 'renderer:1',
      result: 'pong',
    });
  });
});
