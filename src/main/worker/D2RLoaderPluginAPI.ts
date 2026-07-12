import type {
  D2RLoaderPluginEditableJSON,
  D2RLoaderPluginEditResult,
  D2RLoaderPluginImportResult,
  D2RLoaderPluginInventory,
  D2RLoaderPluginInventoryItem,
  D2RLoaderPluginPackageSummary,
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
import { getAppPath } from './AppInfoAPI';
import { inspectZipArchive } from './ArchiveResourceGuard';
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
const REQUIRED_PLUGIN_EXPORTS = [
  'D2RLoaderGetPluginInfo',
  'D2RLoaderLoadPlugin',
] as const;
const PACKAGE_RESOURCE_LIMITS: ResourceLimits = {
  maxBytes: 512 * 1024 * 1024,
  maxDepth: 64,
  maxEntries: 10_000,
};
const MAX_EDITABLE_JSON_BYTES = 4 * 1024 * 1024;
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

function validateManagedPackagesRoot(rootPath: string): number {
  const names = new Set<string>();
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
    if (
      entry.isSymbolicLink() ||
      stat.isSymbolicLink() ||
      !entry.isDirectory() ||
      !stat.isDirectory()
    ) {
      throw new Error(
        `Managed D2RLoader package root contains a non-package entry: "${packagePath}".`,
      );
    }
    const nameKey = entry.name.toLowerCase();
    if (names.has(nameKey)) {
      throw new Error(
        `Managed D2RLoader package root contains duplicate package names: "${entry.name}".`,
      );
    }
    names.add(nameKey);
    try {
      readPackageManifest(packagePath);
    } catch (error) {
      throw new Error(
        `Managed D2RLoader package root contains an entry that is not a D2RMM package: "${packagePath}". ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return names.size;
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
    throw new Error(
      `Both current and legacy D2RLoader package roots exist; refusing to merge or overwrite them: "${root}" and "${legacyRoot}".`,
    );
  }
  if (rootStat != null) {
    validateManagedPackagesRoot(root);
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
    const expectedSource = path.resolve(canonicalRoot, file.relativePath);
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

async function preparePathSource(sourcePath: string): Promise<PreparedSource> {
  const absoluteSource = path.resolve(sourcePath);
  if (!existsSync(absoluteSource)) {
    throw new Error(
      `D2RLoader package source does not exist: "${sourcePath}".`,
    );
  }
  const stat = lstatSync(absoluteSource);
  if (stat.isSymbolicLink()) {
    throw new Error(
      'D2RLoader package source cannot be a symbolic link or junction.',
    );
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
    await withNoAsar(() => decompress(archiveSnapshot, extractRoot));
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
  return REQUIRED_PLUGIN_EXPORTS.every(
    (exportName) => buffer.indexOf(Buffer.from(exportName, 'ascii')) >= 0,
  );
}

function decodeStrictUTF8(buffer: Buffer): string {
  const decoded = buffer.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(buffer)) {
    throw new Error('JSON/JSONC must use valid UTF-8 encoding.');
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
  let loaderIndex = lowerSegments.lastIndexOf('d2rloader');
  if (sourceRootName.toLowerCase() === 'd2rloader') {
    loaderIndex = -1;
  }
  const targetSegments = segments.slice(loaderIndex + 1);
  const category = targetSegments[0]?.toLowerCase();
  if (loaderIndex < 0 && sourceRootName.toLowerCase() !== 'd2rloader') {
    return null;
  }
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

function createPackageManifest(
  packageName: string,
  sourceRootName: string,
  files: CollectedSourceFile[],
  allowUnsupportedJSON: boolean = false,
): D2RLoaderPackageManifest {
  const warnings: string[] = [];
  const dllBuffers = files
    .filter((file) => path.extname(file.relativePath).toLowerCase() === '.dll')
    .map((file) => readBoundedFile(file.absolutePath))
    .filter(hasRequiredPluginExports);
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
      return {
        role: 'config',
        sha256,
        sourcePath: file.relativePath,
        targetPath: path.join('config', fileName),
        targetRoot: 'd2rloader',
      };
    } else {
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

    if (!/^readme(?:\.|$)/i.test(fileName)) {
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
      individualSources.push(absolutePath);
      continue;
    }
    const parentKey = pathKey(path.dirname(absolutePath));
    looseFilesByParent.set(parentKey, [
      ...(looseFilesByParent.get(parentKey) ?? []),
      absolutePath,
    ]);
  }

  const preparedSources: PreparedSource[] = [];
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
    const classifiedBySource = new Map(
      classified.files.map((file) => [pathKey(file.sourcePath), file]),
    );
    const mismatch =
      manifest.files.length !== classified.files.length ||
      manifest.files.some((file) => {
        const expected = classifiedBySource.get(pathKey(file.sourcePath));
        return (
          expected == null ||
          expected.role !== file.role ||
          expected.sha256.toLowerCase() !== file.sha256.toLowerCase() ||
          expected.targetRoot !== file.targetRoot ||
          expected.targetPath !== file.targetPath
        );
      });
    if (mismatch) {
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

function assertPackageRevisionUnchanged(
  packagePath: string,
  expectedManifest: D2RLoaderPackageManifest,
  editedSourcePath: string,
): void {
  let latestManifest: D2RLoaderPackageManifest;
  try {
    latestManifest = readPackageManifest(packagePath);
  } catch (error) {
    throw new Error(
      `Managed package changed before the JSON/JSONC edit could be committed. Refresh and reopen "${editedSourcePath}". ${
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
    throw new Error(
      `Managed package changed before the JSON/JSONC edit could be committed. Refresh and reopen "${editedSourcePath}".`,
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

function getEditableJSONManifestFile(
  manifest: D2RLoaderPackageManifest,
  sourcePath: string,
): D2RLoaderPackageFile & {
  role: 'patch' | 'plugin';
  targetPath: string;
  targetRoot: 'd2rloader';
} {
  const file = manifest.files.find(
    (candidate) => candidate.sourcePath === sourcePath,
  );
  if (
    file == null ||
    !/\.jsonc?$/i.test(file.sourcePath) ||
    (file.role !== 'patch' && file.role !== 'plugin') ||
    file.targetRoot !== 'd2rloader' ||
    file.targetPath == null
  ) {
    throw new Error(
      `Managed package file is not an editable plugin or patch JSON/JSONC file: "${sourcePath}".`,
    );
  }
  return file as D2RLoaderPackageFile & {
    role: 'patch' | 'plugin';
    targetPath: string;
    targetRoot: 'd2rloader';
  };
}

function assertEditableJSONSize(byteLength: number): void {
  if (byteLength > MAX_EDITABLE_JSON_BYTES) {
    throw new Error(
      `Editable JSON/JSONC exceeds the ${MAX_EDITABLE_JSON_BYTES}-byte editor limit (${byteLength} bytes).`,
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
  const file = getEditableJSONManifestFile(manifest, sourcePath);
  const filePath = getManagedPackageSourcePath(packagePath, file.sourcePath);
  const stat = lstatSync(filePath);
  assertEditableJSONSize(stat.size);
  const data = readBoundedFile(filePath);
  const contents = decodeStrictUTF8(data);
  try {
    parseJSONC(data);
  } catch (error) {
    throw new Error(
      `Managed package JSON/JSONC is invalid: "${sourcePath}". ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const sha256 = hashBuffer(data);
  if (sha256.toLowerCase() !== file.sha256.toLowerCase()) {
    throw new Error(
      `Managed package JSON/JSONC changed while opening the editor: "${sourcePath}". Refresh and try again.`,
    );
  }
  return {
    contents,
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
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new Error('Invalid expected JSON/JSONC revision hash.');
  }
  const editedData = Buffer.from(contents, 'utf8');
  assertEditableJSONSize(editedData.length);
  try {
    parseJSONC(editedData);
  } catch (error) {
    throw new Error(
      `Cannot save invalid JSON/JSONC: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const packagePath = getValidatedD2RLoaderPackagePath(appRoot, packageName);
  const currentManifest = readPackageManifest(packagePath);
  const currentFile = getEditableJSONManifestFile(currentManifest, sourcePath);
  const currentSourcePath = getManagedPackageSourcePath(
    packagePath,
    currentFile.sourcePath,
  );
  assertEditableJSONSize(lstatSync(currentSourcePath).size);
  const currentData = readBoundedFile(currentSourcePath);
  if (hashBuffer(currentData).toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Managed package JSON/JSONC changed since the editor was opened: "${sourcePath}". Refresh and reopen it.`,
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
      throw new Error(
        `Managed package JSON/JSONC changed while staging the edit: "${sourcePath}". Refresh and reopen it.`,
      );
    }
    writeFileSync(stagedFilePath, editedData);
    const updatedManifest = createPackageManifest(
      currentManifest.name,
      currentManifest.name,
      collectSourceFiles(stagingSource),
    );
    const updatedFile = getEditableJSONManifestFile(
      updatedManifest,
      currentFile.sourcePath,
    );
    if (
      updatedFile.role !== currentFile.role ||
      updatedFile.targetRoot !== currentFile.targetRoot ||
      updatedFile.targetPath !== currentFile.targetPath
    ) {
      throw new Error(
        `Edited JSON/JSONC changed its deployment classification: "${sourcePath}".`,
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
      throw new Error(
        `Managed package changed while staging the JSON/JSONC edit. Refresh and reopen "${sourcePath}".`,
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

function getManagedPackageEntries(packagesRoot: string): Dirent[] {
  if (!existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        !entry.name.startsWith('.') &&
        entry.isDirectory() &&
        !entry.isSymbolicLink(),
    )
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}

function manifestToSummary(
  manifest: D2RLoaderPackageManifest,
): D2RLoaderPluginPackageSummary {
  const filesFor = (role: D2RLoaderPackageFileRole): string[] =>
    manifest.files
      .filter((file) => file.role === role)
      .map((file) => file.targetPath ?? file.sourcePath)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return {
    configFiles: filesFor('config'),
    dataFiles: filesFor('data'),
    name: manifest.name,
    patchFiles: filesFor('patch'),
    pluginFiles: filesFor('plugin'),
    unmappedFiles: filesFor('support'),
    warnings: manifest.warnings,
  };
}

function inventoryItem(
  sourceType: 'managed' | 'mod',
  sourceName: string,
  relativePath: string,
  filePath: string,
  packageName: string | null,
  sha256: string = hashFile(filePath),
  editableSourcePath: string | null = null,
): D2RLoaderPluginInventoryItem {
  return {
    editableSourcePath,
    id: `${sourceType}:${sourceName}:${editableSourcePath ?? relativePath}`,
    name: path.basename(relativePath),
    packageName,
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
        result.push(
          inventoryItem('mod', sourceName, relativePath, entryPath, null),
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
): string[] {
  const conflicts: string[] = [];
  for (const [category, items] of [
    ['plugins', plugins],
    ['patches', patches],
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

  for (const modID of [...modIDs].sort((a, b) => a.localeCompare(b))) {
    const modRoot = path.resolve(appRoot, 'mods', modID);
    const relativeModPath = path.relative(
      path.resolve(appRoot, 'mods'),
      modRoot,
    );
    if (
      relativeModPath.length === 0 ||
      path.isAbsolute(relativeModPath) ||
      path.dirname(relativeModPath) !== '.'
    ) {
      throw new Error(`Invalid mod ID for D2RLoader inventory: "${modID}".`);
    }
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
      const sourceName =
        candidateRelative === '' ? modID : `${modID} (${candidateRelative})`;
      const pluginRoot = findCaseInsensitiveDirectory(loaderRoot, 'plugins');
      const patchRoot = findCaseInsensitiveDirectory(loaderRoot, 'patches');
      if (pluginRoot != null) {
        plugins.push(
          ...listInventoryFiles(pluginRoot, sourceName, modInventoryBudget),
        );
      }
      if (patchRoot != null) {
        patches.push(
          ...listInventoryFiles(patchRoot, sourceName, modInventoryBudget),
        );
      }
    }
  }

  for (const entry of getManagedPackageEntries(packagesRoot)) {
    const packagePath = path.resolve(packagesRoot, entry.name);
    const manifest = readPackageManifest(packagePath);
    packages.push(manifestToSummary(manifest));
    for (const file of manifest.files) {
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
          (file.role === 'plugin' || file.role === 'patch');
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
        (file.role !== 'plugin' && file.role !== 'patch')
      ) {
        continue;
      }
      if (sourcePath == null || sourceHash == null) {
        throw new Error(
          `Managed package inventory source is missing: "${file.sourcePath}".`,
        );
      }
      const category = file.role === 'plugin' ? 'plugins' : 'patches';
      const categoryPrefix = `${category}${path.sep}`;
      const relativePath = file.targetPath
        .toLowerCase()
        .startsWith(categoryPrefix.toLowerCase())
        ? file.targetPath.slice(categoryPrefix.length)
        : path.basename(file.targetPath);
      const item = inventoryItem(
        'managed',
        manifest.name,
        relativePath,
        sourcePath,
        manifest.name,
        sourceHash,
        /\.jsonc?$/i.test(file.sourcePath) ? file.sourcePath : null,
      );
      (file.role === 'plugin' ? plugins : patches).push(item);
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

  return {
    conflicts: [
      ...getInventoryConflicts(plugins, patches),
      ...managedTargetConflicts,
    ],
    managedSignature:
      managedSignatureParts.size === 0
        ? ''
        : createHash('sha256')
            .update(Array.from(managedSignatureParts).sort().join('\0'))
            .digest('hex'),
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
  if (existsSync(packagesRoot) && readdirSync(packagesRoot).length === 0) {
    rmdirSync(packagesRoot);
  }
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
  provideAPI('D2RLoaderPluginAPI', {
    deletePackage: async (packageName) =>
      runPackageMutation(() =>
        deleteD2RLoaderPluginPackage(getAppPath(), packageName),
      ),
    importSources: async (sourcePaths) =>
      runPackageMutation(() =>
        importD2RLoaderPluginSources(getAppPath(), sourcePaths),
      ),
    readEditableJSON: async (packageName, sourcePath) =>
      readD2RLoaderPluginPackageJSON(getAppPath(), packageName, sourcePath),
    readInventory: async (modIDs) =>
      readD2RLoaderPluginInventory(getAppPath(), modIDs),
    saveEditableJSON: async (
      packageName,
      sourcePath,
      expectedSha256,
      contents,
    ) =>
      runPackageMutation(() =>
        saveD2RLoaderPluginPackageJSON(
          getAppPath(),
          packageName,
          sourcePath,
          expectedSha256,
          contents,
        ),
      ),
  } as ID2RLoaderPluginAPI);
}
