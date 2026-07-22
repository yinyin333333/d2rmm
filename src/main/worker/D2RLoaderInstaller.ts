import type { D2RLoaderInstallResult } from 'bridge/BridgeAPI';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import decompress from 'decompress';
import {
  copyFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { withNoAsar } from './NoAsarScope';
import { resolvePathInsideRoot } from './PathSafety';

export const D2R_LOADER_DOWNLOAD_URL = 'https://d2rloader.net/downloads/latest';

const REQUIRED_ARCHIVE_FILES = [
  'D2RLoader.exe',
  'D2RCore.dll',
  path.join('d2rloader', 'config', 'd2rloader.toml'),
];

type ExtractedEntry = {
  relativePath: string;
  sourcePath: string;
  type: 'directory' | 'file';
};

export type D2RLoaderVersionReader = (filePath: string) => string | null;

function normalizeFileVersion(rawVersion: string): string | null {
  const match = rawVersion.match(/\d+(?:\s*[.,]\s*\d+){1,3}/);
  return match == null ? null : match[0].replace(/\s+/g, '').replace(/,/g, '.');
}

export function readWindowsFileVersion(filePath: string): string | null {
  if (process.platform !== 'win32') return null;

  const result = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Diagnostics.FileVersionInfo]::GetVersionInfo($env:D2RMM_VERSION_FILE).FileVersion',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, D2RMM_VERSION_FILE: filePath },
      timeout: 10_000,
      windowsHide: true,
    },
  );
  if (result.status !== 0 || result.error != null) return null;
  return normalizeFileVersion(result.stdout);
}

function compareFileVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function filesMatch(leftPath: string, rightPath: string): boolean {
  if (statSync(leftPath).size !== statSync(rightPath).size) return false;
  const digest = (filePath: string): string =>
    createHash('sha256').update(readFileSync(filePath)).digest('hex');
  return digest(leftPath) === digest(rightPath);
}

function validateArchiveEntry(file: decompress.File): decompress.File {
  const archivePath = file.path;
  const normalizedPath = archivePath.endsWith('/')
    ? archivePath.slice(0, -1)
    : archivePath;
  const segments = normalizedPath.split('/');

  if (
    normalizedPath.length === 0 ||
    archivePath.includes('\\') ||
    archivePath.includes('\0') ||
    path.posix.isAbsolute(archivePath) ||
    path.win32.isAbsolute(archivePath) ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        /[<>:"|?*]/.test(segment) ||
        Array.from(segment).some((character) => character.charCodeAt(0) < 32),
    ) ||
    (file.type !== 'file' && file.type !== 'directory')
  ) {
    throw new Error(`Unsafe path in D2RLoader archive: "${archivePath}".`);
  }

  return archivePath.endsWith('/') ? { ...file, type: 'directory' } : file;
}

