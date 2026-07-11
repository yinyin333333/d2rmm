import { statSync } from 'fs';
import { Entry, open, ZipFile } from 'yauzl';
import {
  ResourceBudget,
  ResourceLimits,
  ResourceUsage,
} from './ResourceBudget';

function getArchiveEntryDepth(entry: Entry): number {
  return entry.fileName.split('/').filter((segment) => segment !== '').length;
}

// Diagnostic/configuration seam only. The install path intentionally does not
// enforce a product default until real-world archive distributions define one.
export async function inspectZipArchive(
  zipPath: string,
  limits: ResourceLimits,
): Promise<ResourceUsage> {
  const budget = new ResourceBudget(limits);
  budget.addBytes(statSync(zipPath).size, zipPath);

  return new Promise((resolve, reject) => {
    open(
      zipPath,
      {
        autoClose: true,
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (openError, zipFile: ZipFile) => {
        if (openError != null) {
          reject(openError);
          return;
        }

        let settled = false;
        const fail = (error: Error): void => {
          if (settled) return;
          settled = true;
          zipFile.close();
          reject(error);
        };

        zipFile.on('error', fail);
        zipFile.on('entry', (entry: Entry) => {
          if (settled) return;
          try {
            budget.addEntry({
              bytes: entry.uncompressedSize,
              depth: getArchiveEntryDepth(entry),
              name: entry.fileName,
            });
            zipFile.readEntry();
          } catch (error) {
            fail(
              error instanceof Error
                ? error
                : new Error('ZIP resource preflight failed.'),
            );
          }
        });
        zipFile.on('end', () => {
          if (settled) return;
          settled = true;
          resolve(budget.usage);
        });
        zipFile.readEntry();
      },
    );
  });
}
