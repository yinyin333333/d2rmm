import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { findModInfo } from '../main/worker/ModUpdaterAPI';

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
});
