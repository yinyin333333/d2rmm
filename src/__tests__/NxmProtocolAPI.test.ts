const mockAppOn = jest.fn();
const mockEventSend = jest.fn();
const mockProvideAPI = jest.fn();

jest.mock('electron', () => ({
  app: {
    isDefaultProtocolClient: jest.fn(),
    on: mockAppOn,
    removeAsDefaultProtocolClient: jest.fn(),
    setAsDefaultProtocolClient: jest.fn(),
  },
}));

jest.mock('../main/EventAPI', () => ({
  EventAPI: { send: mockEventSend },
}));

jest.mock('../main/IPC', () => ({
  provideAPI: mockProvideAPI,
}));

describe('NxmProtocolAPI', () => {
  beforeEach(() => {
    jest.resetModules();
    mockAppOn.mockReset();
    mockEventSend.mockReset();
    mockProvideAPI.mockReset();
    mockEventSend.mockResolvedValue(undefined);
  });

  it('ignores mod URLs with a non-numeric file ID', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    mockAppOn.mockImplementation((event, handler) => {
      handlers.set(event, handler);
    });
    const { initNxmProtocolAPI } = await import('../main/NxmProtocolAPI');
    await initNxmProtocolAPI();

    handlers.get('second-instance')?.(
      {},
      ['D2RMM.exe', 'nxm://diablo2resurrected/mods/123/files/not-a-number'],
      '',
    );

    expect(mockEventSend).not.toHaveBeenCalled();
  });

  it('publishes a valid mod download URL', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    mockAppOn.mockImplementation((event, handler) => {
      handlers.set(event, handler);
    });
    const { initNxmProtocolAPI } = await import('../main/NxmProtocolAPI');
    await initNxmProtocolAPI();

    handlers.get('second-instance')?.(
      {},
      [
        'D2RMM.exe',
        'nxm://diablo2resurrected/mods/123/files/456?key=download&expires=789',
      ],
      '',
    );

    expect(mockEventSend).toHaveBeenCalledWith('nexus-mods-open-url', {
      nexusModID: '123',
      nexusFileID: 456,
      key: 'download',
      expires: 789,
    });
  });

  it('ignores malformed URLs and unrelated path shapes', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    mockAppOn.mockImplementation((event, handler) => {
      handlers.set(event, handler);
    });
    const { initNxmProtocolAPI } = await import('../main/NxmProtocolAPI');
    await initNxmProtocolAPI();
    const handler = handlers.get('second-instance');

    expect(() => handler?.({}, ['D2RMM.exe', 'nxm://%'], '')).not.toThrow();
    handler?.(
      {},
      ['D2RMM.exe', 'nxm://diablo2resurrected/mods/123/not-files/456'],
      '',
    );

    expect(mockEventSend).not.toHaveBeenCalled();
  });

  it('registers protocol listeners only once across window recreation', async () => {
    const { initNxmProtocolAPI } = await import('../main/NxmProtocolAPI');

    await initNxmProtocolAPI();
    await initNxmProtocolAPI();

    expect(mockAppOn).toHaveBeenCalledTimes(2);
    expect(mockAppOn).toHaveBeenCalledWith('open-url', expect.any(Function));
    expect(mockAppOn).toHaveBeenCalledWith(
      'second-instance',
      expect.any(Function),
    );
  });
});
