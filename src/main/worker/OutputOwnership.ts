import { existsSync, lstatSync, rmSync } from 'fs';
import path from 'path';
import { resolvePathInsideRoot } from './PathSafety';

export const OUTPUT_OWNERSHIP_MANIFEST = '.d2rmm-owned-files.json';

export type LegacyOutputOwnershipCleanupResult = {
  removed: boolean;
  skipped: boolean;
};

export function removeLegacyOutputOwnershipManifest(
  outputRoot: string,
): LegacyOutputOwnershipCleanupResult {
  const normalizedRoot = path.resolve(outputRoot);
  const manifestPath = resolvePathInsideRoot(
    normalizedRoot,
    normalizedRoot,
    OUTPUT_OWNERSHIP_MANIFEST,
  );
  if (!existsSync(manifestPath)) {
    return { removed: false, skipped: false };
  }

  if (!lstatSync(manifestPath).isFile()) {
    return { removed: false, skipped: true };
  }

  rmSync(manifestPath, { force: true });
  return { removed: true, skipped: false };
}
