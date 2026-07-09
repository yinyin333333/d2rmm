describe('renderer IPC', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('uses renderer-specific request IDs', async () => {
    const send = jest.fn();
    window.IPCBridge = {
      addListener: jest.fn(),
      removeAllListeners: jest.fn(),
      removeListener: jest.fn(),
      send,
    };
    const { consumeAPI } = await import('../renderer/IPC');
    const api = consumeAPI<{ ping: () => Promise<void> }>('TestAPI');

    void api.ping();

    expect(send).toHaveBeenCalledWith({
      api: 'ping',
      args: [],
      id: 'renderer:0',
      namespace: 'TestAPI',
    });
  });
});
