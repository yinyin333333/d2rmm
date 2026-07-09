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

type ILocalRequestAPI = {
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

export const RequestAPI = {
  async downloadToFile(url, options) {
    const eventID = options?.onProgress == null ? null : uuidv4();
    if (eventID != null && options?.onProgress != null) {
      EventAPI.addListener(eventID, options?.onProgress);
    }
    try {
      return await NetworkedRequestAPI.download(url, {
        eventID,
        fileName: options?.fileName,
        headers: options?.headers,
      });
    } finally {
      if (eventID != null && options?.onProgress != null) {
        EventAPI.removeListener(eventID, options?.onProgress);
      }
    }
  },

  async downloadToBuffer(url, options) {
    const { filePath, headers } = await RequestAPI.downloadToFile(url, options);
    try {
      const response = readFileSync(filePath, { encoding: null });
      return { response, headers };
    } finally {
      rmSync(filePath, { force: true });
    }
  },
} as ILocalRequestAPI;
