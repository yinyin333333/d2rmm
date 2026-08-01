import type { IRequestAPI } from '../bridge/RequestAPI';
import {
  createWorkerRequestAPI,
  OnProgress,
  WorkerRequestAPIDependencies,
} from '../main/worker/RequestAPI';

function makeDependencies(
  download: jest.Mock = jest.fn().mockResolvedValue({
    filePath: '/virtual/request-id',
    headers: {},
  }),
): {
  addProgressListener: jest.Mock;
  dependencies: WorkerRequestAPIDependencies;
  readFile: jest.Mock;
  removeFile: jest.Mock;
  removeProgressListener: jest.Mock;
} {
  const addProgressListener = jest.fn();
  const removeProgressListener = jest.fn();
  const readFile = jest.fn(() => Buffer.from('payload'));
  const removeFile = jest.fn();

  return {
    addProgressListener,
    dependencies: {
      addProgressListener,
      createEventID: () => 'progress-event-id',
      networkedRequestAPI: { download } as Pick<IRequestAPI, 'download'>,
      readFile,
      removeFile,
      removeProgressListener,
    },
    readFile,
    removeFile,
    removeProgressListener,
  };
}

describe('worker RequestAPI cleanup', () => {
  it.each([
    [
      'success',
      jest.fn().mockResolvedValue({ filePath: '/virtual/file', headers: {} }),
    ],
    ['failure', jest.fn().mockRejectedValue(new Error('network failed'))],
  ])(
    'removes its progress listener in finally after download %s',
    async (_label, download) => {
      const state = makeDependencies(download);
      const api = createWorkerRequestAPI(state.dependencies);
      const onProgress: OnProgress = jest.fn().mockResolvedValue(undefined);

      await api
        .downloadToFile('https://invalid.test/payload', { onProgress })
        .catch(() => undefined);

      expect(state.addProgressListener).toHaveBeenCalledWith(
        'progress-event-id',
        onProgress,
      );
      expect(state.removeProgressListener).toHaveBeenCalledWith(
        'progress-event-id',
        onProgress,
      );
    },
  );

  it('does not register a progress listener when no callback is supplied', async () => {
    const state = makeDependencies();
    const api = createWorkerRequestAPI(state.dependencies);

    await api.downloadToFile('https://invalid.test/payload');

    expect(state.addProgressListener).not.toHaveBeenCalled();
    expect(state.removeProgressListener).not.toHaveBeenCalled();
  });

  it('removes a downloaded buffer file after a successful read', async () => {
    const state = makeDependencies();
    const api = createWorkerRequestAPI(state.dependencies);

    const result = await api.downloadToBuffer('https://invalid.test/payload');

    expect(result.response).toEqual(Buffer.from('payload'));
    expect(state.removeFile).toHaveBeenCalledWith('/virtual/request-id');
  });

  it('removes a downloaded buffer file when reading it fails', async () => {
    const state = makeDependencies();
    state.readFile.mockImplementation(() => {
      throw new Error('read failed');
    });
    const api = createWorkerRequestAPI(state.dependencies);

    await expect(
      api.downloadToBuffer('https://invalid.test/payload'),
    ).rejects.toThrow('read failed');
    expect(state.removeFile).toHaveBeenCalledWith('/virtual/request-id');
  });
});
