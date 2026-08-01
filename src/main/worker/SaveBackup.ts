import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'fs';
import path from 'path';

export const SAVE_BACKUP_DIRECTORY_NAME = 'D2RMM Backups';

const STAGING_DIRECTORY_PREFIX = '.d2rmm-backup-';
const SNAPSHOT_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}(?:_\d+)?$/;

let stagingDirectoryCounter = 0;

function padDatePart(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

export function formatSaveBackupTimestamp(date: Date): string {
  return [
    `${date.getFullYear()}-${padDatePart(date.getMonth() + 1, 2)}-${padDatePart(
      date.getDate(),
      2,
    )}`,
    `${padDatePart(date.getHours(), 2)}-${padDatePart(
      date.getMinutes(),
      2,
    )}-${padDatePart(date.getSeconds(), 2)}-${padDatePart(
      date.getMilliseconds(),
      3,
    )}`,
  ].join('_');
}

function isCollisionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EEXIST' || code === 'ENOTEMPTY';
}

function validateSavesDirectory(savesPathInput: string): string {
  if (typeof savesPathInput !== 'string' || savesPathInput.trim() === '') {
    throw new Error('Save backup path must be a non-empty absolute directory.');
  }

  if (!path.isAbsolute(savesPathInput)) {
    throw new Error('Save backup path must be an absolute directory.');
  }

  const savesPath = path.resolve(savesPathInput);
  const savesStats = lstatSync(savesPath);
  if (!savesStats.isDirectory() || savesStats.isSymbolicLink()) {
    throw new Error('Save backup path must be a native directory.');
  }

  return savesPath;
}

function ensureNativeDirectory(directoryPath: string): void {
  if (existsSync(directoryPath)) {
    const directoryStats = lstatSync(directoryPath);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new Error(
        `Backup path is not a native directory: ${directoryPath}`,
      );
    }
    return;
  }

  mkdirSync(directoryPath, { recursive: true });
}

function getSnapshotName(baseName: string, suffix: number): string {
  return suffix === 0 ? baseName : `${baseName}_${suffix}`;
}

function createStagingDirectory(
  backupsPath: string,
  baseName: string,
): { path: string; suffix: number } {
  let suffix = 0;
  while (true) {
    const snapshotName = getSnapshotName(baseName, suffix);
    const snapshotPath = path.join(backupsPath, snapshotName);
    if (existsSync(snapshotPath)) {
      suffix += 1;
      continue;
    }

    const stagingPath = path.join(
      backupsPath,
      `${STAGING_DIRECTORY_PREFIX}${snapshotName}-${process.pid}-${stagingDirectoryCounter++}`,
    );
    try {
      mkdirSync(stagingPath);
      return { path: stagingPath, suffix };
    } catch (error) {
      if (isCollisionError(error)) {
        suffix += 1;
        continue;
      }
      throw error;
    }
  }
}

function copyTopLevelRegularFiles(
  savesPath: string,
  stagingPath: string,
): void {
  for (const entry of readdirSync(savesPath, { withFileTypes: true })) {
    const sourcePath = path.join(savesPath, entry.name);
    const sourceStats = lstatSync(sourcePath);

    // Backups and every other directory are deliberately excluded. Checking
    // lstat rather than stat also prevents symlinks/reparse points from being
    // followed as files.
    if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
      continue;
    }

    copyFileSync(
      sourcePath,
      path.join(stagingPath, entry.name),
      constants.COPYFILE_EXCL,
    );
  }
}

/**
 * Creates one complete save snapshot and returns its final path.
 *
 * Only regular files directly inside `savesPath` are copied. The snapshot is
 * assembled in a hidden staging directory and published with a rename after
 * all copies succeed.
 */
export function createSaveBackupSnapshot(savesPathInput: string): string {
  const savesPath = validateSavesDirectory(savesPathInput);
  const backupsPath = path.join(savesPath, SAVE_BACKUP_DIRECTORY_NAME);
  ensureNativeDirectory(backupsPath);

  const baseName = formatSaveBackupTimestamp(new Date());
  if (!SNAPSHOT_TIMESTAMP_PATTERN.test(baseName)) {
    throw new Error(`Invalid save backup timestamp: ${baseName}`);
  }

  const staging = createStagingDirectory(backupsPath, baseName);
  let stagingPath: string | null = staging.path;

  try {
    copyTopLevelRegularFiles(savesPath, staging.path);

    let suffix = staging.suffix;
    while (true) {
      const snapshotName = getSnapshotName(baseName, suffix);
      const snapshotPath = path.join(backupsPath, snapshotName);
      if (existsSync(snapshotPath)) {
        suffix += 1;
        continue;
      }

      try {
        renameSync(staging.path, snapshotPath);
        stagingPath = null;
        return snapshotPath;
      } catch (error) {
        if (isCollisionError(error)) {
          suffix += 1;
          continue;
        }
        throw error;
      }
    }
  } finally {
    if (stagingPath != null) {
      rmSync(stagingPath, { force: true, recursive: true });
    }
  }
}
