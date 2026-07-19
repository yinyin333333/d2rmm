import type decompress from 'decompress';
import { createHash } from 'crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import {
  createModInstallTempDirectory,
  findModInfo,
  getValidatedModInstallPath,
  normalizeZipDirectoryEntry,
  replaceModDirectoryAtomically,
  withModInstallLock,
} from '../main/worker/ModUpdaterAPI';

function hashDirectory(rootPath: string): string {
  const hash = createHash('sha256');

  function visit(directoryPath: string, relativePath: string): void {
    const names = readdirSync(directoryPath).sort();
    for (const name of names) {
      const filePath = path.join(directoryPath, name);
      const childRelativePath = path.join(relativePath, name);
      if (statSync(filePath).isDirectory()) {
        hash.update(`directory:${childRelativePath}\0`);
        visit(filePath, childRelativePath);
      } else {
        hash.update(`file:${childRelativePath}\0`);
        hash.update(readFileSync(filePath));
      }
    }
  }

  visit(rootPath, '');
  return hash.digest('hex');
}

describe('ModUpdaterAPI atomic mod directory replacement', () => {
  let tempRoot: string;
  let fakeAppRoot: string;
  let modsRoot: string;
  let sourceRoot: string;
  let destinationRoot: string;
  let sentinelPath: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-mod-replace-'));
    fakeAppRoot = path.join(tempRoot, 'app');
    modsRoot = path.join(fakeAppRoot, 'mods');
    sourceRoot = path.join(tempRoot, 'incoming', 'Example');
    destinationRoot = path.join(modsRoot, 'Example');
    sentinelPath = path.join(tempRoot, 'outside', 'sentinel.txt');

    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(destinationRoot, { recursive: true });
    mkdirSync(path.dirname(sentinelPath), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'mod.json'), '{"name":"new"}');
    writeFileSync(path.join(sourceRoot, 'new.txt'), 'new tree');
    writeFileSync(path.join(sourceRoot, 'config.json'), 'new config');
    writeFileSync(path.join(destinationRoot, 'mod.json'), '{"name":"old"}');
    writeFileSync(path.join(destinationRoot, 'old.txt'), 'old tree');
    writeFileSync(path.join(destinationRoot, 'config.json'), 'old config');
    writeFileSync(sentinelPath, 'outside sentinel');
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function expectSentinelUnchanged(): void {
    expect(readFileSync(sentinelPath, 'utf8')).toBe('outside sentinel');
  }

  function expectNoReplacementArtifacts(): void {
    expect(readdirSync(modsRoot).sort()).toEqual(['Example']);
  }

  it.each([
    ['source equals destination', 'same'],
    ['source is an ancestor of destination', 'source-ancestor'],
    ['destination is an ancestor of source', 'destination-ancestor'],
  ])('rejects overlap when %s without deleting either tree', (_label, kind) => {
    let sourcePath = sourceRoot;
    const destinationPath = destinationRoot;

    if (kind === 'same') {
      sourcePath = destinationRoot;
    } else if (kind === 'source-ancestor') {
      sourcePath = modsRoot;
    } else {
      sourcePath = path.join(destinationRoot, 'nested-source');
      mkdirSync(sourcePath, { recursive: true });
      writeFileSync(path.join(sourcePath, 'mod.json'), '{"name":"nested"}');
    }

    const sourceHash = hashDirectory(sourcePath);
    const destinationHash = hashDirectory(destinationPath);

    expect(() =>
      replaceModDirectoryAtomically(sourcePath, destinationPath),
    ).toThrow(/overlap/i);
    expect(existsSync(sourcePath)).toBe(true);
    expect(existsSync(destinationPath)).toBe(true);
    expect(hashDirectory(sourcePath)).toBe(sourceHash);
    expect(hashDirectory(destinationPath)).toBe(destinationHash);
    expectSentinelUnchanged();
  });

  it.each(['copy', 'config', 'swap'] as const)(
    'restores the previous tree and config after an injected %s failure',
    (failureOperation) => {
      const sourceHash = hashDirectory(sourceRoot);
      const destinationHash = hashDirectory(destinationRoot);

      expect(() =>
        replaceModDirectoryAtomically(
          sourceRoot,
          destinationRoot,
          (operation) => {
            if (operation === failureOperation) {
              throw new Error(`injected ${operation} failure`);
            }
          },
        ),
      ).toThrow(`injected ${failureOperation} failure`);

      expect(hashDirectory(sourceRoot)).toBe(sourceHash);
      expect(hashDirectory(destinationRoot)).toBe(destinationHash);
      expect(readFileSync(path.join(destinationRoot, 'config.json'), 'utf8')).toBe(
        'old config',
      );
      expectNoReplacementArtifacts();
      expectSentinelUnchanged();
    },
  );

  it('commits a complete new tree while preserving the existing config', () => {
    replaceModDirectoryAtomically(sourceRoot, destinationRoot);

    expect(existsSync(path.join(destinationRoot, 'old.txt'))).toBe(false);
    expect(readFileSync(path.join(destinationRoot, 'new.txt'), 'utf8')).toBe(
      'new tree',
    );
    expect(readFileSync(path.join(destinationRoot, 'config.json'), 'utf8')).toBe(
      'old config',
    );
    expect(existsSync(sourceRoot)).toBe(true);
    expectNoReplacementArtifacts();
    expectSentinelUnchanged();
  });
});

