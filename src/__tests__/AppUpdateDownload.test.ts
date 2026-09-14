import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ReadableStream } from 'stream/web';
import { transferableAbortController } from 'util';
import { downloadPackage } from '../main/AppUpdatePackage';

const originalSignal = global.AbortSignal;
const originalFetch = global.fetch;
let temporary: string;
beforeEach(async () => {
  global.AbortSignal = transferableAbortController().signal
    .constructor as typeof AbortSignal;
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'd2rmm-download-'));
});
afterEach(async () => {
  global.AbortSignal = originalSignal;
  global.fetch = originalFetch;
  await fs.rm(temporary, { recursive: true, force: true });
});
const asset = {
  name: 'D2RMM.Custom.1.1.0.zip',
  browser_download_url:
    'https://github.com/yinyin333333/d2rmm/releases/download/v1.1.0/update.zip',
  size: 100,
};

test('aborts a request waiting for response headers', async () => {
  const controller = transferableAbortController();
  global.fetch = jest.fn().mockImplementation(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  const downloading = downloadPackage(
    asset,
    path.join(temporary, 'release.zip'),
    () => {},
    controller.signal,
  );
  controller.abort(new Error('cancelled request'));
  await expect(downloading).rejects.toThrow('cancelled request');
  expect(await fs.readdir(temporary)).toEqual([]);
});

test('aborts a stalled response body and closes the real download stream', async () => {
  const controller = transferableAbortController();
  const cancelled = jest.fn();
  const body = new ReadableStream({
    start(stream) {
      stream.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel: cancelled,
  });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, body });
  const destination = path.join(temporary, 'release.zip');
  const downloading = downloadPackage(
    asset,
    destination,
    () => controller.abort(),
    controller.signal,
  );
  await expect(downloading).rejects.toThrow(/abort/i);
  expect(cancelled).toHaveBeenCalled();
  // Windows refuses this rename if the pipeline left its destination open.
  await fs.rename(destination, path.join(temporary, 'cancelled.zip'));
});
