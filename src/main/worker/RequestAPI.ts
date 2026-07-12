import type {
  IRequestAPI,
  RequestHeaders,
  ResponseHeaders,
} from 'bridge/RequestAPI';
import { readFileSync, rmSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { EventAPI } from './EventAPI';
import { consumeAPI } from './IPC';

const NetworkedRequestAPI = consumeAPI<IRequestAPI>('RequestAPI', {});

export type OnProgress = (progress: {
  bytesDownloaded: number;
  bytesTotal: number;
}) => Promise<void>;

export type WorkerRequestAPIDependencies = {
  addProgressListener: (eventID: string, listener: OnProgress) => void;
  createEventID: () => string;
  networkedRequestAPI: Pick<IRequestAPI, 'download'>;
  readFile: (filePath: string) => Buffer;
  removeFile: (filePath: string) => void;
  removeProgressListener: (eventID: string, listener: OnProgress) => void;
};

export type ILocalRequestAPI = {
  downloadToFile(
    url: string,
    options?: {
      fileName?: string | null;
      headers?: RequestHeaders | null;
      onProgress?: OnProgress | null;
    } | null,
  ): Promise<{
    filePath: string;
    headers: ResponseHeaders;
  }>;
  downloadToBuffer(
    url: string,
    options?: {
      headers?: RequestHeaders | null;
      onProgress?: OnProgress | null;
    } | null,
  ): Promise<{
    response: Buffer;
    headers: ResponseHeaders;
  }>;
};

export function createWorkerRequestAPI(
  dependencies: WorkerRequestAPIDependencies,
): ILocalRequestAPI {
  const api: ILocalRequestAPI = {
    async downloadToFile(url, options) {
      const onProgress = options?.onProgress;
      const eventID = onProgress == null ? null : dependencies.createEventID();
      if (eventID != null && onProgress != null) {
        dependencies.addProgressListener(eventID, onProgress);
      }

      try {
        return await dependencies.networkedRequestAPI.download(url, {
          eventID,
          fileName: options?.fileName,
          headers: options?.headers,
        });
      } finally {
        if (eventID != null && onProgress != null) {
          dependencies.removeProgressListener(eventID, onProgress);
        }
      }
    },

    async downloadToBuffer(url, options) {
      const { filePath, headers } = await api.downloadToFile(url, options);
      try {
        return { response: dependencies.readFile(filePath), headers };
      } finally {
        dependencies.removeFile(filePath);
      }
    },
  };
  return api;
}

export const RequestAPI = createWorkerRequestAPI({
  addProgressListener: (eventID, listener) => {
    EventAPI.addListener(eventID, listener);
  },
  createEventID: uuidv4,
  networkedRequestAPI: NetworkedRequestAPI,
  readFile: (filePath) => readFileSync(filePath, { encoding: null }),
  removeFile: (filePath) => rmSync(filePath, { force: true }),
  removeProgressListener: (eventID, listener) => {
    EventAPI.removeListener(eventID, listener);
  },
});
