import type { D2RLoaderLogScope } from 'bridge/ShellAPI';
import { Zip, ZipDeflate } from 'fflate';
import { createReadStream } from 'fs';
import path from 'path';
import { te } from 'shared/i18n';
import { v4 as uuidv4 } from 'uuid';
import { lstat, open, readdir, rename, rm } from 'fs/promises';

type LogFile = { source: string; name: string; mtime: Date };
export type LogExportPlan = {
  files: LogFile[];
  missingDirectories: string[];
};

export async function collectD2RLoaderLogs(
  gamePath: string,
  outputModName: string,
  scope: D2RLoaderLogScope,
): Promise<LogExportPlan> {
  if (!['loader', 'loader-and-mod', 'all'].includes(scope)) {
    throw new Error('Invalid D2RLoader log export scope.');
  }
  if (!gamePath.trim() || !path.isAbsolute(gamePath)) {
    throw te('logs.loader.invalidGamePath');
  }
  if (
    scope !== 'loader' &&
    (!outputModName.trim() ||
      outputModName === '.' ||
      outputModName === '..' ||
      /[\\/:*?"<>|]/.test(outputModName))
  ) {
    throw te('logs.loader.invalidModName');
  }
  const gameRoot = path.resolve(gamePath);
  const directories = ['d2rloader/logs'];
  if (scope !== 'loader') {
    directories.push(`mods/${outputModName}/d2rloader/logs`);
  }
  if (scope === 'all') directories.push('d2rloader/crashes');
  const plan: LogExportPlan = { files: [], missingDirectories: [] };

  const visit = async (name: string): Promise<void> => {
    const source = path.join(gameRoot, name);
    const stats = await lstat(source);
    // Do not follow links or junctions outside the requested log folders.
    if (stats.isSymbolicLink()) return;
    if (stats.isDirectory()) {
      for (const entry of await readdir(source)) {
        await visit(`${name}/${entry}`);
      }
    } else if (stats.isFile()) {
      plan.files.push({ source, name, mtime: stats.mtime });
    }
  };

  for (const directory of directories) {
    // Check every parent too, since the mod or d2rloader may be a junction.
    let unavailable = false;
    let currentPath = gameRoot;
    for (const segment of directory.split('/')) {
      currentPath = path.join(currentPath, segment);
      try {
        const stats = await lstat(currentPath);
        if (stats.isSymbolicLink() || !stats.isDirectory()) unavailable = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        unavailable = true;
      }
      if (unavailable) break;
    }
    if (unavailable) plan.missingDirectories.push(directory);
    else await visit(directory);
  }
  if (plan.files.length === 0) throw te('logs.loader.noFiles');
  return plan;
}

export async function writeD2RLoaderLogZip(
  plan: LogExportPlan,
  destination: string,
): Promise<void> {
  // Stage beside the destination, so a failed export preserves an existing ZIP.
  const temporaryPath = `${destination}.${uuidv4()}.tmp`;
  const output = await open(temporaryPath, 'wx');
  const chunks: Uint8Array[] = [];
  const archive = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  const flush = async (): Promise<void> => {
    for (const chunk of chunks.splice(0)) await output.writeFile(chunk);
  };
  try {
    const files = plan.files.filter(
      (file) => path.resolve(file.source) !== path.resolve(destination),
    );
    if (files.length === 0) throw te('logs.loader.noFiles');
    for (const file of files) {
      const entry = new ZipDeflate(file.name, { level: 6 });
      entry.mtime = file.mtime;
      archive.add(entry);
      // Stream crash dumps too, without loading the entire archive into memory.
      for await (const chunk of createReadStream(file.source)) {
        entry.push(chunk as Buffer);
        await flush();
      }
      entry.push(new Uint8Array(0), true);
      await flush();
    }
    archive.end();
    await flush();
    await output.close();
    await rename(temporaryPath, destination);
  } catch (error) {
    archive.terminate();
    await output.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
