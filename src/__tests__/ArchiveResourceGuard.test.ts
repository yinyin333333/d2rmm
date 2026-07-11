import decompress from 'decompress';
import { zipSync } from 'fflate';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { setImmediate as nodeSetImmediate } from 'timers';
import { inspectZipArchive } from '../main/worker/ArchiveResourceGuard';
import type { ResourceLimits } from '../main/worker/ResourceBudget';

describe('ZIP archive resource preflight', () => {
  let tempRoot: string;
  const originalSetImmediate = global.setImmediate;

  beforeAll(() => {
    global.setImmediate = nodeSetImmediate;
  });

  afterAll(() => {
    global.setImmediate = originalSetImmediate;
  });

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-archive-bound-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function writeZip(name: string, entries: Record<string, Uint8Array>): string {
    const zipPath = path.join(tempRoot, name);
    const archiveEntries = Object.fromEntries(
      Object.entries(entries).map(([entryName, data]) => [
        entryName,
        new Uint8Array(data),
      ]),
    );
    writeFileSync(zipPath, Buffer.from(zipSync(archiveEntries, { level: 9 })));
    return zipPath;
  }

  function limits(overrides: Partial<ResourceLimits> = {}): ResourceLimits {
    return {
      maxBytes: 1024 * 1024,
      maxDepth: 16,
      maxEntries: 100,
      ...overrides,
    };
  }

  it('measures a generated normal archive without extracting it', async () => {
    const zipPath = writeZip('normal.zip', {
      'Example/mod.json': Buffer.from('{}'),
      'Example/data/global/excel/test.txt': Buffer.alloc(2048, 0x61),
    });

    const usage = await inspectZipArchive(zipPath, limits());

    expect(usage.entries).toBe(2);
    expect(usage.bytes).toBe(statSync(zipPath).size + 2050);
    expect(usage.maxDepth).toBe(5);
  });

  it('reproduces the current decompressor retaining every entry buffer', async () => {
    const zipPath = writeZip('retention.zip', {
      'Example/mod.json': Buffer.from('{}'),
      'Example/data/global/excel/test.txt': Buffer.alloc(2048, 0x61),
    });

    const files = await decompress(zipPath);
    const retainedBytes = files.reduce(
      (total, file) => total + file.data.length,
      0,
    );

    expect(files).toHaveLength(2);
    expect(retainedBytes).toBe(2050);
  });

  it('rejects high compression ratio input by uncompressed size', async () => {
    const zipPath = writeZip('size.zip', {
      'Example/large.bin': Buffer.alloc(4096, 0),
    });
    const compressedBytes = statSync(zipPath).size;

    await expect(
      inspectZipArchive(zipPath, limits({ maxBytes: compressedBytes + 4095 })),
    ).rejects.toThrow(/byte limit/i);
  });

  it('rejects too many zero-byte entries without extracting any data', async () => {
    const zipPath = writeZip('count.zip', {
      'Example/a': Buffer.alloc(0),
      'Example/b': Buffer.alloc(0),
      'Example/c': Buffer.alloc(0),
    });

    await expect(
      inspectZipArchive(zipPath, limits({ maxEntries: 2 })),
    ).rejects.toThrow(/entry count/i);
  });

  it('rejects excessive archive path depth', async () => {
    const zipPath = writeZip('depth.zip', {
      'a/b/c/d/e/file.txt': Buffer.from('small'),
    });

    await expect(
      inspectZipArchive(zipPath, limits({ maxDepth: 5 })),
    ).rejects.toThrow(/depth limit/i);
  });

  it('rejects case-insensitive duplicate entry paths before extraction', async () => {
    const zipPath = writeZip('duplicate.zip', {
      'Package/Plugin.dll': Buffer.from('first'),
      'package/plugin.DLL': Buffer.from('second'),
    });

    await expect(inspectZipArchive(zipPath, limits())).rejects.toThrow(
      /duplicate.*entry path/i,
    );
  });

  it('rejects repeated separators that extraction could collapse', async () => {
    const zipPath = writeZip('repeated-separator.zip', {
      'Package//Plugin.dll': Buffer.from('plugin'),
    });

    await expect(inspectZipArchive(zipPath, limits())).rejects.toThrow(
      /unsafe.*entry path/i,
    );
  });
});
