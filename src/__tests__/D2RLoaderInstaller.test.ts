import { strToU8, zipSync } from 'fflate';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { setImmediate as nodeSetImmediate } from 'timers';
import {
  D2R_LOADER_DOWNLOAD_URL,
  downloadAndInstallD2RLoader,
  installD2RLoaderArchive,
} from '../main/worker/D2RLoaderInstaller';

function writeArchive(
  archivePath: string,
  files: Record<string, string>,
): void {
  writeFileSync(
    archivePath,
    Buffer.from(
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([filePath, content]) => [
            filePath,
            strToU8(content),
          ]),
        ),
      ),
    ),
  );
}

describe('D2RLoader installer', () => {
  const originalSetImmediate = global.setImmediate;
  let testRoot: string;

  beforeAll(() => {
    global.setImmediate = nodeSetImmediate;
  });

  afterAll(() => {
    global.setImmediate = originalSetImmediate;
  });

  beforeEach(() => {
    testRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-loader-test-'));
  });

  afterEach(() => {
    rmSync(testRoot, { force: true, recursive: true });
  });

  it('overlays the release into the game directory and preserves other plugins', async () => {
    const gameRoot = path.join(testRoot, 'game');
    const archivePath = path.join(testRoot, 'D2RLoader.zip');
    mkdirSync(path.join(gameRoot, 'd2rloader', 'plugins'), { recursive: true });
    writeFileSync(path.join(gameRoot, 'D2R.exe'), 'game');
    writeFileSync(path.join(gameRoot, 'D2RCore.dll'), 'old core');
    writeFileSync(
      path.join(gameRoot, 'd2rloader', 'plugins', 'Custom.dll'),
      'custom plugin',
    );
    writeArchive(archivePath, {
      'D2RLoader.exe': 'loader',
      'D2RCore.dll': 'new core',
      'd2rloader/config/d2rloader.toml': '[d2rloader]',
      'd2rloader/crashes/': '',
      'd2rloader/data/': '',
      'd2rloader/logs/': '',
      'd2rloader/plugins/': '',
    });

    await installD2RLoaderArchive(gameRoot, archivePath, testRoot);

    expect(readFileSync(path.join(gameRoot, 'D2RLoader.exe'), 'utf8')).toBe(
      'loader',
    );
    expect(readFileSync(path.join(gameRoot, 'D2RCore.dll'), 'utf8')).toBe(
      'new core',
    );
    expect(
      readFileSync(
        path.join(gameRoot, 'd2rloader', 'plugins', 'Custom.dll'),
        'utf8',
      ),
    ).toBe('custom plugin');
    for (const directory of ['crashes', 'data', 'logs', 'plugins']) {
      expect(
        statSync(path.join(gameRoot, 'd2rloader', directory)).isDirectory(),
      ).toBe(true);
    }
  });

  it('downloads the latest release with redirects enabled before installing', async () => {
    const gameRoot = path.join(testRoot, 'game');
    const archivePath = path.join(testRoot, 'D2RLoader.zip');
    mkdirSync(gameRoot);
    writeFileSync(path.join(gameRoot, 'D2R.exe'), 'game');
    writeArchive(archivePath, {
      'D2RLoader.exe': 'loader',
      'D2RCore.dll': 'core',
      'd2rloader/config/d2rloader.toml': '[d2rloader]',
    });
    const archive = readFileSync(archivePath);
    const archiveBuffer = archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength,
    ) as ArrayBuffer;
    const fetchRelease = jest.fn(
      async () =>
        ({
          arrayBuffer: async () => archiveBuffer,
          ok: true,
          status: 200,
          statusText: 'OK',
        }) as Response,
    ) as unknown as typeof fetch;

    await expect(
      downloadAndInstallD2RLoader(gameRoot, fetchRelease),
    ).resolves.toMatchObject({ status: 'installed' });

    expect(fetchRelease).toHaveBeenCalledWith(D2R_LOADER_DOWNLOAD_URL, {
      redirect: 'follow',
    });
    expect(existsSync(path.join(gameRoot, 'D2RLoader.exe'))).toBe(true);
  });

  it('rejects an archive missing required release files before changing the game', async () => {
    const gameRoot = path.join(testRoot, 'game');
    const archivePath = path.join(testRoot, 'D2RLoader.zip');
    mkdirSync(gameRoot);
    writeFileSync(path.join(gameRoot, 'D2R.exe'), 'game');
    writeArchive(archivePath, { 'unexpected.txt': 'not a release' });

    await expect(
      installD2RLoaderArchive(gameRoot, archivePath, testRoot),
    ).rejects.toThrow('missing required file');

    expect(existsSync(path.join(gameRoot, 'unexpected.txt'))).toBe(false);
    expect(existsSync(path.join(gameRoot, 'D2RLoader.exe'))).toBe(false);
  });

  it('does not overwrite files when the installed loader version is current', async () => {
    const gameRoot = path.join(testRoot, 'game');
    const archivePath = path.join(testRoot, 'D2RLoader.zip');
    mkdirSync(path.join(gameRoot, 'd2rloader', 'config'), { recursive: true });
    writeFileSync(path.join(gameRoot, 'D2R.exe'), 'game');
    writeFileSync(path.join(gameRoot, 'D2RLoader.exe'), 'installed loader');
    writeFileSync(path.join(gameRoot, 'D2RCore.dll'), 'installed core');
    writeArchive(archivePath, {
      'D2RLoader.exe': 'release loader with different bytes',
      'D2RCore.dll': 'release core',
      'd2rloader/config/d2rloader.toml': '[d2rloader]',
      'd2rloader/crashes/': '',
      'd2rloader/data/': '',
      'd2rloader/logs/': '',
      'd2rloader/plugins/': '',
    });

    const result = await installD2RLoaderArchive(
      gameRoot,
      archivePath,
      testRoot,
      () => '1.0.1.0',
    );

    expect(result).toEqual({
      status: 'already-current',
      version: '1.0.1.0',
    });
    expect(readFileSync(path.join(gameRoot, 'D2RLoader.exe'), 'utf8')).toBe(
      'installed loader',
    );
    expect(readFileSync(path.join(gameRoot, 'D2RCore.dll'), 'utf8')).toBe(
      'installed core',
    );
    expect(
      readFileSync(
        path.join(gameRoot, 'd2rloader', 'config', 'd2rloader.toml'),
        'utf8',
      ),
    ).toBe('[d2rloader]');
    for (const directory of ['crashes', 'data', 'logs', 'plugins']) {
      expect(
        statSync(path.join(gameRoot, 'd2rloader', directory)).isDirectory(),
      ).toBe(true);
    }
  });

  it('rejects a destination that does not contain D2R.exe', async () => {
    const gameRoot = path.join(testRoot, 'not-a-game');
    const archivePath = path.join(testRoot, 'D2RLoader.zip');
    mkdirSync(gameRoot);
    writeArchive(archivePath, {
      'D2RLoader.exe': 'loader',
      'D2RCore.dll': 'core',
      'd2rloader/config/d2rloader.toml': '[d2rloader]',
    });

    await expect(
      installD2RLoaderArchive(gameRoot, archivePath, testRoot),
    ).rejects.toThrow('does not contain D2R.exe');
  });
});
