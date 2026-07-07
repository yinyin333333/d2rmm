import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  getDataModEntryDestinationRelative,
  getDataModRootPath,
} from '../main/worker/ModAPI';

describe('D2RMM.copyDataModFiles destination mapping', () => {
  it('keeps data files inside the MPQ data root', () => {
    expect(getDataModEntryDestinationRelative('data', false)).toBe('');
  });

  it('keeps ordinary root siblings at the MPQ root', () => {
    expect(getDataModEntryDestinationRelative('hd', false)).toBe(
      path.join('..', 'hd'),
    );
  });

  it('writes D2RLoader folders to the output mod root', () => {
    expect(getDataModEntryDestinationRelative('d2rloader', false)).toBe(
      path.join('..', '..', 'd2rloader'),
    );
  });

  it('writes D2RLoader folders to the game root in direct mode', () => {
    expect(getDataModEntryDestinationRelative('d2rloader', true)).toBe(
      path.join('..', 'd2rloader'),
    );
  });
});

describe('D2RMM data mod root detection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-data-mod-'));
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  it('recognizes data mods with data directly under the mod folder', () => {
    const modRoot = path.join(tempDir, 'Reimagined');
    mkdirSync(path.join(modRoot, 'data'), { recursive: true });

    expect(getDataModRootPath(modRoot)).toBe(modRoot);
  });

  it('recognizes imported data mods with an mpq child and d2rloader sibling', () => {
    const modRoot = path.join(tempDir, 'Reimagined');
    const mpqRoot = path.join(modRoot, 'Reimagined.mpq');
    mkdirSync(path.join(mpqRoot, 'data'), { recursive: true });
    mkdirSync(path.join(modRoot, 'd2rloader', 'plugins'), { recursive: true });
    writeFileSync(path.join(mpqRoot, 'modinfo.json'), '{}');

    expect(getDataModRootPath(modRoot)).toBe(mpqRoot);
  });

  it('does not treat an mpq child without data as a data mod', () => {
    const modRoot = path.join(tempDir, 'Reimagined');
    const mpqRoot = path.join(modRoot, 'Reimagined.mpq');
    mkdirSync(mpqRoot, { recursive: true });
    writeFileSync(path.join(mpqRoot, 'modinfo.json'), '{}');

    expect(getDataModRootPath(modRoot)).toBeNull();
  });
});
