import path from 'path';

export function isPathInside(allowedRoot: string, targetPath: string): boolean {
  const relativePath = path.relative(
    path.resolve(allowedRoot),
    path.resolve(targetPath),
  );
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}
