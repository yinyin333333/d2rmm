import type { IModUpdaterAPI } from 'bridge/ModUpdaterAPI';
import * as fs from 'fs';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { initModUpdaterAPI } from '../main/worker/ModUpdaterAPI';

const mockDecompress = jest.fn();
const mockCpSync = jest.fn();
const mockProvideAPI = jest.fn();
let mockAppPath = '';

jest.mock('fs', () => {
  const actualFs = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actualFs,
    cpSync: (...args: Parameters<typeof actualFs.cpSync>) =>
      mockCpSync(...args),
  };
});
jest.mock('decompress', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockDecompress(...args),
}));
jest.mock('../main/worker/AppInfoAPI', () => ({
  getAppPath: () => mockAppPath,
}));
jest.mock('../main/worker/IPC', () => ({
  consumeAPI: (_name: string, localAPI: unknown) => localAPI,
  provideAPI: (...args: unknown[]) => mockProvideAPI(...args),
}));

describe('ModUpdaterAPI installation', () => {
  let updaterAPI: IModUpdaterAPI;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-install-test-'));
    mockAppPath = tempDir;
    const actualCpSync = jest.requireActual<typeof import('fs')>('fs').cpSync;
    mockCpSync.mockReset();
    mockCpSync.mockImplementation((...args: Parameters<typeof actualCpSync>) =>
      actualCpSync(...args),
    );
    mockDecompress.mockReset();
    mockProvideAPI.mockReset();
    mockProvideAPI.mockImplementation((_name: string, api: IModUpdaterAPI) => {
      updaterAPI = api;
    });
    await initModUpdaterAPI();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(tempDir, { force: true, recursive: true });
  });

  it('restores the archive flag and removes partial extraction on failure', async () => {
    const zipName = `broken-${path.basename(tempDir)}.zip`;
    const zipPath = path.join(tempDir, zipName);
    const extractPath = path.join(
      os.tmpdir(),
      'D2RMM',
      'ModInstall',
      path.basename(zipPath, '.zip'),
    );
    const previousNoAsar = process.noAsar;
    mockDecompress.mockRejectedValue(new Error('bad archive'));

    await expect(updaterAPI.installModFromZip(zipPath)).rejects.toThrow(
      'bad archive',
    );

    expect(process.noAsar).toBe(previousNoAsar);
    expect(fs.existsSync(extractPath)).toBe(false);
  });

  it('keeps the installed mod when staging the replacement fails', async () => {
    const sourcePath = path.join(tempDir, 'example');
    const installedPath = path.join(tempDir, 'mods', 'example');
    mkdirSync(sourcePath, { recursive: true });
    mkdirSync(installedPath, { recursive: true });
    writeFileSync(path.join(sourcePath, 'mod.json'), '{}');
    writeFileSync(path.join(installedPath, 'old.txt'), 'old');
    mockCpSync.mockImplementationOnce(() => {
      throw new Error('copy failed');
    });

    await expect(updaterAPI.installModFromFolder(sourcePath)).rejects.toThrow(
      'copy failed',
    );

    expect(readFileSync(path.join(installedPath, 'old.txt'), 'utf8')).toBe(
      'old',
    );
  });

  it('replaces a mod only after staging and preserves its config', async () => {
    const sourcePath = path.join(tempDir, 'example');
    const installedPath = path.join(tempDir, 'mods', 'example');
    mkdirSync(sourcePath, { recursive: true });
    mkdirSync(installedPath, { recursive: true });
    writeFileSync(path.join(sourcePath, 'mod.json'), '{"name":"new"}');
    writeFileSync(path.join(sourcePath, 'new.txt'), 'new');
    writeFileSync(path.join(installedPath, 'old.txt'), 'old');
    writeFileSync(path.join(installedPath, 'config.json'), '{"saved":true}');

    await expect(updaterAPI.installModFromFolder(sourcePath)).resolves.toBe(
      'example',
    );

    expect(readFileSync(path.join(installedPath, 'new.txt'), 'utf8')).toBe(
      'new',
    );
    expect(readFileSync(path.join(installedPath, 'config.json'), 'utf8')).toBe(
      '{"saved":true}',
    );
    expect(fs.existsSync(path.join(installedPath, 'old.txt'))).toBe(false);
  });

  it('removes a zip extension case-insensitively when deriving the mod ID', async () => {
    const zipPath = path.join(tempDir, 'Example.ZIP');
    mockDecompress.mockImplementation(
      async (_zipFilePath: string, extractDirPath: string) => {
        writeFileSync(path.join(extractDirPath, 'mod.json'), '{}');
      },
    );

    await expect(updaterAPI.installModFromZip(zipPath)).resolves.toBe('Example');

    expect(fs.existsSync(path.join(tempDir, 'mods', 'Example', 'mod.json'))).toBe(
      true,
    );
  });
});
