import type { IInstallModsOptions } from 'bridge/BridgeAPI';
import { lstatSync, realpathSync } from 'fs';
import path from 'path';

type ResolvePathInsideRootOptions = {
  allowAbsoluteInput?: boolean;
  allowRoot?: boolean;
};

type OutputPathOptions = Pick<
  IInstallModsOptions,
  'gamePath' | 'mergedPath' | 'outputModName'
>;

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function canonicalizeWithExistingParent(inputPath: string): string {
  let currentPath = path.resolve(inputPath);
  const missingSegments: string[] = [];

  while (true) {
    try {
      const canonicalParent = realpathSync.native(currentPath);
      return path.resolve(canonicalParent, ...missingSegments.reverse());
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }

      try {
        if (lstatSync(currentPath).isSymbolicLink()) {
          throw new Error(
            `Path contains an unresolved symbolic link: "${currentPath}".`,
          );
        }
      } catch (lstatError) {
        if (!isMissingPathError(lstatError)) {
          throw lstatError;
        }
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        throw error;
      }
      missingSegments.push(path.basename(currentPath));
      currentPath = parentPath;
    }
  }
}

function isAbsolutePathSyntax(inputPath: string): boolean {
  return (
    path.isAbsolute(inputPath) ||
    path.posix.isAbsolute(inputPath) ||
    path.win32.isAbsolute(inputPath) ||
    /^[A-Za-z]:/.test(inputPath)
  );
}

function assertContained(
  allowedRoot: string,
  candidatePath: string,
  allowRoot: boolean,
): void {
  const relativePath = path.relative(allowedRoot, candidatePath);
  const isRoot = relativePath === '';
  const isOutside =
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath);

  if (isOutside || (isRoot && !allowRoot)) {
    throw new Error(
      `Path "${candidatePath}" points outside of allowed directory "${allowedRoot}".`,
    );
  }
}

export function resolvePathInsideRoot(
  allowedRoot: string,
  basePath: string,
  inputPath: string,
  {
    allowAbsoluteInput = false,
    allowRoot = false,
  }: ResolvePathInsideRootOptions = {},
): string {
  const hasAbsoluteSyntax = isAbsolutePathSyntax(inputPath);
  if (hasAbsoluteSyntax && !allowAbsoluteInput) {
    throw new Error(`Absolute path is not allowed: "${inputPath}".`);
  }
  if (hasAbsoluteSyntax && !path.isAbsolute(inputPath)) {
    throw new Error(`Non-native absolute path is not allowed: "${inputPath}".`);
  }

  const resolvedRoot = path.resolve(allowedRoot);
  const resolvedCandidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(basePath, inputPath);

  assertContained(resolvedRoot, resolvedCandidate, allowRoot);

  const canonicalRoot = canonicalizeWithExistingParent(resolvedRoot);
  const canonicalCandidate = canonicalizeWithExistingParent(resolvedCandidate);
  assertContained(canonicalRoot, canonicalCandidate, allowRoot);

  return resolvedCandidate;
}

export function getModOutputEnvelopePath(options: OutputPathOptions): string {
  const modsRoot = path.resolve(options.gamePath, 'mods');
  return resolvePathInsideRoot(modsRoot, modsRoot, options.outputModName);
}

export function resolveModOutputPath(
  options: OutputPathOptions,
  inputPath: string,
): string {
  const outputPath = path.resolve(options.mergedPath);

  return resolvePathInsideRoot(
    getModOutputEnvelopePath(options),
    outputPath,
    inputPath,
  );
}