describe('ModUpdaterAPI ZIP mod ID validation', () => {
  const fakeAppRoot = path.join(os.tmpdir(), 'd2rmm-fake-app');
  const modsRoot = path.join(fakeAppRoot, 'mods');

  function getInstallPathForZipName(zipName: string): string {
    const modID = path.basename(zipName, '.zip');
    return getValidatedModInstallPath(fakeAppRoot, modID);
  }

  it.each([
    ['Foo.zip', 'Foo'],
    ['한글 모드.zip', '한글 모드'],
    ['Mod With Spaces.zip', 'Mod With Spaces'],
  ])('accepts a normal ZIP basename: %s', (zipName, modID) => {
    const destination = getInstallPathForZipName(zipName);

    expect(destination).toBe(path.join(modsRoot, modID));
    expect(path.dirname(destination)).toBe(modsRoot);
  });

  it.each(['.zip', '..zip', '...zip'])(
    'rejects a ZIP basename that resolves to no safe mod ID: %s',
    (zipName) => {
      expect(() => getInstallPathForZipName(zipName)).toThrow(
        /invalid mod id/i,
      );
    },
  );

  it.each([
    '',
    '.',
    '..',
    'nested/mod',
    'nested\\mod',
    'C:\\absolute',
    'C:/absolute',
    '/absolute',
    '\\\\server\\share\\mod',
    'trailing.',
    'trailing ',
    'CON',
    'prn',
    'AUX',
    'nul',
    'COM1',
    'lpt9',
    'CON.txt',
  ])('rejects an unsafe mod ID before destination use: %s', (modID) => {
    expect(() => getValidatedModInstallPath(fakeAppRoot, modID)).toThrow(
      /invalid mod id/i,
    );
  });

  it('never resolves a destination outside or below a direct child of mods', () => {
    expect(() =>
      getValidatedModInstallPath(fakeAppRoot, '../mods-sibling'),
    ).toThrow(/invalid mod id/i);
    expect(() =>
      getValidatedModInstallPath(fakeAppRoot, 'parent/child'),
    ).toThrow(/invalid mod id/i);
  });
});

