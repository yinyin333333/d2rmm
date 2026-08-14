import { EventEmitter } from 'events';
import path from 'path';
import { Readable, Writable } from 'stream';
import { createRequestAPI, RequestAPIDependencies } from '../main/RequestAPI';

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => {
      throw new Error('MainRequestAPI tests must not use the user temp path.');
    }),
  },
  net: {
    request: jest.fn(() => {
      throw new Error('MainRequestAPI tests must not use Electron networking.');
    }),
  },
}));

class FakeClientRequest extends EventEmitter {
  public aborted = false;
  public headers = new Map<string, string>();

  constructor(
    private readonly onEnd: (request: FakeClientRequest) => void,
    private readonly onAbort?: (request: FakeClientRequest) => void,
  ) {
    super();
  }

  public abort(): void {
    this.aborted = true;
    this.emit('abort');
    this.onAbort?.(this);
  }

  public end(): this {
    queueMicrotask(() => this.onEnd(this));
    return this;
  }

  public setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }
}

class MemoryWritable extends Writable {
  public chunks: Buffer[] = [];
  public finalized = false;

  public constructor(private readonly delayWrites = false) {
    super({ highWaterMark: 1 });
  }

  public _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk));
    if (this.delayWrites) {
      setTimeout(callback, 1);
    } else {
      callback();
    }
  }

  public _final(callback: (error?: Error | null) => void): void {
    const finish = (): void => {
      this.finalized = true;
      callback();
    };
    if (this.delayWrites) {
      setTimeout(finish, 1);
    } else {
      finish();
    }
  }
}

type FakeResponse = Readable & {
  headers: Record<string, string | string[]>;
  statusCode: number;
  statusMessage: string;
};

function makeResponse(
  chunks: Buffer[] = [Buffer.from('payload')],
  statusCode = 200,
): FakeResponse {
  let pushed = false;
  const response = new Readable({
    read() {
      if (pushed) return;
      pushed = true;
      for (const chunk of chunks) this.push(chunk);
      this.push(null);
    },
  }) as FakeResponse;
  response.headers = {
    'content-length': String(
      chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    ),
  };
  response.statusCode = statusCode;
  response.statusMessage = statusCode === 200 ? 'OK' : 'Failure';
  return response;
}

type DependencyOptions = {
  createOutputStream?: (filePath: string) => Writable;
  ids?: string[];
  onAbort?: (request: FakeClientRequest) => void;
  onEnd?: (request: FakeClientRequest) => void;
};

function makeDependencies({
  createOutputStream = () => new MemoryWritable(),
  ids = ['00000000-0000-4000-8000-000000000001'],
  onAbort,
  onEnd = (request) => request.emit('response', makeResponse()),
}: DependencyOptions = {}): {
  dependencies: RequestAPIDependencies;
  makeDirectory: jest.Mock;
  removeFile: jest.Mock;
  requests: FakeClientRequest[];
  sendProgress: jest.Mock;
  writtenPaths: string[];
  requestRoot: string;
} {
  const requests: FakeClientRequest[] = [];
  const writtenPaths: string[] = [];
  const makeDirectory = jest.fn();
  const removeFile = jest.fn();
  const sendProgress = jest.fn().mockResolvedValue(undefined);
  const fakeTempRoot = path.resolve(path.sep, 'virtual', 'd2rmm-request-test');
  const requestRoot = path.join(fakeTempRoot, 'D2RMM', 'RequestAPI');
  let idIndex = 0;
  let now = 1000;

  return {
    dependencies: {
      createOutputStream: (filePath) => {
        writtenPaths.push(filePath);
        return createOutputStream(filePath);
      },
      createRequest: () => {
        const request = new FakeClientRequest(onEnd, onAbort);
        requests.push(request);
        return request as unknown as Electron.ClientRequest;
      },
      createRequestID: () => ids[idIndex++],
      getTempRoot: () => fakeTempRoot,
      makeDirectory,
      now: () => (now += 501),
      removeFile,
      sendProgress,
    },
    makeDirectory,
    removeFile,
    requests,
    sendProgress,
    writtenPaths,
    requestRoot,
  };
}

