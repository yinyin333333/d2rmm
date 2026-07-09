import type { IRequestAPI } from 'bridge/RequestAPI';
import { EventEmitter } from 'events';

const mockCreateWriteStream = jest.fn();
const mockMkdirSync = jest.fn();
const mockNetRequest = jest.fn();
const mockProvideAPI = jest.fn();
const mockRmSync = jest.fn();

jest.mock('electron', () => ({
  app: { getPath: () => 'C:\\Temp' },
  net: { request: mockNetRequest },
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  createWriteStream: mockCreateWriteStream,
  mkdirSync: mockMkdirSync,
  rmSync: mockRmSync,
}));

jest.mock('../main/EventAPI', () => ({
  EventAPI: { send: jest.fn() },
}));

jest.mock('../main/IPC', () => ({
  provideAPI: mockProvideAPI,
}));

type MockFile = EventEmitter & {
  destroy: jest.Mock;
  end: jest.Mock;
  once: EventEmitter['once'];
  write: jest.Mock;
};

type MockRequest = EventEmitter & {
  end: jest.Mock;
  setHeader: jest.Mock;
};

function createMockFile(): MockFile {
  const file = new EventEmitter() as MockFile;
  file.destroy = jest.fn();
  file.end = jest.fn();
  file.write = jest.fn();
  return file;
}

function createMockRequest(): MockRequest {
  const request = new EventEmitter() as MockRequest;
  request.end = jest.fn();
  request.setHeader = jest.fn();
  return request;
}

describe('RequestAPI', () => {
  beforeEach(() => {
    jest.resetModules();
    mockCreateWriteStream.mockReset();
    mockMkdirSync.mockReset();
    mockNetRequest.mockReset();
    mockProvideAPI.mockReset();
    mockRmSync.mockReset();
  });

  it('resolves a download only after the destination file is flushed', async () => {
    const file = createMockFile();
    const request = createMockRequest();
    const response = new EventEmitter() as EventEmitter & {
      headers: Record<string, string>;
    };
    response.headers = { 'content-length': '4' };
    mockCreateWriteStream.mockReturnValue(file);
    mockNetRequest.mockReturnValue(request);

    const { initRequestAPI } = await import('../main/RequestAPI');
    await initRequestAPI();
    const api = mockProvideAPI.mock.calls[0][1] as IRequestAPI;

    let isResolved = false;
    const download = api
      .download('https://example.test/file')
      .then((result) => {
        isResolved = true;
        return result;
      });
    request.emit('response', response);
    response.emit('data', Buffer.from('data'));
    response.emit('end');
    await Promise.resolve();

    expect(file.end).toHaveBeenCalled();
    expect(isResolved).toBe(false);

    file.emit('finish');

    await expect(download).resolves.toMatchObject({
      headers: response.headers,
    });
    expect(file.write).toHaveBeenCalledWith(Buffer.from('data'));
  });

  it('rejects stream failures and removes the partial file after close', async () => {
    const file = createMockFile();
    const request = createMockRequest();
    mockCreateWriteStream.mockReturnValue(file);
    mockNetRequest.mockReturnValue(request);

    const { initRequestAPI } = await import('../main/RequestAPI');
    await initRequestAPI();
    const api = mockProvideAPI.mock.calls[0][1] as IRequestAPI;
    const error = new Error('disk full');

    const download = api.download('https://example.test/file');
    file.emit('error', error);

    await expect(download).rejects.toThrow(error);
    expect(file.destroy).toHaveBeenCalled();

    file.emit('close');

    expect(mockRmSync).toHaveBeenLastCalledWith(
      expect.stringContaining('RequestAPI'),
      { force: true },
    );
  });
});
