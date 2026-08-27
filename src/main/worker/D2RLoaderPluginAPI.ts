import type {
  D2RLoaderPluginEditableJSON,
  D2RLoaderPluginEditableSource,
  D2RLoaderPluginEditResult,
  D2RLoaderPluginImportResult,
  D2RLoaderPluginInventory,
  D2RLoaderPluginInventoryItem,
  D2RLoaderPluginPackageSummary,
  D2RLoaderPluginSource,
  ID2RLoaderPluginAPI,
} from 'bridge/D2RLoaderPluginAPI';
import { createHash, randomUUID } from 'crypto';
import decompress from 'decompress';
import {
  closeSync,
  copyFileSync,
  cpSync,
  Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import type { Stats } from 'fs';
import os from 'os';
import path from 'path';
import { createD2RLoaderPluginEditConflictError } from 'shared/D2RLoaderPluginEditError';
import { getAppPath } from './AppInfoAPI';
import { inspectZipArchive } from './ArchiveResourceGuard';
import { D2R_LOADER_CONFIG_FILE } from './D2RLoader';
import { inspectD2RLoaderPluginPE } from './D2RLoaderPluginPE';
import { provideAPI } from './IPC';
import type { InstallationRuntime } from './InstallationRuntime';
import { getDataModRootPath } from './ModAPI';
import { withNoAsar } from './NoAsarScope';
import { ResourceBudget, ResourceLimits } from './ResourceBudget';

export const D2R_LOADER_PACKAGES_DIRECTORY = 'd2rloader';
export const D2R_LOADER_LEGACY_PACKAGES_DIRECTORY = 'd2rloader-packages';
export const D2R_LOADER_PACKAGE_MANIFEST = 'manifest.json';

const PACKAGE_SOURCE_DIRECTORY = 'source';
const MANAGED_PACKAGE_OPERATION = 'D2RMM managed D2RLoader package';
const PACKAGE_RESOURCE_LIMITS: ResourceLimits = {
  maxBytes: 512 * 1024 * 1024,
  maxDepth: 64,
  maxEntries: 10_000,
};
const MAX_EDITABLE_TEXT_BYTES = 4 * 1024 * 1024;
const D2R_LOADER_DIRECTORY_README = 'D2RMM-PLUGINS-README.txt';
const D2R_LOADER_MAIN_CONFIG_FILE = D2R_LOADER_CONFIG_FILE.fileName;
const WINDOWS_RESERVED_PACKAGE_NAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_INVALID_PACKAGE_CHARACTERS = /[<>:"/\\|?*]/;

export type D2RLoaderPackageFileRole =
  | 'config'
  | 'data'
  | 'patch'
  | 'plugin'
  | 'support';

const PACKAGE_FILE_ROLES = new Set<D2RLoaderPackageFileRole>([
  'config',
  'data',
  'patch',
  'plugin',
  'support',
]);

export type D2RLoaderPackageTargetRoot = 'd2rloader' | 'data' | null;

export type D2RLoaderPackageFile = {
  role: D2RLoaderPackageFileRole;
  sha256: string;
  sourcePath: string;
  targetPath: string | null;
  targetRoot: D2RLoaderPackageTargetRoot;
};

export type D2RLoaderPackageManifest = {
  files: D2RLoaderPackageFile[];
  importedAt: string;
  name: string;
  version: 1 | 2;
  warnings: string[];
};

export type ManagedD2RLoaderDeploymentFile = {
  data: Buffer;
  packageName: string;
  sha256: string;
  sourcePath: string;
  targetPath: string;
  targetRoot: Exclude<D2RLoaderPackageTargetRoot, null>;
};

type CollectedSourceFile = {
  absolutePath: string;
  relativePath: string;
  sourceRelativePath?: string;
  size: number;
  sourceRoot: string;
};

type PreparedSource = {
  cleanup: () => void;
  files: CollectedSourceFile[];
  packageName: string;
  sourceRootName: string;
};

type StagedPackage = {
  destinationPath: string;
  manifest: D2RLoaderPackageManifest;
  stagingRoot: string;
};

export type D2RLoaderPackageCommitOperation = 'backup' | 'copy' | 'install';

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function hashFile(filePath: string): string {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Cannot hash a non-regular file: "${filePath}".`);
  }
  if (stat.size > PACKAGE_RESOURCE_LIMITS.maxBytes) {
    throw new Error(
      `D2RLoader inventory file exceeds the byte limit: "${filePath}" (${stat.size} > ${PACKAGE_RESOURCE_LIMITS.maxBytes}).`,
    );
  }

  const hash = createHash('sha256');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(filePath, 'r');
  let bytesReadTotal = 0;
  try {
    while (true) {
      const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      bytesReadTotal += bytesRead;
      if (bytesReadTotal > PACKAGE_RESOURCE_LIMITS.maxBytes) {
        throw new Error(
          `D2RLoader inventory file changed beyond the byte limit while reading: "${filePath}".`,
        );
      }
      hash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  if (bytesReadTotal !== stat.size) {
    throw new Error(
      `D2RLoader inventory file changed size while reading: "${filePath}".`,
    );
  }
  return hash.digest('hex');
}

function readBoundedFile(filePath: string): Buffer {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Cannot read a non-regular file: "${filePath}".`);
  }
  if (stat.size > PACKAGE_RESOURCE_LIMITS.maxBytes) {
    throw new Error(
      `D2RLoader package file exceeds the byte limit: "${filePath}" (${stat.size} > ${PACKAGE_RESOURCE_LIMITS.maxBytes}).`,
    );
  }

  const data = Buffer.allocUnsafe(stat.size);
  const descriptor = openSync(filePath, 'r');
  try {
    let offset = 0;
    while (offset < data.length) {
      const bytesRead = readSync(
        descriptor,
        data,
        offset,
        data.length - offset,
        null,
      );
      if (bytesRead === 0) {
        throw new Error(
          `D2RLoader package file changed size while reading: "${filePath}".`,
        );
      }
      offset += bytesRead;
    }
    const extraByte = Buffer.allocUnsafe(1);
    if (readSync(descriptor, extraByte, 0, 1, null) !== 0) {
      throw new Error(
        `D2RLoader package file grew while reading: "${filePath}".`,
      );
    }
    return data;
  } finally {
    closeSync(descriptor);
  }
}