describe('main RequestAPI download lifecycle', () => {
  it('waits for backpressure and writable finish before resolving', async () => {
    const chunks = [Buffer.from('first'), Buffer.from('second')];
    const response = makeResponse(chunks);
    const pauseSpy = jest.spyOn(response, 'pause');
    const output = new MemoryWritable(true);
    const state = makeDependencies({
      createOutputStream: () => output,
      onEnd: (request) => request.emit('response', response),
    });
    const api = createRequestAPI(state.dependencies);

    const result = await api.download('https://invalid.test/payload', {
      eventID: 'progress-id',
      fileName: 'display-name.zip',
    });

    expect(Buffer.concat(output.chunks)).toEqual(Buffer.concat(chunks));
    expect(output.finalized).toBe(true);
    expect(output.writableFinished).toBe(true);
    expect(pauseSpy).toHaveBeenCalled();
    expect(result.filePath).toBe(
      path.join(state.requestRoot, '00000000-0000-4000-8000-000000000001'),
    );
    expect(state.removeFile).not.toHaveBeenCalled();
    expect(state.sendProgress).toHaveBeenCalledWith('progress-id', {
      bytesDownloaded: Buffer.concat(chunks).length,
      bytesTotal: Buffer.concat(chunks).length,
    });
  });

  it('uses a different internal UUID path for concurrent requests with the same display name', async () => {
    const state = makeDependencies({
      ids: [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ],
    });
    const api = createRequestAPI(state.dependencies);

    const results = await Promise.all([
      api.download('https://invalid.test/one', { fileName: 'same.zip' }),
      api.download('https://invalid.test/two', { fileName: 'same.zip' }),
    ]);

    expect(results[0].filePath).not.toBe(results[1].filePath);
    expect(results.map(({ filePath }) => path.dirname(filePath))).toEqual([
      state.requestRoot,
      state.requestRoot,
    ]);
    expect(state.writtenPaths).toEqual(results.map(({ filePath }) => filePath));
  });

  it.each([
    '../escape.zip',
    '..\\escape.zip',
    path.resolve(path.sep, 'absolute', 'escape.zip'),
    '\\\\server\\share\\escape.zip',
  ])(
    'does not use untrusted display filename %s in the actual path',
    async (fileName) => {
      const state = makeDependencies();
      const api = createRequestAPI(state.dependencies);

      const result = await api.download('https://invalid.test/payload', {
        fileName,
      });

      expect(result.filePath).toBe(
        path.join(state.requestRoot, '00000000-0000-4000-8000-000000000001'),
      );
      expect(result.filePath).not.toContain('escape.zip');
      expect(state.makeDirectory).toHaveBeenCalledWith(state.requestRoot);
    },
  );

  it('rejects a writable error, aborts the request, and removes the partial path once', async () => {
    const writer = new Writable({
      write(_chunk, _encoding, callback) {
        const error = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        callback(error);
      },
    });
    const state = makeDependencies({ createOutputStream: () => writer });
    const api = createRequestAPI(state.dependencies);

    await expect(api.download('https://invalid.test/payload')).rejects.toThrow(
      'disk full',
    );

    expect(state.requests[0].aborted).toBe(true);
    expect(state.removeFile).toHaveBeenCalledTimes(1);
    expect(state.removeFile).toHaveBeenCalledWith(
      path.join(state.requestRoot, '00000000-0000-4000-8000-000000000001'),
    );
  });

  it('consumes a late ClientRequest error emitted after aborting a failed download', async () => {
    const writer = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('write failed'));
      },
    });
    const state = makeDependencies({
      createOutputStream: () => writer,
      onAbort: (request) =>
        queueMicrotask(() => {
          request.emit('error', new Error('late abort error'));
          request.emit('close');
        }),
    });
    const api = createRequestAPI(state.dependencies);

    await expect(api.download('https://invalid.test/payload')).rejects.toThrow(
      'write failed',
    );
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(state.requests[0].aborted).toBe(true);
    expect(state.removeFile).toHaveBeenCalledTimes(1);
  });

  it('rejects and cleans up when the response stream errors', async () => {
    const response = new Readable({
      read() {
        this.destroy(new Error('socket reset'));
      },
    }) as FakeResponse;
    response.headers = {};
    response.statusCode = 200;
    response.statusMessage = 'OK';
    const state = makeDependencies({
      onEnd: (request) => request.emit('response', response),
    });
    const api = createRequestAPI(state.dependencies);

    await expect(api.download('https://invalid.test/payload')).rejects.toThrow(
      'socket reset',
    );
    expect(state.requests[0].aborted).toBe(true);
    expect(state.removeFile).toHaveBeenCalledTimes(1);
  });

  it('rejects and cleans up when the response is aborted mid-stream', async () => {
    let started = false;
    const response = new Readable({
      read() {
        if (started) return;
        started = true;
        this.push(Buffer.from('partial'));
        queueMicrotask(() => this.emit('aborted'));
      },
    }) as FakeResponse;
    response.headers = { 'content-length': '100' };
    response.statusCode = 200;
    response.statusMessage = 'OK';
    const state = makeDependencies({
      onEnd: (request) => request.emit('response', response),
    });
    const api = createRequestAPI(state.dependencies);

    await expect(api.download('https://invalid.test/payload')).rejects.toThrow(
      'aborted',
    );
    expect(state.requests[0].aborted).toBe(true);
    expect(state.removeFile).toHaveBeenCalledTimes(1);
  });

  it('rejects a request error before any writer is created', async () => {
    const createOutputStream = jest.fn(() => new MemoryWritable());
    const state = makeDependencies({
      createOutputStream,
      onEnd: (request) => request.emit('error', new Error('request failed')),
    });
    const api = createRequestAPI(state.dependencies);

    await expect(api.download('https://invalid.test/payload')).rejects.toThrow(
      'request failed',
    );
    expect(createOutputStream).not.toHaveBeenCalled();
    expect(state.requests[0].aborted).toBe(true);
    expect(state.removeFile).toHaveBeenCalledTimes(1);
  });

  it('rejects a request abort before any writer is created', async () => {
    const createOutputStream = jest.fn(() => new MemoryWritable());
    const state = makeDependencies({
      createOutputStream,
      onEnd: (request) => request.emit('abort'),
    });
    const api = createRequestAPI(state.dependencies);

    await expect(api.download('https://invalid.test/payload')).rejects.toThrow(
      'aborted',
    );
    expect(createOutputStream).not.toHaveBeenCalled();
    expect(state.removeFile).toHaveBeenCalledTimes(1);
  });

  it.each([404, 429, 500])(
    'rejects HTTP %s without committing a file',
    async (statusCode) => {
      const createOutputStream = jest.fn(() => new MemoryWritable());
      const state = makeDependencies({
        createOutputStream,
        onEnd: (request) =>
          request.emit(
            'response',
            makeResponse([Buffer.from('error')], statusCode),
          ),
      });
      const api = createRequestAPI(state.dependencies);

      await expect(
        api.download('https://invalid.test/payload'),
      ).rejects.toThrow(String(statusCode));
      expect(createOutputStream).not.toHaveBeenCalled();
      expect(state.requests[0].aborted).toBe(true);
      expect(state.removeFile).toHaveBeenCalledTimes(1);
    },
  );
});
