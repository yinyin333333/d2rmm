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

export function assertSafeZipEntryName(entryName: string): void {
  const normalized = entryName.replace(/\\/g, '/');
  const rawSegments = normalized.split('/');
  const segments = normalized.endsWith('/')
    ? rawSegments.slice(0, -1)
    : rawSegments;
  if (
    entryName.includes('\0') ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    throw new Error(`Unsafe ZIP entry path: "${entryName}".`);
  }
}

function assertZipEntryIsNotLink(entry: Entry): void {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const unixFileType = unixMode & 0o170000;
  const dosAttributes = entry.externalFileAttributes & 0xffff;
  const windowsReparsePoint = (dosAttributes & 0x400) !== 0;
  if (unixFileType === 0o120000 || windowsReparsePoint) {
    throw new Error(`Unsafe ZIP symbolic-link entry: "${entry.fileName}".`);
  }
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
        const seenEntryNames = new Set<string>();
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
            assertSafeZipEntryName(entry.fileName);
            assertZipEntryIsNotLink(entry);
            const entryKey = entry.fileName
              .replace(/\\/g, '/')
              .split('/')
              .filter(Boolean)
              .join('/')
              .toLowerCase();
            if (seenEntryNames.has(entryKey)) {
              throw new Error(
                `Unsafe duplicate ZIP entry path: "${entry.fileName}".`,
              );
            }
            seenEntryNames.add(entryKey);
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
