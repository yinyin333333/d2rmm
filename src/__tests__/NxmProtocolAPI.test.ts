import { app } from 'electron';
import { EventEmitter } from 'events';
import { EventAPI } from '../main/EventAPI';
import { provideAPI } from '../main/IPC';
import {
  captureNxmProtocolEvents,
  initNxmProtocolAPI,
} from '../main/NxmProtocolAPI';

jest.mock('electron', () => {
  const { EventEmitter: MockEventEmitter } = jest.requireActual('events');
  return {
    app: Object.assign(new MockEventEmitter(), {
      isDefaultProtocolClient: jest.fn().mockReturnValue(false),
      removeAsDefaultProtocolClient: jest.fn().mockReturnValue(true),
      setAsDefaultProtocolClient: jest.fn().mockReturnValue(true),
    }),
  };
});
jest.mock('../main/EventAPI', () => ({
  EventAPI: { send: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../main/IPC', () => ({
  provideAPI: jest.fn(),
}));

const mockApp = app as unknown as EventEmitter;
const mockEventSend = EventAPI.send as jest.Mock;
const mockProvideAPI = provideAPI as jest.Mock;

type ReadyAPI = {
  rendererReady: () => Promise<void>;
};

function emitOpenUrl(url: string): jest.Mock {
  const preventDefault = jest.fn();
  mockApp.emit('open-url', { preventDefault }, url);
  return preventDefault;
}

function providedAPI(): ReadyAPI {
  return mockProvideAPI.mock.calls.find(
    ([name]) => name === 'NxmProtocolAPI',
  )?.[1] as ReadyAPI;
}

describe('NXM protocol input validation and delivery readiness', () => {
  it('captures cold and early URLs, then drains each delivery exactly once', async () => {
    mockApp.removeAllListeners();
    mockEventSend.mockClear();
    mockProvideAPI.mockClear();
    const coldUrl = 'nxm://diablo2resurrected/mods/10/files/20';
    const earlyOpenUrl =
      'nxm://diablo2resurrected/mods/30/files/40?key=token&expires=789';
    const earlySecondInstanceUrl =
      'nxm://diablo2resurrected/collections/example/revisions/5';

    captureNxmProtocolEvents(['electron', 'app.js', coldUrl]);
    expect(mockApp.listenerCount('open-url')).toBe(1);
    expect(mockApp.listenerCount('second-instance')).toBe(1);

    const malformedPreventDefault = jest.fn();
    expect(() =>
      mockApp.emit(
        'open-url',
        { preventDefault: malformedPreventDefault },
        'nxm://[',
      ),
    ).not.toThrow();
    expect(malformedPreventDefault).not.toHaveBeenCalled();

    const invalidPreventDefault = emitOpenUrl(
      'nxm://diablo2resurrected/mods/1/files/123junk',
    );
    expect(invalidPreventDefault).not.toHaveBeenCalled();

    const validPreventDefault = emitOpenUrl(earlyOpenUrl);
    mockApp.emit(
      'second-instance',
      {},
      ['electron', 'app.js', earlySecondInstanceUrl],
      'C:\\fake-working-directory',
    );
    expect(validPreventDefault).toHaveBeenCalledTimes(1);
    expect(mockEventSend).not.toHaveBeenCalled();

    await initNxmProtocolAPI();
    expect(mockApp.listenerCount('open-url')).toBe(1);
    expect(mockApp.listenerCount('second-instance')).toBe(1);
    expect(mockEventSend).not.toHaveBeenCalled();

    expect(providedAPI().rendererReady).toEqual(expect.any(Function));
    await providedAPI().rendererReady();
    expect(mockEventSend.mock.calls).toEqual([
      [
        'nexus-mods-open-url',
        {
          expires: null,
          key: null,
          nexusFileID: 20,
          nexusModID: '10',
        },
      ],
      [
        'nexus-mods-open-url',
        {
          expires: 789,
          key: 'token',
          nexusFileID: 40,
          nexusModID: '30',
        },
      ],
      [
        'nexus-mods-open-collection-url',
        { collectionSlug: 'example', revisionNumber: 5 },
      ],
    ]);

    await providedAPI().rendererReady();
    expect(mockEventSend).toHaveBeenCalledTimes(3);

    captureNxmProtocolEvents(['electron', 'app.js', coldUrl]);
    expect(mockApp.listenerCount('open-url')).toBe(1);
    expect(mockApp.listenerCount('second-instance')).toBe(1);
    expect(mockEventSend).toHaveBeenCalledTimes(3);

    emitOpenUrl('nxm://diablo2resurrected/mods/50/files/60');
    expect(mockEventSend).toHaveBeenCalledTimes(4);
    expect(mockEventSend).toHaveBeenLastCalledWith('nexus-mods-open-url', {
      expires: null,
      key: null,
      nexusFileID: 60,
      nexusModID: '50',
    });
  });
});
