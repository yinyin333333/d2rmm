import type { IRequestAPI } from 'bridge/RequestAPI';
import { app, net } from 'electron';
import { createWriteStream, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { Readable, Transform, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { EventAPI } from './EventAPI';
import { provideAPI } from './IPC';

const THROTTLE_TIME_MS = 500;

export type RequestAPIDependencies = {
  createOutputStream: (filePath: string) => Writable;
  createRequest: (url: string) => Electron.ClientRequest;
  createRequestID: () => string;
  getTempRoot: () => string;
  makeDirectory: (directoryPath: string) => void;
  now: () => number;
  removeFile: (filePath: string) => void;
  sendProgress: (
    eventID: string,
    progress: { bytesDownloaded: number; bytesTotal: number },
  ) => Promise<void>;
};

function getBytesTotal(response: Electron.IncomingMessage): number {
  const contentLength = response.headers['content-length'];
  const rawValue = Array.isArray(contentLength)
    ? contentLength[0]
    : contentLength;
  const parsedValue = rawValue == null ? NaN : parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0;
}

function createProgressTransform(
  dependencies: RequestAPIDependencies,
  eventID: string | null | undefined,
  bytesTotal: number,
): Transform {
  let bytesDownloaded = 0;
  let lastEventTime = Number.NEGATIVE_INFINITY;

  return new Transform({
    transform(chunk, encoding, callback) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk, encoding as BufferEncoding);
      bytesDownloaded += buffer.length;
      const currentTime = dependencies.now();

      if (eventID != null && currentTime - lastEventTime > THROTTLE_TIME_MS) {
        lastEventTime = currentTime;
        dependencies
          .sendProgress(eventID, { bytesDownloaded, bytesTotal })
          .catch(console.error);
      }

      callback(null, chunk);
    },
  });
}

async function streamResponseToFile(
  dependencies: RequestAPIDependencies,
  response: Electron.IncomingMessage,
  filePath: string,
  eventID: string | null | undefined,
): Promise<{ filePath: string; headers: Electron.IncomingMessage['headers'] }> {
  const readable = response as unknown as Readable;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    readable.destroy();
    throw new Error(
      `Download failed with HTTP ${response.statusCode} ${response.statusMessage}.`,
    );
  }

  const onAborted = (): void => {
    readable.destroy(new Error('Download response was aborted.'));
  };
  response.once('aborted', onAborted);

  try {
    const output = dependencies.createOutputStream(filePath);
    const progress = createProgressTransform(
      dependencies,
      eventID,
      getBytesTotal(response),
    );
    await pipeline(readable, progress, output);
    return { filePath, headers: response.headers };
  } finally {
    response.removeListener('aborted', onAborted);
  }
}

function abortRequestSafely(request: Electron.ClientRequest | null): void {
  if (request == null) return;

  // Electron may report a final request error after abort. Keep a guarded
  // listener until `close` (documented as the last transaction event) so a
  // failed download cannot become an unhandled EventEmitter error.
  const onLateError = (): void => {};
  const onClose = (): void => {
    request.removeListener('error', onLateError);
  };
  request.on('error', onLateError);
  request.once('close', onClose);
  try {
    request.abort();
  } catch {
    request.removeListener('error', onLateError);
    request.removeListener('close', onClose);
  }
}

export function createRequestAPI(
  dependencies: RequestAPIDependencies,
): IRequestAPI {
  return {
    async download(url, options) {
      const requestRoot = path.join(
        dependencies.getTempRoot(),
        'D2RMM',
        'RequestAPI',
      );
      const filePath = path.join(requestRoot, dependencies.createRequestID());
      let request: Electron.ClientRequest | null = null;

      try {
        dependencies.makeDirectory(requestRoot);
        request = dependencies.createRequest(url);
        for (const [key, value] of Object.entries(options?.headers ?? {})) {
          request.setHeader(key, value);
        }

        return await new Promise((resolve, reject) => {
          let activeResponse: Readable | null = null;
          let responseReceived = false;
          let settled = false;

          const cleanup = (): void => {
            request?.removeListener('response', onResponse);
            request?.removeListener('error', onError);
            request?.removeListener('abort', onAbort);
            request?.removeListener('close', onClose);
          };
          const resolveOnce = (
            result: Awaited<ReturnType<typeof streamResponseToFile>>,
          ): void => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
          };
          const rejectOnce = (error: unknown): void => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          };
          const onError = (error: Error): void => {
            if (activeResponse != null) {
              activeResponse.destroy(error);
            } else {
              rejectOnce(error);
            }
          };
          const onAbort = (): void => {
            const error = new Error('Download request was aborted.');
            if (activeResponse != null) {
              activeResponse.destroy(error);
            } else {
              rejectOnce(error);
            }
          };
          const onClose = (): void => {
            if (!responseReceived) {
              rejectOnce(
                new Error(
                  'Download request closed before receiving a response.',
                ),
              );
            }
          };
          const onResponse = (response: Electron.IncomingMessage): void => {
            if (responseReceived || settled) return;
            responseReceived = true;
            activeResponse = response as unknown as Readable;
            streamResponseToFile(
              dependencies,
              response,
              filePath,
              options?.eventID,
            ).then(resolveOnce, rejectOnce);
          };

          request?.once('response', onResponse);
          request?.once('error', onError);
          request?.once('abort', onAbort);
          request?.once('close', onClose);
          try {
            request?.end();
          } catch (error) {
            rejectOnce(error);
          }
        });
      } catch (error) {
        abortRequestSafely(request);
        try {
          dependencies.removeFile(filePath);
        } catch (cleanupError) {
          console.error(cleanupError);
        }
        throw error;
      }
    },
  } as IRequestAPI;
}

function createDefaultRequestAPI(): IRequestAPI {
  return createRequestAPI({
    createOutputStream: (filePath) => createWriteStream(filePath),
    createRequest: (url) => net.request(url),
    createRequestID: uuidv4,
    getTempRoot: () => app.getPath('temp'),
    makeDirectory: (directoryPath) =>
      mkdirSync(directoryPath, { recursive: true }),
    now: Date.now,
    removeFile: (filePath) => rmSync(filePath, { force: true }),
    sendProgress: (eventID, progress) => EventAPI.send(eventID, progress),
  });
}

export async function initRequestAPI(): Promise<void> {
  provideAPI('RequestAPI', createDefaultRequestAPI());
}
