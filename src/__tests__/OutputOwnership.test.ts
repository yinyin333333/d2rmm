import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import {
  OUTPUT_OWNERSHIP_MANIFEST,
  removeLegacyOutputOwnershipManifest,
} from '../main/worker/OutputOwnership';

describe('legacy non-direct output ownership manifest cleanup', () => {
  let tempRoot: string;
  let outputRoot: string;
  let outsideSentinel: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-owned-output-'));
    outputRoot = path.join(tempRoot, 'mods', 'FakeOutput');
    outsideSentinel = path.join(tempRoot, 'outside-sentinel.txt');
    mkdirSync(path.join(outputRoot, 'd2rloader', 'plugins'), {
      recursive: true,
    });
    writeFileSync(outsideSentinel, 'outside-must-survive');
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function plugin(name: string): string {
    return path.join(outputRoot, 'd2rloader', 'plugins', name);
  }

  it('does not create a manifest when none exists', () => {
    const current = plugin('current.dll');
    writeFileSync(current, 'current');

    expect(removeLegacyOutputOwnershipManifest(outputRoot)).toEqual({
      removed: false,
      skipped: false,
    });
    expect(existsSync(path.join(outputRoot, OUTPUT_OWNERSHIP_MANIFEST))).toBe(
      false,
    );
    expect(readFileSync(current, 'utf8')).toBe('current');
    expect(readFileSync(outsideSentinel, 'utf8')).toBe('outside-must-survive');
  });

  it('removes an existing legacy manifest without deleting listed files', () => {
    const stale = plugin('stale.dll');
    const user = plugin('user-file.dll');
    const manifestPath = path.join(outputRoot, OUTPUT_OWNERSHIP_MANIFEST);
    writeFileSync(stale, 'stale');
    writeFileSync(user, 'user');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        files: ['d2rloader/plugins/stale.dll'],
        version: 1,
      }),
    );

    expect(removeLegacyOutputOwnershipManifest(outputRoot)).toEqual({
      removed: true,
      skipped: false,
    });
    expect(existsSync(manifestPath)).toBe(false);
    expect(readFileSync(stale, 'utf8')).toBe('stale');
    expect(readFileSync(user, 'utf8')).toBe('user');
    expect(readFileSync(outsideSentinel, 'utf8')).toBe('outside-must-survive');
  });

  it('does not replace or remove a directory with the legacy name', () => {
    const manifestPath = path.join(outputRoot, OUTPUT_OWNERSHIP_MANIFEST);
    mkdirSync(manifestPath);

    expect(removeLegacyOutputOwnershipManifest(outputRoot)).toEqual({
      removed: false,
      skipped: true,
    });
    expect(existsSync(manifestPath)).toBe(true);
    expect(readFileSync(outsideSentinel, 'utf8')).toBe('outside-must-survive');
  });
});
