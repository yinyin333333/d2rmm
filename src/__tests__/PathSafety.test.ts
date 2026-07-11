import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import type { IInstallModsOptions } from '../bridge/BridgeAPI';
import {
  getModOutputEnvelopePath,
  resolveModOutputPath,
} from '../main/worker/PathSafety';

describe('mod output path containment', () => {
  let tempRoot: string;
  let gameRoot: string;
  let outsideRoot: string;
  let sentinelPath: string;
  let options: IInstallModsOptions;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-path-safety-'));
    gameRoot = path.join(tempRoot, 'Game');
    outsideRoot = path.join(tempRoot, 'outside');
    sentinelPath = path.join(outsideRoot, 'sentinel.txt');

    mkdirSync(path.join(gameRoot, 'data'), { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    writeFileSync(sentinelPath, 'outside-sentinel');

    options = {
      gamePath: gameRoot,
      isDryRun: false,
      isPreExtractedData: true,
      mergedPath: path.join(gameRoot, 'mods', 'Merged', 'Merged.mpq', 'data'),
      normalizeOutputCRLF: false,
      outputModName: 'Merged',
      preExtractedDataPath: path.join(tempRoot, 'pre-extracted'),
      savesPath: path.join(tempRoot, 'saves'),
    };

    mkdirSync(options.mergedPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function expectSentinelUnchanged(): void {
    expect(readFileSync(sentinelPath, 'utf8')).toBe('outside-sentinel');
  }

  it('preserves normal and intentional mod output locations', () => {
    expect(resolveModOutputPath(options, 'global/excel/foo.txt')).toBe(
      path.join(options.mergedPath, 'global', 'excel', 'foo.txt'),
    );
    expect(
      resolveModOutputPath(options, path.join('..', 'hd', 'foo.json')),
    ).toBe(
      path.join(gameRoot, 'mods', 'Merged', 'Merged.mpq', 'hd', 'foo.json'),
    );
    expect(
      resolveModOutputPath(
        options,
        path.join('..', '..', 'd2rloader', 'plugin.dll'),
      ),
    ).toBe(path.join(gameRoot, 'mods', 'Merged', 'd2rloader', 'plugin.dll'));
  });

  it('ignores legacy Direct Mode fields and stays inside the mod envelope', () => {
    const legacyOptions = {
      ...options,
      dataPath: path.join(gameRoot, 'data'),
      isDirectMode: true,
    } as IInstallModsOptions;

    expect(getModOutputEnvelopePath(legacyOptions)).toBe(
      path.join(gameRoot, 'mods', 'Merged'),
    );
    expect(resolveModOutputPath(legacyOptions, 'global/excel/foo.txt')).toBe(
      path.join(options.mergedPath, 'global', 'excel', 'foo.txt'),
    );
    expect(
      resolveModOutputPath(
        legacyOptions,
        path.join('..', '..', 'd2rloader', 'plugin.dll'),
      ),
    ).toBe(path.join(gameRoot, 'mods', 'Merged', 'd2rloader', 'plugin.dll'));
  });

  it.each([
    [
      'relative traversal',
      () => path.relative(options.mergedPath, sentinelPath),
    ],
    ['absolute path', () => sentinelPath],
    ['POSIX absolute path', () => '/outside/sentinel.txt'],
    ['UNC path', () => '\\\\server\\share\\sentinel.txt'],
    [
      'sibling with the same prefix',
      () =>
        path.relative(
          options.mergedPath,
          path.join(gameRoot, 'mods', 'Merged-other', 'sentinel.txt'),
        ),
    ],
    [
      'the output envelope itself',
      () =>
        path.relative(
          options.mergedPath,
          path.join(gameRoot, 'mods', 'Merged'),
        ),
    ],
  ])('rejects %s without changing the outside sentinel', (_label, getInput) => {
    expect(() => resolveModOutputPath(options, getInput())).toThrow();
    expectSentinelUnchanged();
  });

  it('rejects an existing parent symlink or junction that escapes the envelope', () => {
    const linkPath = path.join(options.mergedPath, 'linked-outside');
    try {
      symlinkSync(
        outsideRoot,
        linkPath,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') {
        expectSentinelUnchanged();
        return;
      }
      throw error;
    }

    expect(() =>
      resolveModOutputPath(options, path.join('linked-outside', 'new.txt')),
    ).toThrow();
    expectSentinelUnchanged();
  });
});
