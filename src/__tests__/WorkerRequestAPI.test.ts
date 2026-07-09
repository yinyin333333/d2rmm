const mockAddListener = jest.fn();
const mockDownload = jest.fn();
const mockReadFileSync = jest.fn();
const mockRemoveListener = jest.fn();
const mockRmSync = jest.fn();

jest.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  rmSync: mockRmSync,
}));

jest.mock('uuid', () => ({
  v4: () => 'progress-event',
}));

jest.mock('../main/worker/EventAPI', () => ({
  EventAPI: {
    addListener: mockAddListener,
    removeListener: mockRemoveListener,
  },
}));

jest.mock('../main/worker/IPC', () => ({
  consumeAPI: () => ({ download: mockDownload }),
}));

describe('worker RequestAPI', () => {
  beforeEach(() => {
    jest.resetModules();
    mockAddListener.mockReset();
    mockDownload.mockReset();
    mockReadFileSync.mockReset();
    mockRemoveListener.mockReset();
    mockRmSync.mockReset();
  });

  it('removes the progress listener when a download fails', async () => {
    const error = new Error('network failure');
    const onProgress = jest.fn();
    mockDownload.mockRejectedValue(error);
    const { RequestAPI } = await import('../main/worker/RequestAPI');

    await expect(
      RequestAPI.downloadToFile('https://example.test/file', { onProgress }),
    ).rejects.toThrow(error);

    expect(mockAddListener).toHaveBeenCalledWith('progress-event', onProgress);
    expect(mockRemoveListener).toHaveBeenCalledWith(
      'progress-event',
      onProgress,
    );
  });

  it('removes the temporary file when reading it fails', async () => {
    const error = new Error('read failure');
    mockDownload.mockResolvedValue({ filePath: 'temporary.dat', headers: {} });
    mockReadFileSync.mockImplementation(() => {
      throw error;
    });
    const { RequestAPI } = await import('../main/worker/RequestAPI');

    await expect(
      RequestAPI.downloadToBuffer('https://example.test/file'),
    ).rejects.toThrow(error);

    expect(mockRmSync).toHaveBeenCalledWith('temporary.dat', { force: true });
  });
});
