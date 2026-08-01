import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import {
  createSaveBackupSnapshot,
  formatSaveBackupTimestamp,
  SAVE_BACKUP_DIRECTORY_NAME,
} from '../main/worker/SaveBackup';

describe('save backup snapshots', () => {
  let savesPath: string;

  beforeEach(() => {
    savesPath = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-save-backup-'));
  });

  afterEach(() => {
    rmSync(savesPath, { force: true, recursive: true });
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('copies only top-level regular files into a timestamped snapshot', () => {
    writeFileSync(path.join(savesPath, 'Hero.d2s'), 'hero');
    mkdirSync(path.join(savesPath, 'nested'));
    writeFileSync(path.join(savesPath, 'nested', 'ignored.d2s'), 'ignored');
    mkdirSync(path.join(savesPath, SAVE_BACKUP_DIRECTORY_NAME));
    mkdirSync(
      path.join(savesPath, SAVE_BACKUP_DIRECTORY_NAME, 'previous-backup'),
    );
    writeFileSync(
      path.join(
        savesPath,
        SAVE_BACKUP_DIRECTORY_NAME,
        'previous-backup',
        'old.d2s',
      ),
      'old',
    );

    const snapshotPath = createSaveBackupSnapshot(savesPath);

    expect(path.basename(snapshotPath)).toMatch(
      /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}(?:_\d+)?$/,
    );
    expect(readdirSync(snapshotPath)).toEqual(['Hero.d2s']);
    expect(readFileSync(path.join(snapshotPath, 'Hero.d2s'), 'utf8')).toBe(
      'hero',
    );
    expect(existsSync(path.join(snapshotPath, 'nested'))).toBe(false);
    expect(
      existsSync(path.join(snapshotPath, SAVE_BACKUP_DIRECTORY_NAME)),
    ).toBe(false);
  });

  it('uses a unique name without overwriting a same-millisecond snapshot', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-01T05:30:05.123Z'));
    writeFileSync(path.join(savesPath, 'Hero.d2s'), 'hero');

    const firstSnapshotPath = createSaveBackupSnapshot(savesPath);
    const secondSnapshotPath = createSaveBackupSnapshot(savesPath);

    expect(secondSnapshotPath).not.toBe(firstSnapshotPath);
    expect(existsSync(firstSnapshotPath)).toBe(true);
    expect(existsSync(secondSnapshotPath)).toBe(true);
    expect(readFileSync(path.join(firstSnapshotPath, 'Hero.d2s'), 'utf8')).toBe(
      'hero',
    );
    expect(
      path
        .basename(secondSnapshotPath)
        .startsWith(`${formatSaveBackupTimestamp(new Date())}_`),
    ).toBe(true);
  });

  it('cleans staging files and propagates copy failures', () => {
    writeFileSync(path.join(savesPath, 'Hero.d2s'), 'hero');
    const copySpy = jest
      .spyOn(require('fs'), 'copyFileSync')
      .mockImplementation(() => {
        throw new Error('copy failed');
      });

    expect(() => createSaveBackupSnapshot(savesPath)).toThrow('copy failed');

    const backupsPath = path.join(savesPath, SAVE_BACKUP_DIRECTORY_NAME);
    expect(readdirSync(backupsPath)).toEqual([]);
    expect(copySpy).toHaveBeenCalled();
  });

  it('rejects non-absolute and symlink save roots', () => {
    expect(() => createSaveBackupSnapshot('relative-save-path')).toThrow();

    const outsidePath = mkdtempSync(
      path.join(os.tmpdir(), 'd2rmm-save-backup-outside-'),
    );
    const linkPath = path.join(savesPath, 'linked-saves');
    try {
      require('fs').symlinkSync(
        outsidePath,
        linkPath,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      expect(() => createSaveBackupSnapshot(linkPath)).toThrow();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOTSUP') {
        throw error;
      }
    } finally {
      rmSync(outsidePath, { force: true, recursive: true });
    }
  });
});
