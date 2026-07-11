import {
  NxmProtocolQueue,
  parseNxmProtocolUrl,
} from '../main/NxmProtocolQueue';

describe('NXM protocol parser', () => {
  it('parses exact mod and collection URL shapes', () => {
    expect(
      parseNxmProtocolUrl(
        'nxm://diablo2resurrected/mods/123/files/456?key=token&expires=789',
      ),
    ).toEqual({
      eventID: 'nexus-mods-open-url',
      payload: {
        expires: 789,
        key: 'token',
        nexusFileID: 456,
        nexusModID: '123',
      },
    });
    expect(
      parseNxmProtocolUrl(
        'nxm://diablo2resurrected/collections/example-list/revisions/7',
      ),
    ).toEqual({
      eventID: 'nexus-mods-open-collection-url',
      payload: { collectionSlug: 'example-list', revisionNumber: 7 },
    });
    expect(
      parseNxmProtocolUrl(
        'nxm://diablo2resurrected/mods/9007199254740991/files/9007199254740991',
      ),
    ).toMatchObject({
      payload: {
        nexusFileID: Number.MAX_SAFE_INTEGER,
        nexusModID: String(Number.MAX_SAFE_INTEGER),
      },
    });
  });

  it.each([
    'nxm://[',
    'nxm://diablo2resurrected/mods/%/files/2',
    'nxm://diablo2resurrected/mods/%E0%A4/files/2',
    'https://diablo2resurrected/mods/1/files/2',
    'nxm://othergame/mods/1/files/2',
    'nxm://diablo2resurrected/mods/0/files/2',
    'nxm://diablo2resurrected/mods/1/files/0',
    'nxm://diablo2resurrected/mods/1/files/-2',
    'nxm://diablo2resurrected/mods/1/files/1.5',
    'nxm://diablo2resurrected/mods/1/files/NaN',
    'nxm://diablo2resurrected/mods/1/files/123junk',
    'nxm://diablo2resurrected/mods/1/files',
    'nxm://diablo2resurrected/mods/1/not-files/2',
    'nxm://diablo2resurrected/mods/1/files/2/extra',
    'nxm://diablo2resurrected/mods/9007199254740992/files/2',
    'nxm://diablo2resurrected/mods/1/files/9007199254740992',
    'nxm://diablo2resurrected/mods/1/files/2?expires=123junk',
    'nxm://diablo2resurrected/collections//revisions/1',
    'nxm://diablo2resurrected/collections/example/revisions',
    'nxm://diablo2resurrected/collections/example/not-revisions/1',
    'nxm://diablo2resurrected/collections/example/revisions/0',
    'nxm://diablo2resurrected/collections/example/revisions/1.5',
    'nxm://diablo2resurrected/collections/example/revisions/NaN',
    'nxm://diablo2resurrected/collections/example/revisions/123junk',
    'nxm://diablo2resurrected/collections/example/revisions/9007199254740992',
  ])('rejects malformed or non-canonical input without throwing: %s', (url) => {
    expect(() => parseNxmProtocolUrl(url)).not.toThrow();
    expect(parseNxmProtocolUrl(url)).toBeNull();
  });
});

describe('NXM protocol delivery queue', () => {
  it('drains pre-ready URLs once and sends later live URLs once', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const onError = jest.fn();
    const queue = new NxmProtocolQueue(send, onError);
    const modUrl = 'nxm://diablo2resurrected/mods/1/files/2';
    const collectionUrl =
      'nxm://diablo2resurrected/collections/example/revisions/3';

    expect(queue.enqueue(modUrl)).toBe(true);
    expect(queue.enqueue(collectionUrl)).toBe(true);
    expect(queue.enqueue('not a protocol URL')).toBe(false);
    expect(send).not.toHaveBeenCalled();

    await Promise.all([queue.markRendererReady(), queue.markRendererReady()]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls).toEqual([
      [
        'nexus-mods-open-url',
        {
          expires: null,
          key: null,
          nexusFileID: 2,
          nexusModID: '1',
        },
      ],
      [
        'nexus-mods-open-collection-url',
        { collectionSlug: 'example', revisionNumber: 3 },
      ],
    ]);

    await queue.markRendererReady();
    expect(send).toHaveBeenCalledTimes(2);

    expect(queue.enqueue('nxm://diablo2resurrected/mods/4/files/5')).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
  });

  it('consumes a failed delivery once instead of redraining it', async () => {
    const error = new Error('synthetic send failure');
    const send = jest.fn().mockRejectedValue(error);
    const onError = jest.fn();
    const queue = new NxmProtocolQueue(send, onError);

    queue.enqueue('nxm://diablo2resurrected/mods/1/files/2');
    await queue.markRendererReady();
    await queue.markRendererReady();

    expect(send).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
