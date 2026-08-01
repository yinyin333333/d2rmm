import type { IShellAPI } from 'bridge/ShellAPI';
import { configureWebContentsSecurity, initShellAPI } from 'main/ShellAPI';
import { EventEmitter } from 'events';

const mockOpenExternal = jest.fn();
const mockProvideAPI = jest.fn();

jest.mock('electron', () => ({
  shell: {
    openExternal: (...args: unknown[]) => mockOpenExternal(...args),
  },
}));

jest.mock('main/IPC', () => ({
  provideAPI: (...args: unknown[]) => mockProvideAPI(...args),
}));

class FakeWebContents extends EventEmitter {
  windowOpenHandler:
    | ((details: { url: string }) => { action: 'deny' | 'allow' })
    | null = null;

  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'deny' | 'allow' },
  ): void {
    this.windowOpenHandler = handler;
  }
}

function getShellAPI(): IShellAPI {
  const registration = mockProvideAPI.mock.calls.find(
    ([namespace]) => namespace === 'ShellAPI',
  );
  if (registration == null) {
    throw new Error('ShellAPI was not registered.');
  }
  return registration[1] as IShellAPI;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('external URL and navigation security', () => {
  beforeEach(async () => {
    mockOpenExternal.mockReset().mockResolvedValue(undefined);
    mockProvideAPI.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await initShellAPI();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(['http://example.com/mod', 'https://example.com/mod?file=1#details'])(
    'allows ShellAPI to open external web URL %s',
    async (url) => {
      await expect(getShellAPI().openExternal(url)).resolves.toBeUndefined();
      expect(mockOpenExternal).toHaveBeenCalledWith(url);
    },
  );

  it.each([
    'file:///C:/Users/test/secret.txt',
    'nxm://mods/123/files/456',
    'custom-handler:payload',
    'javascript:alert(1)',
    'not a URL',
    'https://',
    'http://[invalid',
  ])('rejects non-web or malformed ShellAPI URL %s', async (url) => {
    await expect(getShellAPI().openExternal(url)).rejects.toMatchObject({
      name: 'ExternalURLNotAllowedError',
    });
    expect(mockOpenExternal).not.toHaveBeenCalled();
  });

  it('opens only http/https window-open targets and always denies the Electron window', async () => {
    const webContents = new FakeWebContents();
    configureWebContentsSecurity(
      webContents as never,
      'file:///app/renderer/index.html',
    );
    const handler = webContents.windowOpenHandler;
    expect(handler).not.toBeNull();

    expect(handler?.({ url: 'https://example.com/mod' })).toEqual({
      action: 'deny',
    });
    expect(handler?.({ url: 'file:///app/renderer/other.html' })).toEqual({
      action: 'deny',
    });
    expect(handler?.({ url: 'javascript:alert(1)' })).toEqual({
      action: 'deny',
    });
    await flushPromises();

    expect(mockOpenExternal).toHaveBeenCalledTimes(1);
    expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/mod');
  });

  it('allows only the current application document in navigation and redirects', () => {
    const webContents = new FakeWebContents();
    configureWebContentsSecurity(
      webContents as never,
      'file:///app/renderer/index.html',
    );
    const navigate = (
      eventName: 'will-navigate' | 'will-redirect',
      url: string,
    ): { preventDefault: jest.Mock<void, []> } => {
      const event = { preventDefault: jest.fn<void, []>() };
      webContents.emit(eventName, event, url);
      return event;
    };

    for (const eventName of ['will-navigate', 'will-redirect'] as const) {
      expect(
        navigate(eventName, 'file:///app/renderer/index.html').preventDefault,
      ).not.toHaveBeenCalled();
      expect(
        navigate(eventName, 'file:///app/renderer/index.html#settings')
          .preventDefault,
      ).not.toHaveBeenCalled();

      for (const blockedURL of [
        'file:///app/renderer/other.html',
        'https://example.com/',
        'javascript:alert(1)',
        'not a URL',
      ]) {
        expect(
          navigate(eventName, blockedURL).preventDefault,
        ).toHaveBeenCalledTimes(1);
      }
    }
  });
});