function pathKey(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

function isPluginTOMLPath(filePath: string): boolean {
  // d2rloader.toml is the loader-wide Settings file, never a plugin config.
  return (
    path.extname(filePath).toLowerCase() === '.toml' &&
    path.basename(filePath).toLowerCase() !== D2R_LOADER_MAIN_CONFIG_FILE
  );
}

function isPluginConfigPath(filePath: string): boolean {
  return isPluginTOMLPath(filePath) || /\.jsonc?$/i.test(filePath);
}

function isPreservedDocumentationFile(fileName: string): boolean {
  return /^(?:readme|licen[cs]e|copying|notices?|third[-_ ]party[-_ ]notices?)(?:\.|$)/i.test(
    fileName,
  );
}

function isPreservedDocumentationPath(filePath: string): boolean {
  return isPreservedDocumentationFile(
    filePath
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? '',
  );
}

type FileDirectoryTarget<T> = {
  scope: string;
  targetPath: string;
  value: T;
};

type FileDirectoryTargetConflict<T> = {
  ancestor: FileDirectoryTarget<T>;
  descendant: FileDirectoryTarget<T>;
};

function normalizedTargetPath(targetPath: string): string {
  const normalized = path.posix.normalize(pathKey(targetPath));
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized;
}

function comparePathSegments(first: string[], second: string[]): number {
  for (let index = 0; index < Math.min(first.length, second.length); index++) {
    if (first[index] === second[index]) continue;
    return first[index] < second[index] ? -1 : 1;
  }
  return first.length - second.length;
}

function isSameSegmentPath(first: string[], second: string[]): boolean {
  return (
    first.length === second.length &&
    first.every((segment, index) => segment === second[index])
  );
}

function isSegmentPathAncestor(
  ancestor: string[],
  descendant: string[],
): boolean {
  return (
    ancestor.length < descendant.length &&
    ancestor.every((segment, index) => segment === descendant[index])
  );
}

function findFileDirectoryTargetConflicts<T>(
  targets: FileDirectoryTarget<T>[],
): FileDirectoryTargetConflict<T>[] {
  const sortedTargets = targets
    .map((target) => ({
      ...target,
      normalizedPath: normalizedTargetPath(target.targetPath),
      normalizedScope: pathKey(target.scope),
    }))
    .map((target) => ({
      ...target,
      normalizedSegments: target.normalizedPath.split('/'),
    }))
    .sort((first, second) => {
      if (first.normalizedScope !== second.normalizedScope) {
        return first.normalizedScope < second.normalizedScope ? -1 : 1;
      }
      return comparePathSegments(
        first.normalizedSegments,
        second.normalizedSegments,
      );
    });
  const conflicts: FileDirectoryTargetConflict<T>[] = [];
  const ancestors: typeof sortedTargets = [];
  let currentScope: string | null = null;

  for (const current of sortedTargets) {
    if (current.normalizedScope !== currentScope) {
      ancestors.length = 0;
      currentScope = current.normalizedScope;
    }
    while (ancestors.length > 0) {
      const candidate = ancestors[ancestors.length - 1];
      if (
        isSameSegmentPath(
          candidate.normalizedSegments,
          current.normalizedSegments,
        ) ||
        isSegmentPathAncestor(
          candidate.normalizedSegments,
          current.normalizedSegments,
        )
      ) {
        break;
      }
      ancestors.pop();
    }

    const ancestor = ancestors[ancestors.length - 1];
    if (
      ancestor != null &&
      isSameSegmentPath(ancestor.normalizedSegments, current.normalizedSegments)
    ) {
      // Exact targets are handled separately by their content hashes. Keeping the
      // first entry also makes it the ancestor for any following child target.
      continue;
    }
    if (
      ancestor != null &&
      isSegmentPathAncestor(
        ancestor.normalizedSegments,
        current.normalizedSegments,
      )
    ) {
      conflicts.push({ ancestor, descendant: current });
    }
    ancestors.push(current);
  }

  return conflicts;
}

function getPathDepth(relativePath: string): number {
  return relativePath.replace(/\\/g, '/').split('/').filter(Boolean).length;
}

function isSameOrDescendant(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function resolveInside(rootPath: string, relativePath: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (!isSameOrDescendant(resolvedRoot, resolved)) {
    throw new Error(`Path points outside of managed root: "${relativePath}".`);
  }
  return resolved;
}

type ManagedEntryType = 'directory' | 'file';

function resolveManagedEntry(
  rootPath: string,
  relativePath: string,
  expectedType: ManagedEntryType,
): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (
    relativePath.trim().length === 0 ||
    path.win32.isAbsolute(relativePath) ||
    path.posix.isAbsolute(relativePath) ||
    Array.from(relativePath).some(
      (character) => character.charCodeAt(0) < 32,
    ) ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    throw new Error(`Invalid managed package entry path: "${relativePath}".`);
  }

  const resolvedRoot = path.resolve(rootPath);
  const rootStat = lstatSync(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(
      `Managed package path contains a symbolic link, junction, or reparse point: "${resolvedRoot}".`,
    );
  }

  const candidatePath = resolveInside(resolvedRoot, path.join(...segments));
  let currentPath = resolvedRoot;
  for (let index = 0; index < segments.length; index += 1) {
    currentPath = path.join(currentPath, segments[index]);
    const stat = lstatSync(currentPath);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Managed package path contains a symbolic link, junction, or reparse point: "${currentPath}".`,
      );
    }
    const shouldBeDirectory =
      index < segments.length - 1 || expectedType === 'directory';
    if (
      (shouldBeDirectory && !stat.isDirectory()) ||
      (!shouldBeDirectory && !stat.isFile())
    ) {
      throw new Error(
        `Managed package ${expectedType} is not a regular ${expectedType}: "${currentPath}".`,
      );
    }
  }

  const canonicalRoot = realpathSync.native(resolvedRoot);
  const canonicalCandidate = realpathSync.native(candidatePath);
  const expectedCanonicalCandidate = path.resolve(
    canonicalRoot,
    path.join(...segments),
  );
  if (
    !isSameOrDescendant(canonicalRoot, canonicalCandidate) ||
    pathKey(canonicalCandidate) !== pathKey(expectedCanonicalCandidate)
  ) {
    throw new Error(
      `Managed package path resolves through a junction or reparse point: "${candidatePath}".`,
    );
  }
  return candidatePath;
}

function assertSafeRelativeTarget(targetPath: string): void {
  const segments = targetPath.replace(/\\/g, '/').split('/');
  if (
    targetPath.trim().length === 0 ||
    path.win32.isAbsolute(targetPath) ||
    path.posix.isAbsolute(targetPath) ||
    Array.from(targetPath).some((character) => character.charCodeAt(0) < 32) ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    throw new Error(`Invalid managed D2RLoader target path: "${targetPath}".`);
  }
}

function lstatIfPresent(filePath: string): Stats | null {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertManagedPackagesRootType(rootPath: string, stat: Stats): void {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(
      `Managed D2RLoader package root must be a real directory: "${rootPath}".`,
    );
  }
}

function assertValidPackageName(packageName: string): void {
  if (
    packageName.trim().length === 0 ||
    packageName.startsWith('.') ||
    packageName === '.' ||
    packageName === '..' ||
    packageName.endsWith('.') ||
    packageName.endsWith(' ') ||
    WINDOWS_INVALID_PACKAGE_CHARACTERS.test(packageName) ||
    Array.from(packageName).some((character) => character.charCodeAt(0) < 32) ||
    WINDOWS_RESERVED_PACKAGE_NAME.test(packageName) ||
    path.win32.isAbsolute(packageName) ||
    path.posix.isAbsolute(packageName)
  ) {
    throw new Error(`Invalid D2RLoader package name: "${packageName}".`);
  }
}

function hasManagedPackageLayout(packagePath: string): boolean {
  const manifestStat = lstatIfPresent(
    path.join(packagePath, D2R_LOADER_PACKAGE_MANIFEST),
  );
  const sourceStat = lstatIfPresent(
    path.join(packagePath, PACKAGE_SOURCE_DIRECTORY),
  );
  return (
    manifestStat != null &&
    manifestStat.isFile() &&
    !manifestStat.isSymbolicLink() &&
    sourceStat != null &&
    sourceStat.isDirectory() &&
    !sourceStat.isSymbolicLink()
  );
}

function hasManagedPackageMarker(packagePath: string): boolean {
  return (
    lstatIfPresent(path.join(packagePath, D2R_LOADER_PACKAGE_MANIFEST)) !=
      null ||
    lstatIfPresent(path.join(packagePath, PACKAGE_SOURCE_DIRECTORY)) != null
  );
}

function isD2RLoaderDirectoryReadme(entry: Dirent, stat: Stats): boolean {
  return (
    entry.name.toLowerCase() === D2R_LOADER_DIRECTORY_README.toLowerCase() &&
    entry.isFile() &&
    stat.isFile() &&
    !entry.isSymbolicLink() &&
    !stat.isSymbolicLink()
  );
}

function hasOnlyD2RLoaderDirectoryReadme(rootPath: string): boolean {
  return readdirSync(rootPath, { withFileTypes: true }).every((entry) => {
    const stat = lstatSync(path.join(rootPath, entry.name));
    return isD2RLoaderDirectoryReadme(entry, stat);
  });
}

function validateManagedPackagesRoot(
  rootPath: string,
  allowImportSources: boolean = false,
): number {
  const packageNames = new Set<string>();
  let packageCount = 0;
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      throw new Error(
        `Managed D2RLoader package root contains an unfinished transaction or unsupported hidden entry: "${path.join(
          rootPath,
          entry.name,
        )}".`,
      );
    }
    assertValidPackageName(entry.name);
    const packagePath = path.join(rootPath, entry.name);
    const stat = lstatSync(packagePath);
    if (isD2RLoaderDirectoryReadme(entry, stat)) continue;
    const isDirectory = entry.isDirectory() && stat.isDirectory();
    const isFile = entry.isFile() && stat.isFile();
    if (
      entry.isSymbolicLink() ||
      stat.isSymbolicLink() ||
      (!isDirectory && !isFile)
    ) {
      throw new Error(
        `Managed D2RLoader package root contains an unsupported entry: "${packagePath}".`,
      );
    }
    if (isDirectory && hasManagedPackageLayout(packagePath)) {
      const nameKey = entry.name.toLowerCase();
      if (packageNames.has(nameKey)) {
        throw new Error(
          `Managed D2RLoader package root contains duplicate package names: "${entry.name}".`,
        );
      }
      packageNames.add(nameKey);
      try {
        readPackageManifest(packagePath);
      } catch (error) {
        throw new Error(
          `Managed D2RLoader package root contains an invalid D2RMM package: "${packagePath}". ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      packageCount += 1;
      continue;
    }
    if (isDirectory && hasManagedPackageMarker(packagePath)) {
      if (
        lstatIfPresent(path.join(packagePath, D2R_LOADER_PACKAGE_MANIFEST)) !=
        null
      ) {
        resolveManagedEntry(packagePath, D2R_LOADER_PACKAGE_MANIFEST, 'file');
      }
      if (
        lstatIfPresent(path.join(packagePath, PACKAGE_SOURCE_DIRECTORY)) != null
      ) {
        resolveManagedEntry(packagePath, PACKAGE_SOURCE_DIRECTORY, 'directory');
      }
      throw new Error(
        `Managed D2RLoader package root contains a damaged or incomplete D2RMM package: "${packagePath}".`,
      );
    }
    if (!allowImportSources) {
      throw new Error(
        `Managed D2RLoader package root contains an entry that is not a D2RMM package: "${packagePath}".`,
      );
    }
  }
  return packageCount;
}

function getSafeManagedPackagesRoot(appRoot: string): string {
  const root = path.resolve(appRoot, D2R_LOADER_PACKAGES_DIRECTORY);
  const legacyRoot = path.resolve(
    appRoot,
    D2R_LOADER_LEGACY_PACKAGES_DIRECTORY,
  );
  const rootStat = lstatIfPresent(root);
  const legacyStat = lstatIfPresent(legacyRoot);
  if (rootStat != null) assertManagedPackagesRootType(root, rootStat);
  if (legacyStat != null) {
    assertManagedPackagesRootType(legacyRoot, legacyStat);
  }
  if (rootStat != null && legacyStat != null) {
    if (readdirSync(legacyRoot).length === 0) {
      rmdirSync(legacyRoot);
      validateManagedPackagesRoot(root, true);
      return root;
    }
    if (hasOnlyD2RLoaderDirectoryReadme(root)) {
      validateManagedPackagesRoot(legacyRoot);
      rmSync(root, { force: true, recursive: true });
      renameSync(legacyRoot, root);
      return root;
    }
    throw new Error(
      `Both current and legacy D2RLoader package roots exist; refusing to merge or overwrite them: "${root}" and "${legacyRoot}".`,
    );
  }
  if (rootStat != null) {
    validateManagedPackagesRoot(root, true);
    return root;
  }
  if (legacyStat != null) {
    if (readdirSync(legacyRoot).length === 0) {
      rmdirSync(legacyRoot);
      return root;
    }
    validateManagedPackagesRoot(legacyRoot);
    renameSync(legacyRoot, root);
  }
  return root;
}

export function getValidatedD2RLoaderPackagePath(
  appRoot: string,
  packageName: string,
): string {
  assertValidPackageName(packageName);

  const packagesRoot = getSafeManagedPackagesRoot(appRoot);
  const packagePath = path.resolve(packagesRoot, packageName);
  const relativePath = path.relative(packagesRoot, packagePath);
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    path.dirname(relativePath) !== '.'
  ) {
    throw new Error(`Invalid D2RLoader package name: "${packageName}".`);
  }
  return packagePath;
}

function collectSourceFiles(rootPath: string): CollectedSourceFile[] {
  const resolvedSourceRoot = path.resolve(rootPath);
  const budget = new ResourceBudget(PACKAGE_RESOURCE_LIMITS);
  const files: CollectedSourceFile[] = [];

  function visit(directoryPath: string, relativeDirectory: string): void {
    const entries = readdirSync(directoryPath, { withFileTypes: true }).sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
    for (const entry of entries) {
      const relativePath = path.join(relativeDirectory, entry.name);
      const absolutePath = resolveInside(rootPath, relativePath);
      const stat = lstatSync(absolutePath);
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
        throw new Error(
          `D2RLoader package cannot contain a symbolic link or junction: "${relativePath}".`,
        );
      }
      if (entry.isDirectory() && stat.isDirectory()) {
        if (getPathDepth(relativePath) > PACKAGE_RESOURCE_LIMITS.maxDepth) {
          throw new Error(
            `Resource depth limit exceeded by "${relativePath}".`,
          );
        }
        visit(absolutePath, relativePath);
      } else if (entry.isFile() && stat.isFile()) {
        budget.addEntry({
          bytes: stat.size,
          depth: getPathDepth(relativePath),
          name: relativePath,
        });
        files.push({
          absolutePath,
          relativePath,
          size: stat.size,
          sourceRoot: resolvedSourceRoot,
        });
      } else {
        throw new Error(
          `D2RLoader package contains an unsupported filesystem entry: "${relativePath}".`,
        );
      }
    }
  }

  visit(path.resolve(rootPath), '');
  return files;
}

function copyCollectedFiles(
  files: CollectedSourceFile[],
  destinationRoot: string,
): void {
  for (const file of files) {
    const destination = resolveInside(destinationRoot, file.relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    const canonicalRoot = realpathSync.native(file.sourceRoot);
    const canonicalSource = realpathSync.native(file.absolutePath);
    const sourceRelativePath = file.sourceRelativePath ?? file.relativePath;
    const expectedSource = path.resolve(canonicalRoot, sourceRelativePath);
    if (
      !isSameOrDescendant(canonicalRoot, canonicalSource) ||
      pathKey(canonicalSource) !== pathKey(expectedSource)
    ) {
      throw new Error(
        `D2RLoader package source changed through a junction or reparse point before staging: "${file.absolutePath}".`,
      );
    }
    const data = readBoundedFile(file.absolutePath);
    if (data.length !== file.size) {
      throw new Error(
        `D2RLoader package source changed size before staging: "${file.absolutePath}".`,
      );
    }
    writeFileSync(destination, data);
  }
}

function stripZipExtension(fileName: string): string {
  return fileName.replace(/\.zip$/i, '');
}

function assertSafeSourceDirectory(
  sourcePath: string,
  sourceStat: Stats = lstatSync(sourcePath),
): Stats {
  const stat = sourceStat;
  if (stat.isSymbolicLink()) {
    throw new Error(
      'D2RLoader package source cannot be a symbolic link or junction.',
    );
  }
  if (!stat.isDirectory()) {
    throw new Error('D2RLoader package source must be a file or directory.');
  }
  return stat;
}

function getArchivePackageName(
  files: CollectedSourceFile[],
  fallbackName: string,
): string {
  const firstSegments = new Set(
    files.map((file) => file.relativePath.split(/[\\/]+/)[0]),
  );
  if (
    firstSegments.size === 1 &&
    files.every((file) => getPathDepth(file.relativePath) > 1)
  ) {
    const wrapperName = Array.from(firstSegments)[0];
    if (
      !['config', 'd2rloader', 'patches', 'plugins'].includes(
        wrapperName.toLowerCase(),
      )
    ) {
      return wrapperName;
    }
  }
  return fallbackName;
}

function normalizeZipDirectoryEntry(file: decompress.File): decompress.File {
  return file.path.endsWith('/') ? { ...file, type: 'directory' } : file;
}

async function preparePathSource(sourcePath: string): Promise<PreparedSource> {
  const absoluteSource = path.resolve(sourcePath);
  if (!existsSync(absoluteSource)) {
    throw new Error(
      `D2RLoader package source does not exist: "${sourcePath}".`,
    );
  }
  const stat = lstatSync(absoluteSource);
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    assertSafeSourceDirectory(absoluteSource);
  }
  if (stat.isDirectory()) {
    return {
      cleanup: () => {},
      files: collectSourceFiles(absoluteSource),
      packageName: path.basename(absoluteSource),
      sourceRootName: path.basename(absoluteSource),
    };
  }

  if (!stat.isFile()) {
    throw new Error('D2RLoader package source must be a file or directory.');
  }

  if (path.extname(absoluteSource).toLowerCase() !== '.zip') {
    const budget = new ResourceBudget(PACKAGE_RESOURCE_LIMITS);
    budget.addEntry({
      bytes: stat.size,
      depth: 1,
      name: path.basename(absoluteSource),
    });
    return {
      cleanup: () => {},
      files: [
        {
          absolutePath: absoluteSource,
          relativePath: path.basename(absoluteSource),
          size: stat.size,
          sourceRoot: path.dirname(absoluteSource),
        },
      ],
      packageName: path.basename(absoluteSource, path.extname(absoluteSource)),
      sourceRootName: path.basename(path.dirname(absoluteSource)),
    };
  }

  const archiveWorkRoot = path.join(
    os.tmpdir(),
    'D2RMM',
    'D2RLoaderPackages',
    `archive-${randomUUID()}`,
  );
  const archiveSnapshot = path.join(archiveWorkRoot, 'source.zip');
  const extractRoot = path.join(archiveWorkRoot, 'extracted');
  mkdirSync(extractRoot, { recursive: true });
  try {
    const archiveBudget = new ResourceBudget(PACKAGE_RESOURCE_LIMITS);
    archiveBudget.addBytes(stat.size, path.basename(absoluteSource));
    // Inspect and extract the same private snapshot. The dropped source may be
    // replaced externally while an import is running, so validating one path
    // and later extracting that mutable path would be a TOCTOU gap.
    copyFileSync(absoluteSource, archiveSnapshot);
    try {
      await inspectZipArchive(archiveSnapshot, PACKAGE_RESOURCE_LIMITS);
    } catch (error) {
      throw new Error(
        `Unsafe or invalid ZIP archive "${absoluteSource}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    await withNoAsar(() =>
      decompress(archiveSnapshot, extractRoot, {
        map: normalizeZipDirectoryEntry,
      }),
    );
    const files = collectSourceFiles(extractRoot);
    const fallbackName = stripZipExtension(path.basename(absoluteSource));
    const packageName = getArchivePackageName(files, fallbackName);
    return {
      cleanup: () => rmSync(archiveWorkRoot, { force: true, recursive: true }),
      files,
      packageName,
      sourceRootName: packageName,
    };
  } catch (error) {
    rmSync(archiveWorkRoot, { force: true, recursive: true });
    throw error;
  }
}

