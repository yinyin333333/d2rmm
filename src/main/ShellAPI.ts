import { IShellAPI } from 'bridge/ShellAPI';
import { shell } from 'electron';
import { provideAPI } from './IPC';

type WebContents = Electron.BrowserWindow['webContents'];

function createExternalURLNotAllowedError(url: string): Error {
  const error = new Error(
    `External URL must be a valid http: or https: URL: ${url}`,
  );
  error.name = 'ExternalURLNotAllowedError';
  return error;
}

function getAllowedExternalURL(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw createExternalURLNotAllowedError(url);
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.hostname === ''
  ) {
    throw createExternalURLNotAllowedError(url);
  }
  return parsed;
}

export async function openExternalURL(url: string): Promise<void> {
  const parsed = getAllowedExternalURL(url);
  await shell.openExternal(parsed.href);
}

function getDocumentIdentity(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
}

export function configureWebContentsSecurity(
  webContents: WebContents,
  allowedDocumentURL: string,
): void {
  const allowedDocumentIdentity = getDocumentIdentity(allowedDocumentURL);
  if (allowedDocumentIdentity == null) {
    throw new Error(`Invalid application document URL: ${allowedDocumentURL}`);
  }

  webContents.setWindowOpenHandler(({ url }) => {
    void openExternalURL(url).catch(console.error);
    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (getDocumentIdentity(url) !== allowedDocumentIdentity) {
      event.preventDefault();
    }
  });
}

export async function initShellAPI(): Promise<void> {
  provideAPI('ShellAPI', {
    openExternal: async (url) => {
      return openExternalURL(url);
    },
    showItemInFolder: async (path) => {
      return shell.showItemInFolder(path);
    },
  } as IShellAPI);
}
