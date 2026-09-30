import { D2RLoaderLogScope, IShellAPI } from 'bridge/ShellAPI';
import { dialog, shell } from 'electron';
import { stat } from 'fs/promises';
import {
  collectD2RLoaderLogs,
  writeD2RLoaderLogZip,
} from './D2RLoaderLogExport';
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

export async function openPath(filePath: string): Promise<void> {
  const pathStats = await stat(filePath);
  if (!pathStats.isDirectory()) {
    throw new Error(`Path is not a directory: ${filePath}`);
  }
  const error = await shell.openPath(filePath);
  if (error !== '') {
    throw new Error(error);
  }
}

export async function selectDirectory(
  defaultPath?: string,
): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    ...(defaultPath?.trim() ? { defaultPath } : {}),
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

export async function exportD2RLoaderLogs(
  gamePath: string,
  outputModName: string,
  scope: D2RLoaderLogScope,
) {
  const plan = await collectD2RLoaderLogs(gamePath, outputModName, scope);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result = await dialog.showSaveDialog({
    defaultPath: `d2rloader-logs-${timestamp}.zip`,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const destination = /\.zip$/i.test(result.filePath)
    ? result.filePath
    : `${result.filePath}.zip`;
  await writeD2RLoaderLogZip(plan, destination);
  return { path: destination, missingDirectories: plan.missingDirectories };
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

  const isUnexpectedNavigation = (url: string): boolean =>
    getDocumentIdentity(url) !== allowedDocumentIdentity;

  webContents.on('will-navigate', (event, url) => {
    if (isUnexpectedNavigation(url)) {
      event.preventDefault();
    }
  });
  webContents.on('will-redirect', (event, url) => {
    if (isUnexpectedNavigation(url)) {
      event.preventDefault();
    }
  });
}

export async function initShellAPI(): Promise<void> {
  provideAPI('ShellAPI', {
    openExternal: async (url) => {
      return openExternalURL(url);
    },
    openPath,
    selectDirectory,
    exportD2RLoaderLogs,
    showItemInFolder: async (path) => {
      return shell.showItemInFolder(path);
    },
  } as IShellAPI);
}