function isPluginConfigFolderPair(
  pluginsPath: string,
  configPath: string,
): boolean {
  const pluginsParent = path.dirname(pluginsPath);
  return (
    pathKey(pluginsParent) === pathKey(path.dirname(configPath)) &&
    path.basename(pluginsPath).toLowerCase() === 'plugins' &&
    path.basename(configPath).toLowerCase() === 'config'
  );
}

function preparePluginConfigFolderPair(
  pluginsPath: string,
  configPath: string,
): PreparedSource | null {
  if (!isPluginConfigFolderPair(pluginsPath, configPath)) return null;

  assertSafeSourceDirectory(pluginsPath);
  assertSafeSourceDirectory(configPath);
  const pluginFiles = collectSourceFiles(pluginsPath);
  const configFiles = collectSourceFiles(configPath);
  const hasValidPlugin = pluginFiles.some(
    (file) =>
      path.extname(file.relativePath).toLowerCase() === '.dll' &&
      hasRequiredPluginExports(readBoundedFile(file.absolutePath)),
  );
  if (!hasValidPlugin) return null;

  const commonParent = path.dirname(pluginsPath);
  const packageName =
    path.basename(commonParent).toLowerCase() === D2R_LOADER_PACKAGES_DIRECTORY
      ? path.basename(path.dirname(commonParent))
      : path.basename(commonParent);
  const files = [
    ...pluginFiles.map((file) => ({
      ...file,
      relativePath: path.join('plugins', file.relativePath),
      sourceRelativePath: file.relativePath,
    })),
    ...configFiles.map((file) => ({
      ...file,
      relativePath: path.join('config', file.relativePath),
      sourceRelativePath: file.relativePath,
    })),
  ];
  const budget = new ResourceBudget(PACKAGE_RESOURCE_LIMITS);
  for (const file of files) {
    budget.addEntry({
      bytes: file.size,
      depth: getPathDepth(file.relativePath),
      name: file.relativePath,
    });
  }
  return {
    cleanup: () => {},
    files,
    packageName,
    sourceRootName: packageName,
  };
}

function prepareLooseFileGroup(sourcePaths: string[]): PreparedSource {
  const absolutePaths = sourcePaths.map((sourcePath) =>
    path.resolve(sourcePath),
  );
  const parentPath = path.dirname(absolutePaths[0]);
  const budget = new ResourceBudget(PACKAGE_RESOURCE_LIMITS);
  const files = absolutePaths.map((absolutePath): CollectedSourceFile => {
    if (path.dirname(absolutePath) !== parentPath) {
      throw new Error('Loose D2RLoader package files must share one folder.');
    }
    const stat = lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(
        `Loose D2RLoader package source is not a regular file: "${absolutePath}".`,
      );
    }
    const relativePath = path.basename(absolutePath);
    budget.addEntry({ bytes: stat.size, depth: 1, name: relativePath });
    return {
      absolutePath,
      relativePath,
      size: stat.size,
      sourceRoot: parentPath,
    };
  });
  const pluginNames = files
    .filter((file) => isRecognizedLoosePluginDLL(file.absolutePath))
    .map((file) =>
      path.basename(file.relativePath, path.extname(file.relativePath)),
    )
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const packageName =
    pluginNames.length === 1
      ? pluginNames[0]
      : `${pluginNames[0] ?? path.basename(parentPath)}-pack`;
  return {
    cleanup: () => {},
    files,
    packageName,
    sourceRootName: path.basename(parentPath),
  };
}

function isRecognizedLoosePluginDLL(filePath: string): boolean {
  return (
    path.extname(filePath).toLowerCase() === '.dll' &&
    hasRequiredPluginExports(readBoundedFile(filePath))
  );
}

function hasRequiredPluginExports(buffer: Buffer): boolean {
  return inspectD2RLoaderPluginPE(buffer)?.hasRequiredExports === true;
}

function decodeStrictUTF8(
  buffer: Buffer,
  label: string = 'JSON/JSONC',
): string {
  const decoded = buffer.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(buffer)) {
    throw new Error(`${label} must use valid UTF-8 encoding.`);
  }
  return decoded;
}

function parseJSONC(buffer: Buffer): unknown {
  const source = decodeStrictUTF8(buffer).replace(/^\uFEFF/, '');
  let withoutComments = '';
  let inString = false;
  let isEscaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (inString) {
      withoutComments += character;
      if (isEscaped) {
        isEscaped = false;
      } else if (character === '\\') {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      withoutComments += character;
      continue;
    }
    if (character === '/' && next === '/') {
      withoutComments += '  ';
      index += 2;
      while (index < source.length && !/[\r\n]/.test(source[index])) {
        withoutComments += ' ';
        index += 1;
      }
      if (index < source.length) withoutComments += source[index];
      continue;
    }
    if (character === '/' && next === '*') {
      withoutComments += '  ';
      index += 2;
      let terminated = false;
      while (index < source.length) {
        if (source[index] === '*' && source[index + 1] === '/') {
          withoutComments += '  ';
          index += 1;
          terminated = true;
          break;
        }
        withoutComments += /[\r\n]/.test(source[index]) ? source[index] : ' ';
        index += 1;
      }
      if (!terminated) throw new Error('Unterminated JSONC block comment.');
      continue;
    }
    withoutComments += character;
  }
  if (inString) throw new Error('Unterminated JSON string.');

  let normalized = '';
  inString = false;
  isEscaped = false;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    if (inString) {
      normalized += character;
      if (isEscaped) {
        isEscaped = false;
      } else if (character === '\\') {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      normalized += character;
      continue;
    }
    if (character === ',') {
      let nextIndex = index + 1;
      while (/\s/.test(withoutComments[nextIndex] ?? '')) nextIndex += 1;
      if (
        withoutComments[nextIndex] === '}' ||
        withoutComments[nextIndex] === ']'
      ) {
        normalized += ' ';
        continue;
      }
    }
    normalized += character;
  }
  return JSON.parse(normalized) as unknown;
}

function isPatchJSON(buffer: Buffer): boolean {
  try {
    const value = parseJSONC(buffer) as {
      patches?: unknown;
      version?: unknown;
    };
    return (
      typeof value === 'object' &&
      value != null &&
      !Array.isArray(value) &&
      value.version === 1 &&
      Array.isArray(value.patches) &&
      value.patches.length > 0 &&
      value.patches.every(
        (patch) =>
          typeof patch === 'object' &&
          patch != null &&
          !Array.isArray(patch) &&
          typeof (patch as { op?: unknown }).op === 'string' &&
          (patch as { op: string }).op.trim().length > 0 &&
          typeof (patch as { rva?: unknown }).rva === 'string' &&
          /^0x[0-9a-f]+$/i.test((patch as { rva: string }).rva),
      )
    );
  } catch {
    return false;
  }
}

function isPluginCompanionJSON(buffer: Buffer): boolean {
  try {
    parseJSONC(buffer);
    return true;
  } catch {
    return false;
  }
}

function getDLLSearchTexts(buffers: Buffer[]): string[] {
  return buffers.flatMap((buffer) => [
    buffer.toString('latin1'),
    buffer.toString('utf16le'),
    buffer.subarray(1).toString('utf16le'),
  ]);
}

function findReferencedDataPath(
  searchTexts: string[],
  fileName: string,
): string | null {
  const lowerFileName = fileName.toLowerCase();
  for (const text of searchTexts) {
    const lowerText = text.toLowerCase();
    let index = lowerText.indexOf(lowerFileName);
    while (index >= 0) {
      let start = index;
      while (start > 0 && /[A-Za-z0-9_. \\/-]/.test(text[start - 1])) {
        start -= 1;
      }
      const candidate = text
        .slice(start, index + fileName.length)
        .replace(/\\/g, '/');
      const dataIndex = candidate.toLowerCase().lastIndexOf('data/');
      if (dataIndex >= 0) {
        const relative = candidate
          .slice(dataIndex + 'data/'.length)
          .replace(/\0.*$/s, '');
        if (
          relative !== '' &&
          !Array.from(relative).some(
            (character) => character.charCodeAt(0) < 32,
          ) &&
          !relative.split('/').some((segment) => segment === '..')
        ) {
          const segments = relative.split('/').filter(Boolean);
          return path.join(
            ...segments.map((segment, segmentIndex) =>
              segmentIndex < segments.length - 1
                ? segment.toLowerCase()
                : segment,
            ),
          );
        }
      }
      index = lowerText.indexOf(lowerFileName, index + lowerFileName.length);
    }
  }
  return null;
}

function getCanonicalLoaderTarget(
  sourceRootName: string,
  relativePath: string,
): { role: D2RLoaderPackageFileRole; targetPath: string } | null {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const sourceRootLower = sourceRootName.toLowerCase();
  const loaderIndex = lowerSegments.lastIndexOf('d2rloader');
  const isLoaderCategory = (value: string | undefined): boolean =>
    value === 'plugins' || value === 'patches' || value === 'config';
  let targetSegments: string[];
  if (sourceRootLower === 'd2rloader') {
    targetSegments = segments;
  } else if (loaderIndex >= 0) {
    targetSegments = segments.slice(loaderIndex + 1);
  } else if (isLoaderCategory(lowerSegments[0])) {
    targetSegments = segments;
  } else if (
    lowerSegments[0] === sourceRootLower &&
    isLoaderCategory(lowerSegments[1])
  ) {
    targetSegments = segments.slice(1);
  } else {
    return null;
  }
  const category = targetSegments[0]?.toLowerCase();
  if (targetSegments.length < 2) {
    return null;
  }
  if (category === 'plugins') {
    return { role: 'plugin', targetPath: path.join(...targetSegments) };
  }
  if (category === 'patches') {
    return { role: 'patch', targetPath: path.join(...targetSegments) };
  }
  if (category === 'config') {
    return { role: 'config', targetPath: path.join(...targetSegments) };
  }
  return null;
}

function getUnpackedPluginMPQTarget(
  relativePath: string,
  validPluginDLLPaths: Set<string>,
): string | null {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  // A filesystem directory is not represented in CollectedSourceFile, so
  // infer an unpacked MPQ boundary from each file below a *.mpq path segment.
  for (let index = segments.length - 2; index >= 0; index -= 1) {
    const mpqDirectory = segments[index];
    if (path.extname(mpqDirectory).toLowerCase() !== '.mpq') continue;

    const pluginStem = path.basename(mpqDirectory, path.extname(mpqDirectory));
    const expectedDLLPath = path.join(
      ...segments.slice(0, index),
      `${pluginStem}.dll`,
    );
    if (!validPluginDLLPaths.has(pathKey(expectedDLLPath))) continue;

    return path.join('plugins', ...segments.slice(index));
  }
  return null;
}

