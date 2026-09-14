import path from 'path';
import {
  readWindowsFileVersion,
  type D2RLoaderVersionReader,
} from './D2RLoaderInstaller';
import type { InstallationRuntime } from './InstallationRuntime';

export const D2R_LOADER_METADATA_PATH = path.join(
  '..',
  '..',
  'd2rloader',
  'metadata.json',
);

const METADATA_OPERATION = 'D2RLoader metadata';

type D2RLoaderMetadataRuntime = Pick<
  InstallationRuntime,
  'console' | 'fileManager' | 'options'
>;

export function createD2RLoaderMetadata(version: string): Buffer {
  const metadata = [
    '{',
    '  "schemaVersion": 1,',
    '  "metadata": {',
    '    "modVersion": "",',
    '    "author": "",',
    '    "description": "",',
    '    "website": ""',
    '  },',
    '  "d2rloader": {',
    `    "version": ${JSON.stringify(version)}`,
    '  }',
    '}',
    '',
  ].join('\r\n');
  return Buffer.from(metadata, 'utf8');
}

export async function ensureD2RLoaderMetadata(
  runtime: D2RLoaderMetadataRuntime,
  readVersion: D2RLoaderVersionReader = readWindowsFileVersion,
): Promise<boolean> {
  if (runtime.options.useD2RLoader !== true || runtime.options.isDryRun) {
    return false;
  }

  if (runtime.fileManager.exists(D2R_LOADER_METADATA_PATH)) {
    return false;
  }

  const executablePath = path.resolve(
    runtime.options.gamePath,
    'D2RLoader.exe',
  );
  const version = readVersion(executablePath);
  if (version == null) {
    runtime.console.warn(
      `Could not read the file version from "${executablePath}" while generating d2rloader/metadata.json.`,
    );
    return false;
  }

  await runtime.fileManager.read(D2R_LOADER_METADATA_PATH, METADATA_OPERATION);
  runtime.fileManager.setData(
    D2R_LOADER_METADATA_PATH,
    createD2RLoaderMetadata(version),
  );
  await runtime.fileManager.write(D2R_LOADER_METADATA_PATH, METADATA_OPERATION);
  return true;
}