describe('ModUpdaterAPI concurrent mod installation isolation', () => {
  let tempRoot: string;
  let fakeAppRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-mod-lock-'));
    fakeAppRoot = path.join(tempRoot, 'app');
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  it('creates a unique temp tree for every install invocation', () => {
    const firstPath = createModInstallTempDirectory(tempRoot);
    const secondPath = createModInstallTempDirectory(tempRoot);

    expect(firstPath).not.toBe(secondPath);
    expect(path.dirname(firstPath)).toBe(
      path.join(tempRoot, 'D2RMM', 'ModInstall'),
    );
    expect(path.dirname(secondPath)).toBe(path.dirname(firstPath));

    writeFileSync(path.join(firstPath, 'first.txt'), 'first install');
    writeFileSync(path.join(secondPath, 'second.txt'), 'second install');
    rmSync(firstPath, { force: true, recursive: true });

    expect(existsSync(firstPath)).toBe(false);
    expect(readFileSync(path.join(secondPath, 'second.txt'), 'utf8')).toBe(
      'second install',
    );
  });

  it('serializes the complete install operation for the same mod ID', async () => {
    const events: string[] = [];
    let signalFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withModInstallLock(fakeAppRoot, 'Reimagined', async () => {
      events.push('first:start');
      signalFirstStarted();
      await firstGate;
      events.push('first:end');
    });
    await firstStarted;

    const second = withModInstallLock(fakeAppRoot, 'Reimagined', async () => {
      events.push('second:start');
      events.push('second:end');
    });

    try {
      await Promise.resolve();
      expect(events).toEqual(['first:start']);
    } finally {
      releaseFirst();
    }

    await Promise.all([first, second]);
    expect(events).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });

  it('does not block installation of a different mod ID', async () => {
    let signalFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withModInstallLock(fakeAppRoot, 'Reimagined', async () => {
      signalFirstStarted();
      await firstGate;
    });
    await firstStarted;

    try {
      await expect(
        withModInstallLock(fakeAppRoot, 'AnotherMod', async () => 'installed'),
      ).resolves.toBe('installed');
    } finally {
      releaseFirst();
    }
    await first;
  });

  it('releases a same-mod install lock after a failed operation', async () => {
    await expect(
      withModInstallLock(fakeAppRoot, 'Reimagined', async () => {
        throw new Error('injected install failure');
      }),
    ).rejects.toThrow('injected install failure');

    await expect(
      withModInstallLock(fakeAppRoot, 'Reimagined', async () => 'recovered'),
    ).resolves.toBe('recovered');
  });
});

describe('ModUpdaterAPI.findModInfo', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-mod-import-'));
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  it('keeps a data mod wrapper when d2rloader is next to the mpq folder', () => {
    const modRoot = path.join(tempDir, 'Reimagined');
    mkdirSync(path.join(modRoot, 'Reimagined.mpq', 'data'), { recursive: true });
    mkdirSync(path.join(modRoot, 'd2rloader', 'plugins'), { recursive: true });
    writeFileSync(path.join(modRoot, 'Reimagined.mpq', 'modinfo.json'), '{}');

    expect(findModInfo(modRoot)).toBe(modRoot);
  });

  it('keeps existing mpq-only data mod detection', () => {
    const modRoot = path.join(tempDir, 'Reimagined');
    const mpqRoot = path.join(modRoot, 'Reimagined.mpq');
    mkdirSync(path.join(mpqRoot, 'data'), { recursive: true });
    writeFileSync(path.join(mpqRoot, 'modinfo.json'), '{}');

    expect(findModInfo(modRoot)).toBe(mpqRoot);
  });

  it('finds a nested data mod wrapper', () => {
    const outerRoot = path.join(tempDir, 'outer');
    const modRoot = path.join(outerRoot, 'Reimagined');
    mkdirSync(path.join(modRoot, 'Reimagined.mpq', 'data'), { recursive: true });
    mkdirSync(path.join(modRoot, 'd2rloader'), { recursive: true });
    writeFileSync(path.join(modRoot, 'Reimagined.mpq', 'modinfo.json'), '{}');

    expect(findModInfo(outerRoot)).toBe(modRoot);
  });

  it('normalizes slash-terminated zip entries as directories', () => {
    const entry: decompress.File = {
      data: Buffer.alloc(0),
      mode: 0o644,
      mtime: new Date().toISOString(),
      path: 'Visuals/Visuals.mpq/',
      type: 'file',
    };

    expect(normalizeZipDirectoryEntry(entry)).toEqual({
      ...entry,
      type: 'directory',
    });
  });
});