function createPackageManifest(
  packageName: string,
  sourceRootName: string,
  files: CollectedSourceFile[],
  allowUnsupportedJSON: boolean = false,
  preserveUnpackedPluginMPQDirectories: boolean = true,
): D2RLoaderPackageManifest {
  const warnings: string[] = [];
  const dllBuffers = files
    .filter((file) => path.extname(file.relativePath).toLowerCase() === '.dll')
    .map((file) => readBoundedFile(file.absolutePath))
    .filter(hasRequiredPluginExports);
  const referencedConfigFileNames = new Set<string>();
  for (const buffer of dllBuffers) {
    const inspection = inspectD2RLoaderPluginPE(buffer);
    for (const fileName of inspection?.referencedConfigFileNames ?? []) {
      if (fileName !== 'modinfo.json') {
        referencedConfigFileNames.add(fileName);
      }
    }
  }
  const validPluginDLLs = files.filter(
    (file) =>
      path.extname(file.relativePath).toLowerCase() === '.dll' &&
      hasRequiredPluginExports(readBoundedFile(file.absolutePath)),
  );
  const validPluginDLLPaths = new Set(
    validPluginDLLs.map((file) => pathKey(file.relativePath)),
  );
  const dllSearchTexts = getDLLSearchTexts(dllBuffers);

  const manifestFiles = files.map((file): D2RLoaderPackageFile => {
    const buffer = readBoundedFile(file.absolutePath);
    const sha256 = hashBuffer(buffer);
    const extension = path.extname(file.relativePath).toLowerCase();
    const isJSONFile = extension === '.json' || extension === '.jsonc';
    const fileName = path.basename(file.relativePath);
    const canonical = getCanonicalLoaderTarget(
      sourceRootName,
      file.relativePath,
    );
    const unpackedPluginMPQTarget = preserveUnpackedPluginMPQDirectories
      ? getUnpackedPluginMPQTarget(file.relativePath, validPluginDLLPaths)
      : null;
    if (unpackedPluginMPQTarget != null) {
      return {
        role: 'plugin',
        sha256,
        sourcePath: file.relativePath,
        targetPath: unpackedPluginMPQTarget,
        targetRoot: 'd2rloader',
      };
    }
    if (extension === '.dll') {
      if (hasRequiredPluginExports(buffer)) {
        return {
          role: 'plugin',
          sha256,
          sourcePath: file.relativePath,
          targetPath: path.join('plugins', fileName),
          targetRoot: 'd2rloader',
        };
      }
      warnings.push(
        `${file.relativePath} was preserved but not deployed because required D2RLoader plugin exports were not found.`,
      );
    } else if (isJSONFile && isPatchJSON(buffer)) {
      return {
        role: 'patch',
        sha256,
        sourcePath: file.relativePath,
        targetPath: path.join('patches', fileName),
        targetRoot: 'd2rloader',
      };
    } else if (
      isJSONFile &&
      canonical?.role === 'config' &&
      isPluginCompanionJSON(buffer)
    ) {
      return {
        role: 'config',
        sha256,
        sourcePath: file.relativePath,
        targetPath: canonical.targetPath,
        targetRoot: 'd2rloader',
      };
    } else if (
      isJSONFile &&
      referencedConfigFileNames.has(fileName.toLowerCase()) &&
      isPluginCompanionJSON(buffer)
    ) {
      return {
        role: 'config',
        sha256,
        sourcePath: file.relativePath,
        targetPath: path.join('config', fileName),
        targetRoot: 'd2rloader',
      };
    } else if (isJSONFile) {
      if (dllBuffers.length === 0) {
        if (!allowUnsupportedJSON) {
          throw new Error(
            `JSON/JSONC file "${file.relativePath}" is not a D2RLoader patch and has no plugin DLL companion.`,
          );
        }
      } else if (!isPluginCompanionJSON(buffer)) {
        if (!allowUnsupportedJSON) {
          throw new Error(
            `Plugin companion JSON/JSONC is invalid: "${file.relativePath}".`,
          );
        }
      } else {
        return {
          role: 'plugin',
          sha256,
          sourcePath: file.relativePath,
          targetPath: path.join('plugins', fileName),
          targetRoot: 'd2rloader',
        };
      }
    } else if (extension === '.toml') {
      if (!isPluginTOMLPath(file.relativePath)) {
        warnings.push(
          `${file.relativePath} was preserved but not deployed because d2rloader.toml is the loader-wide configuration, not a plugin TOML file.`,
        );
        return {
          role: 'support',
          sha256,
          sourcePath: file.relativePath,
          targetPath: null,
          targetRoot: null,
        };
      }
      return {
        role: 'config',
        sha256,
        sourcePath: file.relativePath,
        targetPath: path.join('config', fileName),
        targetRoot: 'd2rloader',
      };
    } else {
      const isMatchingPluginMPQ =
        extension === '.mpq' &&
        validPluginDLLs.some(
          (dll) =>
            path
              .basename(dll.relativePath, path.extname(dll.relativePath))
              .toLowerCase() ===
            path
              .basename(file.relativePath, path.extname(file.relativePath))
              .toLowerCase(),
        );
      if (isMatchingPluginMPQ) {
        return {
          role: 'plugin',
          sha256,
          sourcePath: file.relativePath,
          targetPath: path.join('plugins', fileName),
          targetRoot: 'd2rloader',
        };
      }
      if (canonical != null) {
        return {
          role: canonical.role,
          sha256,
          sourcePath: file.relativePath,
          targetPath: canonical.targetPath,
          targetRoot: 'd2rloader',
        };
      }
      const referencedDataPath = findReferencedDataPath(
        dllSearchTexts,
        fileName,
      );
      if (referencedDataPath != null) {
        return {
          role: 'data',
          sha256,
          sourcePath: file.relativePath,
          targetPath: referencedDataPath,
          targetRoot: 'data',
        };
      }
    }

    if (!isPreservedDocumentationFile(fileName)) {
      warnings.push(
        `${file.relativePath} was preserved but has no safe automatic deployment target.`,
      );
    }
    return {
      role: 'support',
      sha256,
      sourcePath: file.relativePath,
      targetPath: null,
      targetRoot: null,
    };
  });

  const targetMap = new Map<string, D2RLoaderPackageFile>();
  const targetEntries: FileDirectoryTarget<D2RLoaderPackageFile>[] = [];
  for (const file of manifestFiles) {
    if (file.targetRoot == null || file.targetPath == null) continue;
    const key = `${file.targetRoot}:${pathKey(file.targetPath)}`;
    const existing = targetMap.get(key);
    if (existing != null && existing.sha256 !== file.sha256) {
      throw new Error(
        `Package "${packageName}" contains conflicting files for ${file.targetRoot}/${file.targetPath}: "${existing.sourcePath}" and "${file.sourcePath}".`,
      );
    }
    if (existing == null) {
      targetMap.set(key, file);
      targetEntries.push({
        scope: file.targetRoot,
        targetPath: file.targetPath,
        value: file,
      });
    }
  }
  const [shapeConflict] = findFileDirectoryTargetConflicts(targetEntries);
  if (shapeConflict != null) {
    throw new Error(
      `Package "${packageName}" contains file/directory target conflicts: ${shapeConflict.ancestor.scope}/${shapeConflict.ancestor.targetPath} and ${shapeConflict.descendant.scope}/${shapeConflict.descendant.targetPath}.`,
    );
  }

  return {
    files: manifestFiles,
    importedAt: new Date().toISOString(),
    name: packageName,
    version: 2,
    warnings,
  };
}

function stagePreparedSource(
  appRoot: string,
  prepared: PreparedSource,
): StagedPackage {
  const packagePath = getValidatedD2RLoaderPackagePath(
    appRoot,
    prepared.packageName,
  );
  const stagingRoot = path.join(
    os.tmpdir(),
    'D2RMM',
    'D2RLoaderPackages',
    `package-${randomUUID()}`,
  );
  const stagingSource = path.join(stagingRoot, PACKAGE_SOURCE_DIRECTORY);
  mkdirSync(stagingSource, { recursive: true });
  try {
    copyCollectedFiles(prepared.files, stagingSource);
    const stagedFiles = collectSourceFiles(stagingSource);
    const manifest = createPackageManifest(
      prepared.packageName,
      prepared.sourceRootName,
      stagedFiles,
    );
    writeFileSync(
      path.join(stagingRoot, D2R_LOADER_PACKAGE_MANIFEST),
      JSON.stringify(manifest, null, 2),
    );
    return { destinationPath: packagePath, manifest, stagingRoot };
  } catch (error) {
    rmSync(stagingRoot, { force: true, recursive: true });
    throw error;
  }
}

