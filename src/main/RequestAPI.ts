import type { IRequestAPI } from 'bridge/RequestAPI';
import { app, net } from 'electron';
import { createWriteStream, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { EventAPI } from './EventAPI';
import { provideAPI } from './IPC';

const THROTTLE_TIME_MS = 500;
let REQUEST_ID = 0;

export async function initRequestAPI(): Promise<void> {
  provideAPI('RequestAPI', {
    // splitting the API into 2 parts allows requestors to
    // set up event listeners for a request before sending it
    async download(url, options) {
      return new Promise((resolve, reject) => {
        const filePath = path.join(
          app.getPath('temp'),
          'D2RMM',
          'RequestAPI',
          options?.fileName ?? `${REQUEST_ID++}.dat`,
        );
        mkdirSync(path.dirname(filePath), { recursive: true });
        rmSync(filePath, { force: true });
        const file = createWriteStream(filePath);
        let bytesTotal = 0;
        let bytesDownloaded = 0;
        let lastEventTime = 0;
        let isSettled = false;
        let responseHeaders: Record<string, string | string[]> = {};

        const removePartialFile = (): void => {
          try {
            rmSync(filePath, { force: true });
          } catch (cleanupError) {
            console.error(cleanupError);
          }
        };

        const rejectDownload = (error: Error): void => {
          if (isSettled) {
            return;
          }
          isSettled = true;
          file.once('close', removePartialFile);
          file.destroy();
          reject(error);
        };

        file.on('error', rejectDownload);
        file.on('finish', () => {
          if (isSettled) {
            return;
          }
          isSettled = true;
          resolve({ filePath, headers: responseHeaders });
        });

        const request = net.request(url);
        for (const [key, value] of Object.entries(options?.headers ?? {})) {
          request.setHeader(key, value);
        }
        request.on('response', (response) => {
          responseHeaders = response.headers;
          const parsedBytesTotal = parseInt(
            response.headers['content-length'] as string,
            10,
          );
          bytesTotal = Number.isNaN(parsedBytesTotal) ? 0 : parsedBytesTotal;
          response.on('error', rejectDownload);
          response.on('end', () => {
            file.end();
          });
          response.on('data', (buffer: Buffer) => {
            bytesDownloaded += buffer.length;
            file.write(buffer);

            if (
              options?.eventID != null &&
              Date.now() - lastEventTime > THROTTLE_TIME_MS
            ) {
              lastEventTime = Date.now();
              EventAPI.send(options?.eventID, {
                // IPC has trouble with Buffer so send it as number[]
                bytesDownloaded,
                bytesTotal,
              }).catch(console.error);
            }
          });
        });
        request.on('error', rejectDownload);
        request.end();
      });
    },
  } as IRequestAPI);
}
