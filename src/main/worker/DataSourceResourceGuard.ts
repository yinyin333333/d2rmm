import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import {
  ResourceBudget,
  ResourceLimits,
  ResourceUsage,
} from './ResourceBudget';

export type CopySourceTreeOptions = {
  budget?: ResourceBudget;
  destinationPath: string;
  fileExists: (destinationPath: string) => boolean;
  limits?: ResourceLimits;
  overwrite: boolean;
  setFileData: (destinationPath: string, data: Buffer) => void;
  sourcePath: string;
};

export type CopySourceTreeResult = {
  paths: string[];
  usage: ResourceUsage;
};

type PendingSource = {
  depth: number;
  destinationPath: string;
  sourcePath: string;
};

type FileToCopy = PendingSource & {
  size: number;
};

// Diagnostic/configuration seam only. Callers must provide an explicit budget
// or limits; normal data-mod copying keeps its existing compatibility behavior.
export function copySourceTreeBounded(
  options: CopySourceTreeOptions,
): CopySourceTreeResult {
  const {
    destinationPath,
    fileExists,
    limits,
    overwrite,
    setFileData,
    sourcePath,
  } = options;
  if (options.budget == null && limits == null) {
    throw new Error('Explicit resource limits are required.');
  }
  const budget = options.budget ?? new ResourceBudget(limits!);
  if (!existsSync(sourcePath)) {
    return { paths: [], usage: budget.usage };
  }

  const pending: PendingSource[] = [{ depth: 1, destinationPath, sourcePath }];
  const filesToCopy: FileToCopy[] = [];

  // Complete the metadata walk before reading or publishing any file data.
  while (pending.length > 0) {
    const current = pending.pop()!;
    const stat = statSync(current.sourcePath);

    if (stat.isDirectory()) {
      budget.addEntry({
        bytes: 0,
        depth: current.depth,
        name: current.sourcePath,
      });
      const entries = readdirSync(current.sourcePath, { withFileTypes: true });
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        pending.push({
          depth: current.depth + 1,
          destinationPath: path.join(current.destinationPath, entry.name),
          sourcePath: path.join(current.sourcePath, entry.name),
        });
      }
      continue;
    }

    const shouldCopy = overwrite || !fileExists(current.destinationPath);
    budget.addEntry({
      bytes: shouldCopy ? stat.size : 0,
      depth: current.depth,
      name: current.sourcePath,
    });
    if (shouldCopy) {
      filesToCopy.push({ ...current, size: stat.size });
    }
  }

  const paths: string[] = [];
  for (const file of filesToCopy) {
    const data = readFileSync(file.sourcePath);
    if (data.length !== file.size) {
      throw new Error(
        `Source file changed during resource preflight: "${file.sourcePath}".`,
      );
    }
    setFileData(file.destinationPath, data);
    paths.push(file.destinationPath);
  }

  return { paths, usage: budget.usage };
}