function commitStagedPackagesAtomically(
  appRoot: string,
  stagedPackages: StagedPackage[],
  beforeOperation: (
    operation: D2RLoaderPackageCommitOperation,
    packageName: string,
  ) => void = () => {},
): string[] {
  if (stagedPackages.length === 0) return [];
  const packagesRoot = getSafeManagedPackagesRoot(appRoot);
  mkdirSync(packagesRoot, { recursive: true });
  const transactionID = randomUUID();
  const operations: Array<{
    backupPath: string;
    destinationPath: string;
    hasBackup: boolean;
    incomingPath: string;
    installed: boolean;
  }> = [];
  const cleanupWarnings: string[] = [];
  let transactionSucceeded = false;

  try {
    for (const stagedPackage of stagedPackages) {
      const packageName = path.basename(stagedPackage.destinationPath);
      const operation = {
        backupPath: resolveInside(
          packagesRoot,
          `.${packageName}.backup-${transactionID}`,
        ),
        destinationPath: stagedPackage.destinationPath,
        hasBackup: false,
        incomingPath: resolveInside(
          packagesRoot,
          `.${packageName}.incoming-${transactionID}`,
        ),
        installed: false,
      };
      operations.push(operation);
      beforeOperation('copy', packageName);
      cpSync(stagedPackage.stagingRoot, operation.incomingPath, {
        recursive: true,
      });
    }
    for (const operation of operations) {
      const packageName = path.basename(operation.destinationPath);
      if (existsSync(operation.destinationPath)) {
        beforeOperation('backup', packageName);
        renameSync(operation.destinationPath, operation.backupPath);
        operation.hasBackup = true;
      }
      beforeOperation('install', packageName);
      renameSync(operation.incomingPath, operation.destinationPath);
      operation.installed = true;
    }
    transactionSucceeded = true;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const operation of [...operations].reverse()) {
      try {
        if (operation.installed && existsSync(operation.destinationPath)) {
          rmSync(operation.destinationPath, { force: true, recursive: true });
        }
        if (operation.hasBackup && existsSync(operation.backupPath)) {
          renameSync(operation.backupPath, operation.destinationPath);
          operation.hasBackup = false;
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'Failed to import D2RLoader packages and fully restore prior packages.',
      );
    }
    throw error;
  } finally {
    for (const operation of operations) {
      if (existsSync(operation.incomingPath)) {
        try {
          rmSync(operation.incomingPath, { force: true, recursive: true });
        } catch (error) {
          if (transactionSucceeded) {
            cleanupWarnings.push(
              `Imported package but could not remove transaction staging "${operation.incomingPath}": ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }
      if (
        existsSync(operation.backupPath) &&
        (transactionSucceeded || !operation.hasBackup)
      ) {
        try {
          rmSync(operation.backupPath, { force: true, recursive: true });
        } catch (error) {
          if (transactionSucceeded) {
            cleanupWarnings.push(
              `Imported package but could not remove its previous backup "${operation.backupPath}": ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }
    }
  }
  return cleanupWarnings;
}

export async function importD2RLoaderPluginSources(
  appRoot: string,
  sourcePaths: string[],
  beforeCommitOperation: (
    operation: D2RLoaderPackageCommitOperation,
    packageName: string,
  ) => void = () => {},
): Promise<D2RLoaderPluginImportResult> {
  if (sourcePaths.length === 0) {
    return { importedFiles: 0, packages: [], warnings: [] };
  }
  const packageNames = new Set<string>();
  const installedPackageNames: string[] = [];
  const warnings: string[] = [];
  let importedFiles = 0;

  const individualSources: string[] = [];
  const looseFilesByParent = new Map<string, string[]>();
  const preparedSources: PreparedSource[] = [];
  const pairedFolderSources = new Set<string>();
  const directorySources = sourcePaths
    .map((sourcePath) => path.resolve(sourcePath))
    .filter((sourcePath) => {
      if (!existsSync(sourcePath)) return false;
      const stat = lstatSync(sourcePath);
      return stat.isDirectory();
    });
  for (const pluginsPath of directorySources) {
    if (path.basename(pluginsPath).toLowerCase() !== 'plugins') continue;
    const configPath = directorySources.find(
      (candidate) =>
        path.basename(candidate).toLowerCase() === 'config' &&
        isPluginConfigFolderPair(pluginsPath, candidate),
    );
    if (configPath == null) continue;
    const prepared = preparePluginConfigFolderPair(pluginsPath, configPath);
    if (prepared == null) continue;
    preparedSources.push(prepared);
    pairedFolderSources.add(pathKey(pluginsPath));
    pairedFolderSources.add(pathKey(configPath));
  }
  for (const sourcePath of sourcePaths) {
    const absolutePath = path.resolve(sourcePath);
    if (!existsSync(absolutePath)) {
      throw new Error(
        `D2RLoader package source does not exist: "${sourcePath}".`,
      );
    }
    const stat = lstatSync(absolutePath);
    if (
      stat.isDirectory() ||
      path.extname(absolutePath).toLowerCase() === '.zip'
    ) {
      if (pairedFolderSources.has(pathKey(absolutePath))) continue;
      individualSources.push(absolutePath);
      continue;
    }
    const parentKey = pathKey(path.dirname(absolutePath));
    looseFilesByParent.set(parentKey, [
      ...(looseFilesByParent.get(parentKey) ?? []),
      absolutePath,
    ]);
  }

  const stagedPackages: StagedPackage[] = [];
  try {
    for (const sourcePath of individualSources) {
      preparedSources.push(await preparePathSource(sourcePath));
    }
    for (const looseFiles of looseFilesByParent.values()) {
      if (
        looseFiles.length > 1 &&
        looseFiles.some(isRecognizedLoosePluginDLL)
      ) {
        preparedSources.push(prepareLooseFileGroup(looseFiles));
      } else {
        for (const looseFile of looseFiles) {
          preparedSources.push(await preparePathSource(looseFile));
        }
      }
    }

    for (const prepared of preparedSources) {
      const packageNameKey = prepared.packageName.toLowerCase();
      if (packageNames.has(packageNameKey)) {
        throw new Error(
          `More than one dropped source resolves to package "${prepared.packageName}".`,
        );
      }
      packageNames.add(packageNameKey);
      const stagedPackage = stagePreparedSource(appRoot, prepared);
      stagedPackages.push(stagedPackage);
      const { manifest } = stagedPackage;
      installedPackageNames.push(manifest.name);
      importedFiles += manifest.files.length;
      warnings.push(...manifest.warnings);
    }

    warnings.push(
      ...commitStagedPackagesAtomically(
        appRoot,
        stagedPackages,
        beforeCommitOperation,
      ),
    );

    return {
      importedFiles,
      packages: installedPackageNames,
      warnings,
    };
  } finally {
    for (const prepared of preparedSources) prepared.cleanup();
    for (const stagedPackage of stagedPackages) {
      if (existsSync(stagedPackage.stagingRoot)) {
        rmSync(stagedPackage.stagingRoot, { force: true, recursive: true });
      }
    }
  }
}

function readPackageManifest(packagePath: string): D2RLoaderPackageManifest {
  const safePackagePath = resolveManagedEntry(
    path.dirname(packagePath),
    path.basename(packagePath),
    'directory',
  );
  const manifestPath = resolveManagedEntry(
    safePackagePath,
    D2R_LOADER_PACKAGE_MANIFEST,
    'file',
  );
  const sourceRoot = resolveManagedEntry(
    safePackagePath,
    PACKAGE_SOURCE_DIRECTORY,
    'directory',
  );
  const manifest = JSON.parse(
    readBoundedFile(manifestPath).toString('utf8'),
  ) as D2RLoaderPackageManifest;
  if (
    (manifest.version !== 1 && manifest.version !== 2) ||
    typeof manifest.name !== 'string' ||
    typeof manifest.importedAt !== 'string' ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.warnings) ||
    !manifest.warnings.every((warning) => typeof warning === 'string')
  ) {
    throw new Error(
      `Invalid managed D2RLoader package manifest: "${manifestPath}".`,
    );
  }
  for (const file of manifest.files) {
    if (
      typeof file !== 'object' ||
      file == null ||
      !PACKAGE_FILE_ROLES.has(file.role) ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(file.sha256) ||
      typeof file.sourcePath !== 'string' ||
      file.sourcePath.trim().length === 0 ||
      (file.targetRoot !== null &&
        file.targetRoot !== 'd2rloader' &&
        file.targetRoot !== 'data') ||
      (file.targetRoot == null) !== (file.targetPath == null) ||
      (file.targetPath != null && typeof file.targetPath !== 'string')
    ) {
      throw new Error(
        `Invalid managed D2RLoader package manifest: "${manifestPath}".`,
      );
    }
    getManagedPackageSourcePath(safePackagePath, file.sourcePath);
    if (file.targetPath != null) assertSafeRelativeTarget(file.targetPath);
  }
  const packageName = path.basename(safePackagePath);
  const classified = createPackageManifest(
    packageName,
    packageName,
    collectSourceFiles(sourceRoot),
    manifest.version === 1,
  );
  if (manifest.version === 2) {
    const matchesClassification = (
      expectedManifest: D2RLoaderPackageManifest,
    ): boolean => {
      const expectedBySource = new Map(
        expectedManifest.files.map((file) => [pathKey(file.sourcePath), file]),
      );
      return (
        manifest.files.length === expectedManifest.files.length &&
        manifest.files.every((file) => {
          const expected = expectedBySource.get(pathKey(file.sourcePath));
          return (
            expected != null &&
            expected.role === file.role &&
            expected.sha256.toLowerCase() === file.sha256.toLowerCase() &&
            expected.targetRoot === file.targetRoot &&
            expected.targetPath === file.targetPath
          );
        })
      );
    };
    if (!matchesClassification(classified)) {
      // Version 2 manifests created before unpacked MPQ directory support
      // flattened or separately classified their contents. Validate against
      // that exact legacy classifier, then return the corrected classification
      // so an existing package is repaired on its next deployment.
      const legacyClassified = createPackageManifest(
        packageName,
        packageName,
        collectSourceFiles(sourceRoot),
        false,
        false,
      );
      if (matchesClassification(legacyClassified)) {
        return {
          ...classified,
          importedAt: manifest.importedAt,
          name: packageName,
        };
      }
      throw new Error(
        `Managed D2RLoader package manifest does not match its source classification: "${manifestPath}". Re-import the package.`,
      );
    }
  }
  return {
    ...classified,
    importedAt: manifest.importedAt,
    name: packageName,
  };
}

function getEditableFormatLabel(sourcePath: string): 'JSON/JSONC' | 'TOML' {
  return /\.toml$/i.test(sourcePath) ? 'TOML' : 'JSON/JSONC';
}

function assertPackageRevisionUnchanged(
  packagePath: string,
  expectedManifest: D2RLoaderPackageManifest,
  editedSourcePath: string,
): void {
  const formatLabel = getEditableFormatLabel(editedSourcePath);
  let latestManifest: D2RLoaderPackageManifest;
  try {
    latestManifest = readPackageManifest(packagePath);
  } catch (error) {
    throw createD2RLoaderPluginEditConflictError(
      `Managed package changed before the ${formatLabel} edit could be committed. Refresh and reopen "${editedSourcePath}". ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const latestFilesBySource = new Map(
    latestManifest.files.map((file) => [pathKey(file.sourcePath), file]),
  );
  if (
    latestManifest.importedAt !== expectedManifest.importedAt ||
    latestManifest.files.length !== expectedManifest.files.length ||
    expectedManifest.files.some((file) => {
      const latest = latestFilesBySource.get(pathKey(file.sourcePath));
      return (
        latest == null ||
        latest.role !== file.role ||
        latest.sha256.toLowerCase() !== file.sha256.toLowerCase() ||
        latest.targetRoot !== file.targetRoot ||
        latest.targetPath !== file.targetPath
      );
    })
  ) {
    throw createD2RLoaderPluginEditConflictError(
      `Managed package changed before the ${formatLabel} edit could be committed. Refresh and reopen "${editedSourcePath}".`,
    );
  }
}

function getManagedPackageSourcePath(
  packagePath: string,
  sourcePath: string,
): string {
  const sourceRoot = resolveManagedEntry(
    packagePath,
    PACKAGE_SOURCE_DIRECTORY,
    'directory',
  );
  return resolveManagedEntry(sourceRoot, sourcePath, 'file');
}

type EditableD2RLoaderPackageFile = D2RLoaderPackageFile & {
  role: 'config' | 'patch' | 'plugin';
  targetPath: string;
  targetRoot: 'd2rloader';
};

function getEditableManifestFile(
  manifest: D2RLoaderPackageManifest,
  sourcePath: string,
): EditableD2RLoaderPackageFile {
  const file = manifest.files.find(
    (candidate) => candidate.sourcePath === sourcePath,
  );
  const isEditableJSON =
    file != null &&
    /\.jsonc?$/i.test(file.sourcePath) &&
    (file.role === 'config' || file.role === 'patch' || file.role === 'plugin');
  const isEditableTOML =
    file != null && isPluginTOMLPath(file.sourcePath) && file.role === 'config';
  if (
    file == null ||
    (!isEditableJSON && !isEditableTOML) ||
    file.targetRoot !== 'd2rloader' ||
    file.targetPath == null
  ) {
    throw new Error(
      `Managed package file is not an editable plugin JSON/JSONC or plugin TOML file: "${sourcePath}".`,
    );
  }
  return file as EditableD2RLoaderPackageFile;
}

function getEditableFormat(
  file: EditableD2RLoaderPackageFile,
): 'json' | 'toml' {
  return /\.toml$/i.test(file.sourcePath) ? 'toml' : 'json';
}

function assertEditableTextSize(byteLength: number): void {
  if (byteLength > MAX_EDITABLE_TEXT_BYTES) {
    throw new Error(
      `Editable file exceeds the ${MAX_EDITABLE_TEXT_BYTES}-byte editor limit (${byteLength} bytes).`,
    );
  }
}

export function readD2RLoaderPluginPackageJSON(
  appRoot: string,
  packageName: string,
  sourcePath: string,
): D2RLoaderPluginEditableJSON {
  const packagePath = getValidatedD2RLoaderPackagePath(appRoot, packageName);
  const manifest = readPackageManifest(packagePath);
  const file = getEditableManifestFile(manifest, sourcePath);
  const format = getEditableFormat(file);
  const formatLabel = getEditableFormatLabel(file.sourcePath);
  const filePath = getManagedPackageSourcePath(packagePath, file.sourcePath);
  const stat = lstatSync(filePath);
  assertEditableTextSize(stat.size);
  const data = readBoundedFile(filePath);
  const contents = decodeStrictUTF8(data, formatLabel);
  if (format === 'json') {
    try {
      parseJSONC(data);
    } catch (error) {
      throw new Error(
        `Managed package JSON/JSONC is invalid: "${sourcePath}". ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const sha256 = hashBuffer(data);
  if (sha256.toLowerCase() !== file.sha256.toLowerCase()) {
    throw new Error(
      `Managed package ${formatLabel} changed while opening the editor: "${sourcePath}". Refresh and try again.`,
    );
  }
  return {
    contents,
    format,
    packageName: manifest.name,
    role: file.role,
    sha256,
    sourcePath: file.sourcePath,
    targetPath: file.targetPath,
  };
}

export function saveD2RLoaderPluginPackageJSON(
  appRoot: string,
  packageName: string,
  sourcePath: string,
  expectedSha256: string,
  contents: string,
  beforeCommitOperation: (
    operation: D2RLoaderPackageCommitOperation,
    currentPackageName: string,
  ) => void = () => {},
): D2RLoaderPluginEditResult {
  const formatLabel = getEditableFormatLabel(sourcePath);
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new Error(`Invalid expected ${formatLabel} revision hash.`);
  }
  const editedData = Buffer.from(contents, 'utf8');
  assertEditableTextSize(editedData.length);

  const packagePath = getValidatedD2RLoaderPackagePath(appRoot, packageName);
  const currentManifest = readPackageManifest(packagePath);
  const currentFile = getEditableManifestFile(currentManifest, sourcePath);
  const format = getEditableFormat(currentFile);
  decodeStrictUTF8(editedData, formatLabel);
  if (format === 'json') {
    try {
      parseJSONC(editedData);
    } catch (error) {
      throw new Error(
        `Cannot save invalid JSON/JSONC: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const currentSourcePath = getManagedPackageSourcePath(
    packagePath,
    currentFile.sourcePath,
  );
  assertEditableTextSize(lstatSync(currentSourcePath).size);
  const currentData = readBoundedFile(currentSourcePath);
  if (hashBuffer(currentData).toLowerCase() !== expectedSha256.toLowerCase()) {
    throw createD2RLoaderPluginEditConflictError(
      `Managed package ${formatLabel} changed since the editor was opened: "${sourcePath}". Refresh and reopen it.`,
    );
  }
  if (currentFile.role === 'patch' && !isPatchJSON(editedData)) {
    throw new Error(
      `Patch JSON/JSONC must remain a valid D2RLoader patch: "${sourcePath}".`,
    );
  }
  if (currentFile.role === 'plugin' && isPatchJSON(editedData)) {
    throw new Error(
      `Plugin companion JSON/JSONC cannot be changed into a patch: "${sourcePath}". Import it as a separate patch package instead.`,
    );
  }

  const sourceRoot = resolveManagedEntry(
    packagePath,
    PACKAGE_SOURCE_DIRECTORY,
    'directory',
  );
  const stagingRoot = path.join(
    os.tmpdir(),
    'D2RMM',
    'D2RLoaderPackages',
    `edit-${randomUUID()}`,
  );
  const stagingSource = path.join(stagingRoot, PACKAGE_SOURCE_DIRECTORY);
  mkdirSync(stagingSource, { recursive: true });
  try {
    copyCollectedFiles(collectSourceFiles(sourceRoot), stagingSource);
    const stagedFilePath = resolveManagedEntry(
      stagingSource,
      currentFile.sourcePath,
      'file',
    );
    if (
      hashFile(stagedFilePath).toLowerCase() !==
      currentFile.sha256.toLowerCase()
    ) {
      throw createD2RLoaderPluginEditConflictError(
        `Managed package ${formatLabel} changed while staging the edit: "${sourcePath}". Refresh and reopen it.`,
      );
    }
    writeFileSync(stagedFilePath, editedData);
    const updatedManifest = createPackageManifest(
      currentManifest.name,
      currentManifest.name,
      collectSourceFiles(stagingSource),
    );
    const updatedFile = getEditableManifestFile(
      updatedManifest,
      currentFile.sourcePath,
    );
    if (
      updatedFile.role !== currentFile.role ||
      updatedFile.targetRoot !== currentFile.targetRoot ||
      updatedFile.targetPath !== currentFile.targetPath
    ) {
      throw new Error(
        `Edited ${formatLabel} changed its deployment classification: "${sourcePath}".`,
      );
    }
    const currentFilesBySource = new Map(
      currentManifest.files.map((file) => [file.sourcePath, file]),
    );
    const changedCompanion = updatedManifest.files.find((file) => {
      if (file.sourcePath === currentFile.sourcePath) return false;
      const current = currentFilesBySource.get(file.sourcePath);
      return (
        current == null ||
        current.sha256.toLowerCase() !== file.sha256.toLowerCase()
      );
    });
    if (
      updatedManifest.files.length !== currentManifest.files.length ||
      changedCompanion != null
    ) {
      throw createD2RLoaderPluginEditConflictError(
        `Managed package changed while staging the ${formatLabel} edit. Refresh and reopen "${sourcePath}".`,
      );
    }
    updatedManifest.importedAt = currentManifest.importedAt;
    writeFileSync(
      path.join(stagingRoot, D2R_LOADER_PACKAGE_MANIFEST),
      JSON.stringify(updatedManifest, null, 2),
    );
    assertPackageRevisionUnchanged(packagePath, currentManifest, sourcePath);
    const warnings = commitStagedPackagesAtomically(
      appRoot,
      [
        {
          destinationPath: packagePath,
          manifest: updatedManifest,
          stagingRoot,
        },
      ],
      (operation, currentPackageName) => {
        beforeCommitOperation(operation, currentPackageName);
        if (operation === 'backup') {
          assertPackageRevisionUnchanged(
            packagePath,
            currentManifest,
            sourcePath,
          );
        }
      },
    );
    return { sha256: updatedFile.sha256, warnings };
  } finally {
    if (existsSync(stagingRoot)) {
      rmSync(stagingRoot, { force: true, recursive: true });
    }
  }
}

type ModEditableSource = Extract<
  D2RLoaderPluginEditableSource,
  { sourceType: 'mod' }
>;

type ModPluginSource = Extract<D2RLoaderPluginSource, { sourceType: 'mod' }>;

type ResolvedModPluginSource = {
  filePath: string;
  sourcePath: string;
  targetPath: string;
};

type ResolvedModEditableSource = {
  filePath: string;
  format: 'json' | 'toml';
  formatLabel: 'JSON/JSONC' | 'TOML';
  role: 'config' | 'patch' | 'plugin';
  sourcePath: string;
  targetPath: string;
};

function getValidatedModRoot(appRoot: string, modID: string): string {
  const modsRoot = path.resolve(appRoot, 'mods');
  if (!existsSync(modsRoot)) {
    throw new Error('The D2RMM mods directory does not exist.');
  }
  const modRoot = path.resolve(modsRoot, modID);
  const relativeModPath = path.relative(modsRoot, modRoot);
  if (
    relativeModPath.length === 0 ||
    path.isAbsolute(relativeModPath) ||
    path.dirname(relativeModPath) !== '.'
  ) {
    throw new Error(`Invalid mod ID for D2RLoader access: "${modID}".`);
  }
  try {
    return resolveManagedEntry(modsRoot, modID, 'directory');
  } catch (error) {
    throw new Error(
      `Cannot open D2RLoader files for mod "${modID}". ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function resolveModPluginSource(
  appRoot: string,
  source: ModPluginSource,
): ResolvedModPluginSource {
  const modRoot = getValidatedModRoot(appRoot, source.modID);
  let requestedLoaderRoot: string;
  try {
    requestedLoaderRoot = resolveManagedEntry(
      modRoot,
      source.loaderRootPath,
      'directory',
    );
  } catch (error) {
    throw new Error(
      `Invalid D2RLoader root for mod "${source.modID}". ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const dataModRoot = getDataModRootPath(modRoot);
  const candidateRoots = [
    modRoot,
    ...(dataModRoot != null && dataModRoot !== modRoot ? [dataModRoot] : []),
  ];
  const isKnownLoaderRoot = candidateRoots.some((candidateRoot) => {
    const loaderRoot = findCaseInsensitiveDirectory(candidateRoot, 'd2rloader');
    return (
      loaderRoot != null &&
      pathKey(path.resolve(loaderRoot)) ===
        pathKey(path.resolve(requestedLoaderRoot))
    );
  });
  if (!isKnownLoaderRoot) {
    throw new Error(
      `The selected file is not inside a recognized D2RLoader folder for mod "${source.modID}".`,
    );
  }

  if (!['plugins', 'patches', 'config'].includes(source.category)) {
    throw new Error(`Invalid D2RLoader file category: "${source.category}".`);
  }
  const categoryRoot = findCaseInsensitiveDirectory(
    requestedLoaderRoot,
    source.category,
  );
  if (categoryRoot == null) {
    throw new Error(
      `D2RLoader ${source.category} folder no longer exists for mod "${source.modID}". Refresh the inventory.`,
    );
  }

  let filePath: string;
  try {
    filePath = resolveManagedEntry(categoryRoot, source.sourcePath, 'file');
  } catch (error) {
    throw new Error(
      `Invalid mod plugin source path "${source.sourcePath}". ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    filePath,
    sourcePath: source.sourcePath,
    targetPath: path.join(source.category, source.sourcePath),
  };
}

function resolveModEditableSource(
  appRoot: string,
  source: ModEditableSource,
): ResolvedModEditableSource {
  const resolved = resolveModPluginSource(appRoot, source);

  const isTOML =
    source.category === 'config' &&
    /\.toml$/i.test(source.sourcePath) &&
    path.basename(source.sourcePath).toLowerCase() !==
      D2R_LOADER_MAIN_CONFIG_FILE;
  const isJSON = /\.jsonc?$/i.test(source.sourcePath);
  if (!isTOML && !isJSON) {
    throw new Error(
      `Mod file is not an editable plugin JSON/JSONC or plugin TOML file: "${source.sourcePath}".`,
    );
  }

  return {
    ...resolved,
    format: isTOML ? 'toml' : 'json',
    formatLabel: isTOML ? 'TOML' : 'JSON/JSONC',
    role:
      source.category === 'config'
        ? 'config'
        : source.category === 'patches'
          ? 'patch'
          : 'plugin',
  };
}

function readD2RLoaderModPluginJSON(
  appRoot: string,
  source: ModEditableSource,
): D2RLoaderPluginEditableJSON {
  const resolved = resolveModEditableSource(appRoot, source);
  const stat = lstatSync(resolved.filePath);
  assertEditableTextSize(stat.size);
  const data = readBoundedFile(resolved.filePath);
  const contents = decodeStrictUTF8(data, resolved.formatLabel);
  if (resolved.format === 'json') {
    try {
      parseJSONC(data);
    } catch (error) {
      throw new Error(
        `Mod plugin JSON/JSONC is invalid: "${source.sourcePath}". ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return {
    contents,
    format: resolved.format,
    packageName: null,
    role: resolved.role,
    sha256: hashBuffer(data),
    sourcePath: resolved.sourcePath,
    targetPath: resolved.targetPath,
  };
}

function replaceModSourceFile(
  filePath: string,
  expectedSha256: string,
  editedData: Buffer,
): string[] {
  const token = randomUUID();
  const directoryPath = path.dirname(filePath);
  const stagedPath = path.join(directoryPath, `.d2rmm-edit-${token}.tmp`);
  const backupPath = path.join(directoryPath, `.d2rmm-edit-${token}.bak`);
  const expectedEditedSha256 = hashBuffer(editedData);
  const warnings: string[] = [];
  let originalMoved = false;
  let replacementInstalled = false;

  writeFileSync(stagedPath, editedData, {
    flag: 'wx',
    mode: lstatSync(filePath).mode,
  });
  try {
    if (hashFile(filePath).toLowerCase() !== expectedSha256.toLowerCase()) {
      throw createD2RLoaderPluginEditConflictError(
        'The mod file changed immediately before the edit was committed. Refresh and reopen it.',
      );
    }
    renameSync(filePath, backupPath);
    originalMoved = true;
    if (hashFile(backupPath).toLowerCase() !== expectedSha256.toLowerCase()) {
      throw createD2RLoaderPluginEditConflictError(
        'The mod file changed while the edit was being committed. Refresh and reopen it.',
      );
    }
    renameSync(stagedPath, filePath);
    replacementInstalled = true;
    if (
      hashFile(filePath).toLowerCase() !== expectedEditedSha256.toLowerCase()
    ) {
      throw new Error('The edited mod file failed post-write verification.');
    }
    try {
      rmSync(backupPath, { force: true });
    } catch (error) {
      warnings.push(
        `The edit was saved, but its temporary backup could not be removed: "${backupPath}". ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    originalMoved = false;
    return warnings;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (replacementInstalled && existsSync(filePath)) {
      try {
        rmSync(filePath, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (originalMoved && existsSync(backupPath)) {
      try {
        renameSync(backupPath, filePath);
        originalMoved = false;
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'Failed to save the mod file and fully restore its previous contents.',
      );
    }
    throw error;
  } finally {
    if (existsSync(stagedPath)) {
      rmSync(stagedPath, { force: true });
    }
  }
}

function saveD2RLoaderModPluginJSON(
  appRoot: string,
  source: ModEditableSource,
  expectedSha256: string,
  contents: string,
): D2RLoaderPluginEditResult {
  const resolved = resolveModEditableSource(appRoot, source);
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new Error(`Invalid expected ${resolved.formatLabel} revision hash.`);
  }
  const editedData = Buffer.from(contents, 'utf8');
  assertEditableTextSize(editedData.length);
  decodeStrictUTF8(editedData, resolved.formatLabel);
  if (resolved.format === 'json') {
    try {
      parseJSONC(editedData);
    } catch (error) {
      throw new Error(
        `Cannot save invalid JSON/JSONC: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  assertEditableTextSize(lstatSync(resolved.filePath).size);
  const currentData = readBoundedFile(resolved.filePath);
  if (hashBuffer(currentData).toLowerCase() !== expectedSha256.toLowerCase()) {
    throw createD2RLoaderPluginEditConflictError(
      `Mod ${resolved.formatLabel} changed since the editor was opened: "${source.sourcePath}". Refresh and reopen it.`,
    );
  }
  if (resolved.role === 'patch' && !isPatchJSON(editedData)) {
    throw new Error(
      `Patch JSON/JSONC must remain a valid D2RLoader patch: "${source.sourcePath}".`,
    );
  }
  if (resolved.role === 'plugin' && isPatchJSON(editedData)) {
    throw new Error(
      `Plugin companion JSON/JSONC cannot be changed into a patch: "${source.sourcePath}". Move it to the patches folder instead.`,
    );
  }

  return {
    sha256: hashBuffer(editedData),
    warnings: replaceModSourceFile(
      resolved.filePath,
      expectedSha256,
      editedData,
    ),
  };
}

export function readD2RLoaderPluginSourceJSON(
  appRoot: string,
  source: D2RLoaderPluginEditableSource,
): D2RLoaderPluginEditableJSON {
  return source.sourceType === 'managed'
    ? readD2RLoaderPluginPackageJSON(
        appRoot,
        source.packageName,
        source.sourcePath,
      )
    : readD2RLoaderModPluginJSON(appRoot, source);
}

export function saveD2RLoaderPluginSourceJSON(
  appRoot: string,
  source: D2RLoaderPluginEditableSource,
  expectedSha256: string,
  contents: string,
): D2RLoaderPluginEditResult {
  return source.sourceType === 'managed'
    ? saveD2RLoaderPluginPackageJSON(
        appRoot,
        source.packageName,
        source.sourcePath,
        expectedSha256,
        contents,
      )
    : saveD2RLoaderModPluginJSON(appRoot, source, expectedSha256, contents);
}

function getManagedPackageEntries(packagesRoot: string): Dirent[] {
  if (!existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        !entry.name.startsWith('.') &&
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        hasManagedPackageLayout(path.join(packagesRoot, entry.name)),
    )
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}

type D2RLoaderManualSourceSnapshot = {
  sha256: string;
  sourcePath: string;
};

function getD2RLoaderManualSources(packagesRoot: string): {
  fileSnapshots: D2RLoaderManualSourceSnapshot[];
  sourcePaths: string[];
} {
  const fileSnapshots: D2RLoaderManualSourceSnapshot[] = [];
  const sourcePaths: string[] = [];
  for (const entry of readdirSync(packagesRoot, {
    withFileTypes: true,
  }).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )) {
    const sourcePath = path.join(packagesRoot, entry.name);
    const stat = lstatSync(sourcePath);
    if (isD2RLoaderDirectoryReadme(entry, stat)) continue;
    if (
      entry.isFile() &&
      stat.isFile() &&
      entry.name.toLowerCase() === D2R_LOADER_MAIN_CONFIG_FILE
    ) {
      throw new Error(
        'd2rloader.toml is the loader-wide configuration. Edit it from Settings instead of placing it in the plugin package directory.',
      );
    }
    if (
      entry.isDirectory() &&
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      hasManagedPackageLayout(sourcePath)
    ) {
      continue;
    }
    if (
      entry.isSymbolicLink() ||
      stat.isSymbolicLink() ||
      !(
        (entry.isDirectory() && stat.isDirectory()) ||
        (entry.isFile() && stat.isFile())
      )
    ) {
      throw new Error(
        `D2RLoader manual import source must be a regular file or directory: "${sourcePath}".`,
      );
    }
    sourcePaths.push(sourcePath);
    if (stat.isFile()) {
      fileSnapshots.push({ sha256: hashFile(sourcePath), sourcePath });
    }
  }
  return { fileSnapshots, sourcePaths };
}

function removeImportedManualSourceFiles(
  fileSnapshots: D2RLoaderManualSourceSnapshot[],
): string[] {
  const warnings: string[] = [];
  for (const snapshot of fileSnapshots) {
    const stat = lstatIfPresent(snapshot.sourcePath);
    if (stat == null) continue;
    if (
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      hasManagedPackageLayout(snapshot.sourcePath)
    ) {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      warnings.push(
        `Imported manual source but did not remove it because its type changed: "${snapshot.sourcePath}".`,
      );
      continue;
    }
    if (hashFile(snapshot.sourcePath) !== snapshot.sha256) {
      warnings.push(
        `Imported manual source but did not remove it because it changed during import: "${snapshot.sourcePath}".`,
      );
      continue;
    }
    try {
      rmSync(snapshot.sourcePath, { force: true });
    } catch (error) {
      warnings.push(
        `Imported manual source but could not remove it: "${snapshot.sourcePath}". ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return warnings;
}

export async function synchronizeD2RLoaderPluginDirectory(
  appRoot: string,
): Promise<D2RLoaderPluginImportResult> {
  const packagesRoot = getSafeManagedPackagesRoot(appRoot);
  mkdirSync(packagesRoot, { recursive: true });
  const { fileSnapshots, sourcePaths } =
    getD2RLoaderManualSources(packagesRoot);
  if (sourcePaths.length === 0) {
    return { importedFiles: 0, packages: [], warnings: [] };
  }
  const result = await importD2RLoaderPluginSources(appRoot, sourcePaths);
  return {
    ...result,
    warnings: [
      ...result.warnings,
      ...removeImportedManualSourceFiles(fileSnapshots),
    ],
  };
}
function manifestToSummary(
  manifest: D2RLoaderPackageManifest,
): D2RLoaderPluginPackageSummary {
  const filesFor = (role: D2RLoaderPackageFileRole): string[] =>
    manifest.files
      .filter((file) => file.role === role)
      .map((file) => file.targetPath ?? file.sourcePath)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const unmappedFiles = manifest.files
    .filter(
      (file) =>
        file.role === 'support' &&
        !isPreservedDocumentationPath(file.sourcePath),
    )
    .map((file) => file.sourcePath)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return {
    configFiles: filesFor('config'),
    dataFiles: filesFor('data'),
    name: manifest.name,
    patchFiles: filesFor('patch'),
    pluginFiles: filesFor('plugin'),
    unmappedFiles,
    warnings: manifest.warnings,
  };
}

type ModInventoryLocation = Omit<
  Extract<D2RLoaderPluginEditableSource, { sourceType: 'mod' }>,
  'sourcePath' | 'sourceType'
>;

function inventoryItem(
  sourceType: 'managed' | 'mod',
  sourceName: string,
  relativePath: string,
  filePath: string,
  packageName: string | null,
  deletionSource: D2RLoaderPluginSource,
  sha256: string = hashFile(filePath),
  editableSourcePath: string | null = null,
  editableSource: D2RLoaderPluginEditableSource | null = null,
): D2RLoaderPluginInventoryItem {
  const pluginInfo = /\.dll$/i.test(relativePath)
    ? inspectD2RLoaderPluginPE(readBoundedFile(filePath))?.pluginInfo
    : null;
  return {
    deletionSource,
    editableSource,
    editableSourcePath,
    id: `${sourceType}:${sourceName}:${editableSourcePath ?? relativePath}`,
    name: path.basename(relativePath),
    packageName,
    ...(pluginInfo == null
      ? {}
      : {
          pluginInfo: {
            apiVersion: pluginInfo.apiVersion,
            author: pluginInfo.author,
            description: pluginInfo.description,
            id: pluginInfo.id,
            name: pluginInfo.name,
            version: pluginInfo.version,
          },
        }),
    relativePath,
    sha256,
    sourceName,
    sourceType,
  };
}

function listInventoryFiles(
  categoryPath: string,
  sourceName: string,
  budget: ResourceBudget,
  location: ModInventoryLocation,
): D2RLoaderPluginInventoryItem[] {
  if (!existsSync(categoryPath) || !lstatSync(categoryPath).isDirectory()) {
    return [];
  }
  const result: D2RLoaderPluginInventoryItem[] = [];
  const pending = [{ directoryPath: categoryPath, relativePath: '' }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current == null) continue;
    for (const entry of readdirSync(current.directoryPath, {
      withFileTypes: true,
    }).sort((a, b) => b.name.localeCompare(a.name))) {
      if (entry.isSymbolicLink()) continue;
      const relativePath = path.join(current.relativePath, entry.name);
      const entryPath = resolveInside(categoryPath, relativePath);
      if (entry.isDirectory()) {
        budget.addEntry({
          bytes: 0,
          depth: getPathDepth(relativePath),
          name: `${sourceName}/${relativePath}`,
        });
        pending.push({ directoryPath: entryPath, relativePath });
      } else if (entry.isFile()) {
        const stat = lstatSync(entryPath);
        budget.addEntry({
          bytes: stat.size,
          depth: getPathDepth(relativePath),
          name: `${sourceName}/${relativePath}`,
        });
        const editableSourcePath =
          location.category === 'config'
            ? isPluginConfigPath(relativePath)
              ? relativePath
              : null
            : /\.jsonc?$/i.test(relativePath)
              ? relativePath
              : null;
        const editableSource =
          editableSourcePath == null
            ? null
            : {
                ...location,
                sourcePath: editableSourcePath,
                sourceType: 'mod' as const,
              };
        const deletionSource = {
          ...location,
          sourcePath: relativePath,
          sourceType: 'mod' as const,
        };
        result.push(
          inventoryItem(
            'mod',
            sourceName,
            relativePath,
            entryPath,
            null,
            deletionSource,
            undefined,
            editableSourcePath,
            editableSource,
          ),
        );
      }
    }
  }
  return result.sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, undefined, {
      sensitivity: 'base',
    }),
  );
}

function findCaseInsensitiveDirectory(
  rootPath: string,
  expectedName: string,
): string | null {
  if (!existsSync(rootPath) || !lstatSync(rootPath).isDirectory()) return null;
  const entry = readdirSync(rootPath, { withFileTypes: true }).find(
    (candidate) =>
      candidate.isDirectory() &&
      !candidate.isSymbolicLink() &&
      candidate.name.toLowerCase() === expectedName.toLowerCase(),
  );
  return entry == null ? null : path.join(rootPath, entry.name);
}

function getInventoryConflicts(
  plugins: D2RLoaderPluginInventoryItem[],
  patches: D2RLoaderPluginInventoryItem[],
  configs: D2RLoaderPluginInventoryItem[],
): string[] {
  const conflicts: string[] = [];
  for (const [category, items] of [
    ['plugins', plugins],
    ['patches', patches],
    ['config', configs],
  ] as const) {
    const targets = new Map<string, D2RLoaderPluginInventoryItem>();
    for (const item of items) {
      const key = pathKey(item.relativePath);
      const existing = targets.get(key);
      if (existing != null && existing.sha256 !== item.sha256) {
        conflicts.push(
          `${category}/${item.relativePath} differs between ${existing.sourceName} and ${item.sourceName}.`,
        );
      } else if (existing == null) {
        targets.set(key, item);
      }
    }
  }
  return conflicts;
}

export function readD2RLoaderPluginInventory(
  appRoot: string,
  modIDs: string[],
): D2RLoaderPluginInventory {
  const plugins: D2RLoaderPluginInventoryItem[] = [];
  const patches: D2RLoaderPluginInventoryItem[] = [];
  const configs: D2RLoaderPluginInventoryItem[] = [];
  const packages: D2RLoaderPluginPackageSummary[] = [];
  const managedSignatureParts = new Set<string>();
  const managedInventoryBudget = new ResourceBudget(PACKAGE_RESOURCE_LIMITS);
  const modInventoryBudget = new ResourceBudget(PACKAGE_RESOURCE_LIMITS);
  const managedTargetConflicts = new Set<string>();
  type ManagedTarget = {
    inventoryVisible: boolean;
    packageName: string;
    sha256: string;
    targetPath: string;
    targetRoot: Exclude<D2RLoaderPackageTargetRoot, null>;
  };
  const managedTargets = new Map<string, ManagedTarget>();
  const managedTargetEntries: FileDirectoryTarget<ManagedTarget>[] = [];
  const packagesRoot = getSafeManagedPackagesRoot(appRoot);
  mkdirSync(packagesRoot, { recursive: true });

  for (const modID of [...modIDs].sort((a, b) => a.localeCompare(b))) {
    const modRoot = getValidatedModRoot(appRoot, modID);
    const dataModRoot = getDataModRootPath(modRoot);
    const candidateRoots = [
      modRoot,
      ...(dataModRoot != null && dataModRoot !== modRoot ? [dataModRoot] : []),
    ];
    const seenLoaderRoots = new Set<string>();
    for (const candidateRoot of candidateRoots) {
      const loaderRoot = findCaseInsensitiveDirectory(
        candidateRoot,
        'd2rloader',
      );
      if (loaderRoot == null || seenLoaderRoots.has(pathKey(loaderRoot))) {
        continue;
      }
      seenLoaderRoots.add(pathKey(loaderRoot));
      const candidateRelative = path.relative(modRoot, candidateRoot);
      const loaderRootPath = path.relative(modRoot, loaderRoot);
      const sourceName =
        candidateRelative === '' ? modID : `${modID} (${candidateRelative})`;
      const pluginRoot = findCaseInsensitiveDirectory(loaderRoot, 'plugins');
      const patchRoot = findCaseInsensitiveDirectory(loaderRoot, 'patches');
      const configRoot = findCaseInsensitiveDirectory(loaderRoot, 'config');
      if (pluginRoot != null) {
        plugins.push(
          ...listInventoryFiles(pluginRoot, sourceName, modInventoryBudget, {
            category: 'plugins',
            loaderRootPath,
            modID,
          }),
        );
      }
      if (patchRoot != null) {
        patches.push(
          ...listInventoryFiles(patchRoot, sourceName, modInventoryBudget, {
            category: 'patches',
            loaderRootPath,
            modID,
          }),
        );
      }
      if (configRoot != null) {
        configs.push(
          ...listInventoryFiles(configRoot, sourceName, modInventoryBudget, {
            category: 'config',
            loaderRootPath,
            modID,
          }).filter(({ relativePath }) => isPluginConfigPath(relativePath)),
        );
      }
    }
  }

  for (const entry of getManagedPackageEntries(packagesRoot)) {
    const packagePath = path.resolve(packagesRoot, entry.name);
    const manifest = readPackageManifest(packagePath);
    packages.push(manifestToSummary(manifest));
    for (const file of manifest.files) {
      const isPluginConfig =
        file.role === 'config' && isPluginConfigPath(file.sourcePath);
      let sourceHash: string | null = null;
      let sourcePath: string | null = null;
      if (file.targetRoot != null && file.targetPath != null) {
        sourcePath = getManagedPackageSourcePath(packagePath, file.sourcePath);
        managedInventoryBudget.addEntry({
          bytes: lstatSync(sourcePath).size,
          depth: getPathDepth(file.sourcePath),
          name: `${manifest.name}/${file.sourcePath}`,
        });
        sourceHash = hashFile(sourcePath);
        managedSignatureParts.add(
          `${file.targetRoot}:${pathKey(file.targetPath)}:${sourceHash}`,
        );
        const targetKey = `${file.targetRoot}:${pathKey(file.targetPath)}`;
        const inventoryVisible =
          file.targetRoot === 'd2rloader' &&
          (file.role === 'plugin' || file.role === 'patch' || isPluginConfig);
        const existing = managedTargets.get(targetKey);
        if (
          existing != null &&
          existing.sha256 !== sourceHash &&
          !(existing.inventoryVisible && inventoryVisible)
        ) {
          managedTargetConflicts.add(
            `${path.join(file.targetRoot, file.targetPath)} differs between ${existing.packageName} and ${manifest.name}.`,
          );
        } else if (existing == null) {
          const target = {
            inventoryVisible,
            packageName: manifest.name,
            sha256: sourceHash,
            targetPath: file.targetPath,
            targetRoot: file.targetRoot,
          };
          managedTargets.set(targetKey, target);
          managedTargetEntries.push({
            scope: file.targetRoot,
            targetPath: file.targetPath,
            value: target,
          });
        }
      }
      if (
        file.targetRoot !== 'd2rloader' ||
        file.targetPath == null ||
        (file.role !== 'plugin' && file.role !== 'patch' && !isPluginConfig)
      ) {
        continue;
      }
      if (sourcePath == null || sourceHash == null) {
        throw new Error(
          `Managed package inventory source is missing: "${file.sourcePath}".`,
        );
      }
      const category =
        file.role === 'plugin'
          ? 'plugins'
          : file.role === 'patch'
            ? 'patches'
            : 'config';
      const categoryPrefix = `${category}${path.sep}`;
      const relativePath = file.targetPath
        .toLowerCase()
        .startsWith(categoryPrefix.toLowerCase())
        ? file.targetPath.slice(categoryPrefix.length)
        : path.basename(file.targetPath);
      const editableSourcePath =
        isPluginConfig ||
        (file.role !== 'config' && /\.jsonc?$/i.test(file.sourcePath))
          ? file.sourcePath
          : null;
      const editableSource =
        editableSourcePath == null
          ? null
          : {
              packageName: manifest.name,
              sourcePath: editableSourcePath,
              sourceType: 'managed' as const,
            };
      const item = inventoryItem(
        'managed',
        manifest.name,
        relativePath,
        sourcePath,
        manifest.name,
        {
          packageName: manifest.name,
          sourcePath: file.sourcePath,
          sourceType: 'managed',
        },
        sourceHash,
        editableSourcePath,
        editableSource,
      );
      if (file.role === 'plugin') plugins.push(item);
      else if (file.role === 'patch') patches.push(item);
      else configs.push(item);
    }
  }

  for (const conflict of findFileDirectoryTargetConflicts(
    managedTargetEntries,
  )) {
    managedTargetConflicts.add(
      `${path.join(conflict.descendant.scope, conflict.descendant.targetPath)} conflicts with file target ${path.join(conflict.ancestor.scope, conflict.ancestor.targetPath)} from ${conflict.ancestor.value.packageName}.`,
    );
  }

  plugins.sort((a, b) =>
    `${a.sourceName}/${a.relativePath}`.localeCompare(
      `${b.sourceName}/${b.relativePath}`,
      undefined,
      { sensitivity: 'base' },
    ),
  );
  patches.sort((a, b) =>
    `${a.sourceName}/${a.relativePath}`.localeCompare(
      `${b.sourceName}/${b.relativePath}`,
      undefined,
      { sensitivity: 'base' },
    ),
  );
  configs.sort((a, b) =>
    `${a.sourceName}/${a.relativePath}`.localeCompare(
      `${b.sourceName}/${b.relativePath}`,
      undefined,
      { sensitivity: 'base' },
    ),
  );

  const managedSignature =
    managedSignatureParts.size === 0
      ? ''
      : createHash('sha256')
          .update(Array.from(managedSignatureParts).sort().join('\0'))
          .digest('hex');
  const deploymentSignatureParts = new Set(managedSignatureParts);
  for (const [category, items] of [
    ['plugins', plugins],
    ['patches', patches],
    ['config', configs],
  ] as const) {
    for (const item of items) {
      if (item.sourceType !== 'mod') continue;
      deploymentSignatureParts.add(
        `mod:${category}:${item.sourceName}:${pathKey(item.relativePath)}:${item.sha256}`,
      );
    }
  }
  const deploymentSignature =
    deploymentSignatureParts.size === 0
      ? ''
      : createHash('sha256')
          .update(Array.from(deploymentSignatureParts).sort().join('\0'))
          .digest('hex');

  return {
    configs,
    conflicts: [
      ...getInventoryConflicts(plugins, patches, configs),
      ...managedTargetConflicts,
    ],
    deploymentSignature,
    managedSignature,
    managedRoot: packagesRoot,
    packages,
    patches,
    plugins,
  };
}

export function getManagedD2RLoaderDeployment(
  appRoot: string,
): ManagedD2RLoaderDeploymentFile[] {
  const deployment: ManagedD2RLoaderDeploymentFile[] = [];
  const deploymentBudget = new ResourceBudget(PACKAGE_RESOURCE_LIMITS);
  const targets = new Map<string, ManagedD2RLoaderDeploymentFile>();
  const packagesRoot = getSafeManagedPackagesRoot(appRoot);
  for (const entry of getManagedPackageEntries(packagesRoot)) {
    const packagePath = path.resolve(packagesRoot, entry.name);
    const manifest = readPackageManifest(packagePath);
    for (const file of manifest.files) {
      if (file.targetRoot == null || file.targetPath == null) continue;
      const sourcePath = getManagedPackageSourcePath(
        packagePath,
        file.sourcePath,
      );
      deploymentBudget.addEntry({
        bytes: lstatSync(sourcePath).size,
        depth: getPathDepth(file.sourcePath),
        name: `${manifest.name}/${file.sourcePath}`,
      });
      const data = readBoundedFile(sourcePath);
      const current: ManagedD2RLoaderDeploymentFile = {
        data,
        packageName: manifest.name,
        sha256: hashBuffer(data),
        sourcePath,
        targetPath: file.targetPath,
        targetRoot: file.targetRoot,
      };
      const key = `${current.targetRoot}:${pathKey(current.targetPath)}`;
      const existing = targets.get(key);
      if (existing != null) {
        if (existing.sha256 !== current.sha256) {
          throw new Error(
            `Managed D2RLoader package conflict at ${current.targetRoot}/${current.targetPath}: "${existing.packageName}" and "${current.packageName}".`,
          );
        }
        continue;
      }
      targets.set(key, current);
      deployment.push(current);
    }
  }
  const [shapeConflict] = findFileDirectoryTargetConflicts(
    deployment.map((file) => ({
      scope: file.targetRoot,
      targetPath: file.targetPath,
      value: file,
    })),
  );
  if (shapeConflict != null) {
    throw new Error(
      `Managed D2RLoader package file/directory conflict between ${shapeConflict.ancestor.scope}/${shapeConflict.ancestor.targetPath} from "${shapeConflict.ancestor.value.packageName}" and ${shapeConflict.descendant.scope}/${shapeConflict.descendant.targetPath} from "${shapeConflict.descendant.value.packageName}".`,
    );
  }
  return deployment;
}

export async function applyManagedD2RLoaderPackages(
  runtime: Pick<InstallationRuntime, 'BridgeAPI' | 'fileManager' | 'options'>,
): Promise<string[]> {
  if (runtime.options.useD2RLoader !== true || runtime.options.isDryRun) {
    return [];
  }
  const deployment = getManagedD2RLoaderDeployment(
    await runtime.BridgeAPI.getAppPath(),
  );
  const modifiedFiles = runtime.fileManager.getModifiedFiles();
  type OutputTarget =
    | {
        data: Buffer;
        deployment: ManagedD2RLoaderDeploymentFile;
        filePath: string;
        kind: 'managed';
        packageName: string;
      }
    | {
        data: Buffer;
        filePath: string;
        kind: 'mod';
      };
  const outputTargets: FileDirectoryTarget<OutputTarget>[] = modifiedFiles.map(
    ({ data, filePath }) => ({
      scope: 'output',
      targetPath: filePath,
      value: { data, filePath, kind: 'mod' },
    }),
  );
  for (const file of deployment) {
    const relativePath =
      file.targetRoot === 'data'
        ? file.targetPath
        : path.join('..', '..', 'd2rloader', file.targetPath);
    outputTargets.push({
      scope: 'output',
      targetPath: relativePath,
      value: {
        data: file.data,
        deployment: file,
        filePath: relativePath,
        kind: 'managed',
        packageName: file.packageName,
      },
    });
  }
  const exactOutputTargets = new Map<
    string,
    FileDirectoryTarget<OutputTarget>
  >();
  const managedFilesCoveredByMods = new Set<ManagedD2RLoaderDeploymentFile>();
  for (const target of outputTargets) {
    const key = `${pathKey(target.scope)}\0${normalizedTargetPath(target.targetPath)}`;
    const existing = exactOutputTargets.get(key);
    if (existing == null) {
      exactOutputTargets.set(key, target);
      continue;
    }
    if (!existing.value.data.equals(target.value.data)) {
      if (existing.value.kind === 'mod' && target.value.kind === 'mod') {
        throw new Error(
          `Enabled mods resolve to conflicting data at the same normalized output target: "${existing.value.filePath}" and "${target.value.filePath}".`,
        );
      }
      if (
        existing.value.kind === 'managed' &&
        target.value.kind === 'managed'
      ) {
        throw new Error(
          `Managed D2RLoader packages resolve to conflicting data at the same normalized output target: "${existing.value.filePath}" and "${target.value.filePath}".`,
        );
      }
      const managed =
        existing.value.kind === 'managed' ? existing.value : target.value;
      const mod = existing.value.kind === 'mod' ? existing.value : target.value;
      if (managed.kind === 'managed' && mod.kind === 'mod') {
        throw new Error(
          `Managed D2RLoader package "${managed.packageName}" conflicts with an enabled mod at the same normalized output target: "${mod.filePath}" and "${managed.filePath}".`,
        );
      }
      throw new Error(
        'Unexpected normalized D2RLoader output target conflict.',
      );
    }
    if (existing.value.kind === 'mod' && target.value.kind === 'managed') {
      managedFilesCoveredByMods.add(target.value.deployment);
    }
  }
  const [shapeConflict] = findFileDirectoryTargetConflicts(outputTargets);
  if (shapeConflict != null) {
    const ancestor = shapeConflict.ancestor.value;
    const descendant = shapeConflict.descendant.value;
    if (ancestor.kind === 'mod' && descendant.kind === 'mod') {
      throw new Error(
        `Enabled mods contain a file/directory conflict at "${ancestor.filePath}" and "${descendant.filePath}".`,
      );
    }
    if (ancestor.kind === 'managed' && descendant.kind === 'managed') {
      throw new Error(
        `Managed D2RLoader packages contain a file/directory conflict at "${ancestor.filePath}" and "${descendant.filePath}".`,
      );
    }
    if (ancestor.kind === 'managed') {
      throw new Error(
        `Managed D2RLoader package "${ancestor.packageName}" has a file/directory conflict with an enabled mod at "${descendant.filePath}" and "${ancestor.filePath}".`,
      );
    }
    if (descendant.kind === 'managed') {
      throw new Error(
        `Managed D2RLoader package "${descendant.packageName}" has a file/directory conflict with an enabled mod at "${ancestor.filePath}" and "${descendant.filePath}".`,
      );
    }
    throw new Error('Unexpected D2RLoader output target conflict.');
  }
  const applied: string[] = [];
  for (const file of deployment) {
    if (managedFilesCoveredByMods.has(file)) continue;
    const relativePath =
      file.targetRoot === 'data'
        ? file.targetPath
        : path.join('..', '..', 'd2rloader', file.targetPath);
    const data = file.data;
    if (runtime.fileManager.exists(relativePath)) {
      const current = runtime.fileManager.getData(relativePath);
      if (current == null || hashBuffer(current) !== file.sha256) {
        throw new Error(
          `Managed D2RLoader package "${file.packageName}" conflicts with an enabled mod at "${relativePath}".`,
        );
      }
      continue;
    }
    await runtime.fileManager.read(relativePath, MANAGED_PACKAGE_OPERATION);
    runtime.fileManager.setData(relativePath, data);
    await runtime.fileManager.write(relativePath, MANAGED_PACKAGE_OPERATION);
    applied.push(relativePath);
  }
  return applied;
}

export function deleteD2RLoaderPluginPackage(
  appRoot: string,
  packageName: string,
): void {
  const packagesRoot = getSafeManagedPackagesRoot(appRoot);
  const packagePath = getValidatedD2RLoaderPackagePath(appRoot, packageName);
  if (existsSync(packagePath)) {
    rmSync(packagePath, { force: true, recursive: true });
  }
  mkdirSync(packagesRoot, { recursive: true });
}

function assertExpectedPluginSourceRevision(expectedSha256: string): void {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new Error('Invalid expected D2RLoader file revision hash.');
  }
}

function assertPluginSourceRevision(
  filePath: string,
  expectedSha256: string,
): void {
  if (hashFile(filePath).toLowerCase() !== expectedSha256.toLowerCase()) {
    throw createD2RLoaderPluginEditConflictError(
      'The D2RLoader file changed since the inventory was refreshed. Refresh and try again.',
    );
  }
}

function deleteModPluginSourceFile(
  filePath: string,
  expectedSha256: string,
): void {
  assertPluginSourceRevision(filePath, expectedSha256);
  const backupPath = path.join(
    path.dirname(filePath),
    `.d2rmm-delete-${randomUUID()}.bak`,
  );
  let originalMoved = false;
  try {
    renameSync(filePath, backupPath);
    originalMoved = true;
    assertPluginSourceRevision(backupPath, expectedSha256);
    rmSync(backupPath);
    originalMoved = false;
  } catch (error) {
    if (originalMoved && existsSync(backupPath) && !existsSync(filePath)) {
      try {
        renameSync(backupPath, filePath);
        originalMoved = false;
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Failed to delete the mod D2RLoader file and restore its previous contents.',
        );
      }
    }
    throw error;
  }
}

function deleteManagedPluginPackageSource(
  appRoot: string,
  source: Extract<D2RLoaderPluginSource, { sourceType: 'managed' }>,
  expectedSha256: string,
): void {
  let packagePath: string;
  let manifest: D2RLoaderPackageManifest;
  try {
    packagePath = getValidatedD2RLoaderPackagePath(appRoot, source.packageName);
    manifest = readPackageManifest(packagePath);
  } catch (error) {
    throw createD2RLoaderPluginEditConflictError(
      `Managed package "${source.packageName}" changed since the inventory was refreshed. Refresh and try again. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const manifestFile = manifest.files.find(
    (file) => pathKey(file.sourcePath) === pathKey(source.sourcePath),
  );
  if (manifestFile == null) {
    throw createD2RLoaderPluginEditConflictError(
      `Managed package file no longer exists: "${source.sourcePath}". Refresh the inventory.`,
    );
  }
  let filePath: string;
  try {
    filePath = getManagedPackageSourcePath(
      packagePath,
      manifestFile.sourcePath,
    );
  } catch (error) {
    throw createD2RLoaderPluginEditConflictError(
      `Managed package file changed since the inventory was refreshed: "${source.sourcePath}". Refresh and try again. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  assertPluginSourceRevision(filePath, expectedSha256);

  const backupPath = path.join(
    path.dirname(packagePath),
    `.d2rmm-delete-${randomUUID()}.bak`,
  );
  let packageMoved = false;
  try {
    renameSync(packagePath, backupPath);
    packageMoved = true;
    assertPluginSourceRevision(
      getManagedPackageSourcePath(backupPath, manifestFile.sourcePath),
      expectedSha256,
    );
    rmSync(backupPath, { force: true, recursive: true });
    packageMoved = false;
  } catch (error) {
    if (packageMoved && existsSync(backupPath) && !existsSync(packagePath)) {
      try {
        renameSync(backupPath, packagePath);
        packageMoved = false;
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Failed to delete managed package "${source.packageName}" and restore it.`,
        );
      }
    }
    throw error;
  }
}

export function deleteD2RLoaderPluginSource(
  appRoot: string,
  source: D2RLoaderPluginSource,
  expectedSha256: string,
): void {
  assertExpectedPluginSourceRevision(expectedSha256);
  if (source.sourceType === 'managed') {
    deleteManagedPluginPackageSource(appRoot, source, expectedSha256);
    return;
  }

  const resolved = resolveModPluginSource(appRoot, source);
  deleteModPluginSourceFile(resolved.filePath, expectedSha256);
}

let packageMutationTail: Promise<void> = Promise.resolve();

function runPackageMutation<T>(operation: () => T | Promise<T>): Promise<T> {
  const result = packageMutationTail.then(operation, operation);
  packageMutationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function initD2RLoaderPluginAPI(): Promise<void> {
  const appRoot = getAppPath();
  mkdirSync(getSafeManagedPackagesRoot(appRoot), { recursive: true });
  provideAPI('D2RLoaderPluginAPI', {
    deletePackage: async (packageName) =>
      runPackageMutation(() =>
        deleteD2RLoaderPluginPackage(appRoot, packageName),
      ),
    deleteSource: async (source, expectedSha256) =>
      runPackageMutation(() =>
        deleteD2RLoaderPluginSource(appRoot, source, expectedSha256),
      ),
    importSources: async (sourcePaths) =>
      runPackageMutation(() =>
        importD2RLoaderPluginSources(appRoot, sourcePaths),
      ),
    readEditableJSON: async (source) =>
      readD2RLoaderPluginSourceJSON(appRoot, source),
    readInventory: async (modIDs) =>
      runPackageMutation(async () => {
        await synchronizeD2RLoaderPluginDirectory(appRoot);
        return readD2RLoaderPluginInventory(appRoot, modIDs);
      }),
    saveEditableJSON: async (source, expectedSha256, contents) =>
      runPackageMutation(() =>
        saveD2RLoaderPluginSourceJSON(
          appRoot,
          source,
          expectedSha256,
          contents,
        ),
      ),
  } as ID2RLoaderPluginAPI);
}