function collectExtractedEntries(
  extractRoot: string,
  currentPath: string = extractRoot,
): ExtractedEntry[] {
  const entries: ExtractedEntry[] = [];

  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const sourcePath = path.join(currentPath, entry.name);
    const relativePath = path.relative(extractRoot, sourcePath);
    resolvePathInsideRoot(extractRoot, extractRoot, relativePath);

    if (entry.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are not allowed in the D2RLoader archive: "${relativePath}".`,
      );
    }
    if (entry.isDirectory()) {
      entries.push({ relativePath, sourcePath, type: 'directory' });
      entries.push(...collectExtractedEntries(extractRoot, sourcePath));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `Unsupported entry in the D2RLoader archive: "${relativePath}".`,
      );
    }
    entries.push({ relativePath, sourcePath, type: 'file' });
  }

  return entries;
}

function validateExtractedArchive(extractRoot: string): ExtractedEntry[] {
  for (const requiredPath of REQUIRED_ARCHIVE_FILES) {
    const candidatePath = resolvePathInsideRoot(
      extractRoot,
      extractRoot,
      requiredPath,
    );
    if (!existsSync(candidatePath) || !statSync(candidatePath).isFile()) {
      throw new Error(
        `The D2RLoader archive is missing required file "${requiredPath}".`,
      );
    }
  }

  return collectExtractedEntries(extractRoot);
}

function ensureMissingExtractedEntries(
  gameRoot: string,
  entries: ExtractedEntry[],
): void {
  const directories = entries.filter((entry) => entry.type === 'directory');
  const files = entries.filter((entry) => entry.type === 'file');

  for (const entry of directories) {
    const targetPath = resolvePathInsideRoot(
      gameRoot,
      gameRoot,
      entry.relativePath,
    );
    if (existsSync(targetPath)) {
      const target = lstatSync(targetPath);
      if (target.isSymbolicLink() || !target.isDirectory()) {
        throw new Error(
          `D2RLoader install path is not a safe directory: "${targetPath}".`,
        );
      }
    } else {
      mkdirSync(targetPath, { recursive: true });
    }
  }

  for (const entry of files) {
    const targetPath = resolvePathInsideRoot(
      gameRoot,
      gameRoot,
      entry.relativePath,
    );
    if (existsSync(targetPath)) continue;
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(entry.sourcePath, targetPath);
  }
}

function overlayExtractedFiles(
  gameRoot: string,
  backupRoot: string,
  entries: ExtractedEntry[],
): void {
  const directories = entries.filter((entry) => entry.type === 'directory');
  const files = entries.filter((entry) => entry.type === 'file');
  const existingFiles = new Set<string>();
  const createdDirectories: string[] = [];

  for (const entry of entries) {
    const targetPath = resolvePathInsideRoot(
      gameRoot,
      gameRoot,
      entry.relativePath,
    );
    if (!existsSync(targetPath)) continue;

    const target = lstatSync(targetPath);
    if (target.isSymbolicLink()) {
      throw new Error(
        `Refusing to install through symbolic link "${targetPath}".`,
      );
    }
    if (
      (entry.type === 'directory' && !target.isDirectory()) ||
      (entry.type === 'file' && !target.isFile())
    ) {
      throw new Error(
        `D2RLoader install path has the wrong type: "${targetPath}".`,
      );
    }
  }

  for (const entry of files) {
    const targetPath = resolvePathInsideRoot(
      gameRoot,
      gameRoot,
      entry.relativePath,
    );
    if (!existsSync(targetPath)) continue;

    const backupPath = resolvePathInsideRoot(
      backupRoot,
      backupRoot,
      entry.relativePath,
    );
    mkdirSync(path.dirname(backupPath), { recursive: true });
    copyFileSync(targetPath, backupPath);
    existingFiles.add(entry.relativePath);
  }

  try {
    for (const entry of directories) {
      const targetPath = resolvePathInsideRoot(
        gameRoot,
        gameRoot,
        entry.relativePath,
      );
      if (!existsSync(targetPath)) {
        mkdirSync(targetPath);
        createdDirectories.push(targetPath);
      }
    }

    for (const entry of files) {
      const targetPath = resolvePathInsideRoot(
        gameRoot,
        gameRoot,
        entry.relativePath,
      );
      mkdirSync(path.dirname(targetPath), { recursive: true });
      copyFileSync(entry.sourcePath, targetPath);
    }
  } catch (error) {
    for (const entry of files) {
      const targetPath = resolvePathInsideRoot(
        gameRoot,
        gameRoot,
        entry.relativePath,
      );
      if (existingFiles.has(entry.relativePath)) {
        const backupPath = resolvePathInsideRoot(
          backupRoot,
          backupRoot,
          entry.relativePath,
        );
        copyFileSync(backupPath, targetPath);
      } else {
        rmSync(targetPath, { force: true });
      }
    }
    for (const directoryPath of createdDirectories.reverse()) {
      rmSync(directoryPath, { force: true });
    }
    throw error;
  }
}

function validateZipSignature(archivePath: string): void {
  const signature = Buffer.alloc(4);
  const archiveFile = openSync(archivePath, 'r');
  try {
    readSync(archiveFile, signature, 0, signature.length, 0);
  } finally {
    closeSync(archiveFile);
  }
  const isZip =
    signature.length === 4 &&
    signature[0] === 0x50 &&
    signature[1] === 0x4b &&
    ((signature[2] === 0x03 && signature[3] === 0x04) ||
      (signature[2] === 0x05 && signature[3] === 0x06) ||
      (signature[2] === 0x07 && signature[3] === 0x08));
  if (!isZip) {
    throw new Error('The D2RLoader download is not a valid ZIP archive.');
  }
}

export async function installD2RLoaderArchive(
  gamePath: string,
  archivePath: string,
  tempBasePath: string = os.tmpdir(),
  readVersion: D2RLoaderVersionReader = readWindowsFileVersion,
): Promise<D2RLoaderInstallResult> {
  const gameRoot = path.resolve(gamePath);
  const gameExePath = resolvePathInsideRoot(gameRoot, gameRoot, 'D2R.exe');
  if (!existsSync(gameExePath) || !statSync(gameExePath).isFile()) {
    throw new Error(
      `The selected game directory does not contain D2R.exe: "${gameRoot}".`,
    );
  }

  validateZipSignature(archivePath);

  const tempRoot = path.join(tempBasePath, 'D2RMM', 'D2RLoaderInstall');
  mkdirSync(tempRoot, { recursive: true });
  const workRoot = mkdtempSync(path.join(tempRoot, `${process.pid}-`));
  const extractRoot = path.join(workRoot, 'extracted');
  const backupRoot = path.join(workRoot, 'backup');
  mkdirSync(extractRoot);
  mkdirSync(backupRoot);

  try {
    await withNoAsar(() =>
      decompress(archivePath, extractRoot, { map: validateArchiveEntry }),
    );
    const entries = validateExtractedArchive(extractRoot);
    const installedLoaderPath = resolvePathInsideRoot(
      gameRoot,
      gameRoot,
      'D2RLoader.exe',
    );
    const releaseLoaderPath = resolvePathInsideRoot(
      extractRoot,
      extractRoot,
      'D2RLoader.exe',
    );
    const releaseVersion = readVersion(releaseLoaderPath);
    if (
      existsSync(installedLoaderPath) &&
      statSync(installedLoaderPath).isFile()
    ) {
      const installedVersion = readVersion(installedLoaderPath);
      const isCurrentVersion =
        installedVersion != null &&
        releaseVersion != null &&
        compareFileVersions(installedVersion, releaseVersion) >= 0;
      if (
        isCurrentVersion ||
        filesMatch(installedLoaderPath, releaseLoaderPath)
      ) {
        ensureMissingExtractedEntries(gameRoot, entries);
        return {
          status: 'already-current',
          version: installedVersion ?? releaseVersion,
        };
      }
    }
    overlayExtractedFiles(gameRoot, backupRoot, entries);
    return { status: 'installed', version: releaseVersion };
  } finally {
    rmSync(workRoot, { force: true, recursive: true });
  }
}

export async function downloadAndInstallD2RLoader(
  gamePath: string,
  fetchRelease: typeof fetch = fetch,
): Promise<D2RLoaderInstallResult> {
  const downloadRoot = path.join(os.tmpdir(), 'D2RMM', 'D2RLoaderDownload');
  mkdirSync(downloadRoot, { recursive: true });
  const workRoot = mkdtempSync(path.join(downloadRoot, `${process.pid}-`));
  const filePath = path.join(workRoot, 'D2RLoader-latest.zip');
  try {
    const response = await fetchRelease(D2R_LOADER_DOWNLOAD_URL, {
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(
        `D2RLoader download failed with HTTP ${response.status} ${response.statusText}.`,
      );
    }
    writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
    return await installD2RLoaderArchive(gamePath, filePath);
  } finally {
    rmSync(workRoot, { force: true, recursive: true });
  }
}
