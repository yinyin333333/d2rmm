import type {
  CopiedFile,
  D2RLoaderSettings,
  IBridgeAPI,
  IInstallModsOptions,
  Mod,
} from 'bridge/BridgeAPI';
import type { ConsoleAPI, ConsoleArg } from 'bridge/ConsoleAPI';
import type { JSONData } from 'bridge/JSON';
import type { ModConfigValue } from 'bridge/ModConfigValue';
import { Relative } from 'bridge/Relative';
import type { ID2S, IStash } from 'bridge/third-party/d2s/d2/types';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { Scope } from 'quickjs-emscripten';
import regedit from 'regedit';
import {
  MappingItem,
  NullableMappedPosition,
  SourceMapConsumer,
  SourceMapGenerator,
} from 'source-map';
import ts from 'typescript';
import packageManifest from '../../../release/app/package.json';
import { te, tl } from '../../shared/i18n';
import { getAppPath, getBaseSavesPath } from './AppInfoAPI';
import { CascFileReadError, readCascFileToBuffer } from './CascFileReader';
import {
  CASC_ERROR_FILE_OFFLINE,
  CASC_FEATURE_ALLOW_DOWNLOAD,
  getCascLib,
  getLastCascLibError,
  makeCascOpenStorageArgs,
  readCString,
} from './CascLib';
import {
  D2R_LOADER_CONFIG_FILE,
  createD2RLoaderConfig,
  updateD2RLoaderConfig,
} from './D2RLoader';
import { downloadAndInstallD2RLoader } from './D2RLoaderInstaller';
import { applyManagedD2RLoaderPackages } from './D2RLoaderPluginAPI';
import {
  // D2RLoader prerequisite pre-application is temporarily disabled.
  // Uncomment this import and the install block below to restore it.
  // applyD2RLoaderPrerequisites,
  clearD2RLoaderOutputDirectory,
} from './D2RLoaderPrerequisites';
import { EventAPI } from './EventAPI';
import { provideAPI } from './IPC';
import { InstallationRuntime } from './InstallationRuntime';
import { encodeJson, parseJson } from './JSONParser';
import { getDataModRootPath, getModAPI } from './ModAPI';
import { runModTransaction } from './ModTransaction';
import { removeLegacyOutputOwnershipManifest } from './OutputOwnership';
import {
  getModOutputEnvelopePath,
  resolveModOutputPath,
  resolvePathInsideRoot,
} from './PathSafety';
import { launchDetachedProcess } from './ProcessLauncher';
import {
  RuntimeOperationBusyError,
  RuntimeOperationGuard,
  RuntimeOperationLease,
  RuntimeOperationName,
} from './RuntimeOperationGuard';
import { parseSprite } from './SpriteParser';
import { encodeTsv, parseTsv } from './TSVParser';
import './asar';
import { datamod } from './datamod';
import {
  getQuickJS,
  getQuickJSProxyAPI,
  installQuickJSExecutionWatchdog,
} from './quickjs';
import * as d2s from './third-party/d2s/index';

let runtime: InstallationRuntime | null = null;
const runtimeOperationGuard = new RuntimeOperationGuard();

function acquireRuntimeOperation(
  operation: RuntimeOperationName,
): RuntimeOperationLease {
  try {
    return runtimeOperationGuard.acquire(operation);
  } catch (error) {
    if (error instanceof RuntimeOperationBusyError) {
      throw te('worker.bridgeapi.operationBusy', {
        active: error.activeOperation,
        requested: error.requestedOperation,
      });
    }
    throw error;
  }
}

function releaseRuntimeOperation(
  lease: RuntimeOperationLease,
  operationRuntime: InstallationRuntime | null,
): void {
  if (lease.release() && runtime === operationRuntime) {
    runtime = null;
  }
}

export function getRuntime(): InstallationRuntime | null {
  return runtime;
}

function getSavesPath(): string {
  return path.resolve(runtime!.options.savesPath);
}

function getOutputPath(): string {
  return path.resolve(runtime!.options.mergedPath);
}

function getOutputRootPath(): string {
  return path.resolve(runtime!.options.mergedPath, '../');
}

function getD2RLoaderConfigFile(gameRoot: string): {
  fileName: string;
  path: string;
} | null {
  const configPath = validatePathIsSafe(
    gameRoot,
    path.resolve(gameRoot, ...D2R_LOADER_CONFIG_FILE.relativePath),
  );

  if (!existsSync(configPath) || !statSync(configPath).isFile()) {
    return null;
  }

  return {
    fileName: D2R_LOADER_CONFIG_FILE.fileName,
    path: configPath,
  };
}

function getPreExtractedDataPath(): string {
  return path.resolve(runtime!.options.preExtractedDataPath);
}

// we don't want mods doing any ../../.. shenanigans
function validatePathIsSafe(allowedRoot: string, absolutePath: string): string {
  try {
    return resolvePathInsideRoot(allowedRoot, allowedRoot, absolutePath, {
      allowAbsoluteInput: true,
      allowRoot: true,
    });
  } catch (error) {
    throw te(
      'worker.bridgeapi.validatePath.outsideAllowed',
      {
        path: path.resolve(absolutePath),
        allowedRoot: path.resolve(allowedRoot),
      },
      error,
    );
  }
}

function resolvePath(inputPath: string, relative: Relative): string {
  switch (relative) {
    case 'App':
      return validatePathIsSafe(
        getAppPath(),
        path.resolve(getAppPath(), inputPath),
      );
    case 'Saves':
      return validatePathIsSafe(
        getSavesPath(),
        path.resolve(getSavesPath(), inputPath),
      );
    case 'Output':
      return resolveModOutputPath(runtime!.options, inputPath);
    case 'PreExtractedData':
      return validatePathIsSafe(
        getPreExtractedDataPath(),
        path.resolve(getPreExtractedDataPath(), inputPath),
      );
    case 'None':
      return validatePathIsSafe(
        getModOutputEnvelopePath(runtime!.options),
        path.resolve(getOutputPath(), inputPath),
      );
    default:
      throw te('worker.bridgeapi.resolvePath.invalidRelative', {
        relative,
        inputPath,
      });
  }
}

type CopyDirResult = {
  copiedFiles: CopiedFile[];
  errors: string[];
};

const CRLF_NORMALIZE_EXTENSIONS = new Set([
  '.txt',
  '.json',
  '.lua',
  '.tbl',
  '.timelines',
]);

function normalizeOutputCRLF(outputRootPath: string): {
  checked: number;
  converted: number;
  errors: string[];
} {
  const errors: string[] = [];
  let checked = 0;
  let converted = 0;
  const pending = [path.resolve(outputRootPath)];

  while (pending.length > 0) {
    const currentPath = pending.pop();
    if (currentPath == null) {
      continue;
    }

    let entries;
    try {
      entries = readdirSync(currentPath, { withFileTypes: true });
    } catch (e) {
      errors.push(`Failed to read directory "${currentPath}": ${String(e)}`);
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.git') {
          pending.push(entryPath);
        }
        continue;
      }

      if (
        !CRLF_NORMALIZE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        continue;
      }

      checked += 1;
      try {
        const text = readFileSync(entryPath, 'utf-8');
        const normalized = text.replace(/\r?\n/g, '\r\n');
        if (normalized !== text) {
          writeFileSync(entryPath, Buffer.from(normalized, 'utf-8'));
          converted += 1;
        }
      } catch (e) {
        errors.push(`Failed to normalize "${entryPath}": ${String(e)}`);
      }
    }
  }

  return { checked, converted, errors };
}

function copyDirSync(
  src: string,
  dest: string,
  options: { isDryRun: boolean; overwrite: boolean },
): CopyDirResult {
  const result: CopyDirResult = { copiedFiles: [], errors: [] };

  if (!options.isDryRun) {
    mkdirSync(dest, { recursive: true });
  }

  let entries;
  try {
    entries = readdirSync(src, { withFileTypes: true });
  } catch (e) {
    result.errors.push(`Failed to read directory "${src}": ${String(e)}`);
    return result;
  }

  for (const entry of entries) {
    const srcPath = path.resolve(path.join(src, entry.name));
    const destPath = path.resolve(path.join(dest, entry.name));

    if (entry.isDirectory()) {
      const subResult = copyDirSync(srcPath, destPath, options);
      result.copiedFiles.push(...subResult.copiedFiles);
      result.errors.push(...subResult.errors);
    } else {
      // during dry run (uninstall), skip the overwrite check since we need
      // to track all files that would have been copied for reverting
      if (!options.isDryRun && !options.overwrite && existsSync(destPath)) {
        continue;
      }
      try {
        if (!options.isDryRun) {
          copyFileSync(srcPath, destPath);
        }
        result.copiedFiles.push({ fromPath: srcPath, toPath: destPath });
      } catch (e) {
        result.errors.push(
          `Failed to copy "${srcPath}" to "${destPath}": ${String(e)}`,
        );
      }
    }
  }

  return result;
}

// TODO: use CascFindFirstFile & CascFindNextFile to implement an "extractFiles" API
//       that would recursively extract all files in a directory
// e.g. https://github.com/ladislav-zezula/CascLib/blob/4fc4c18bd5a49208337199a7f4256271675cae44/test/CascTest.cpp#L816

let cascStorage: unknown = null;
let cascStorageIsOpen = false;
let cascStorageOpenedOnline: boolean | null = null;
let cascStorageOpenedGamePath: string | null = null;

function canonicalizeGamePath(gamePath: string): string {
  try {
    return realpathSync.native(path.resolve(gamePath));
  } catch (error) {
    throw te('worker.error.openStorage.failed', {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function closeCascStorage(): boolean {
  if (!cascStorageIsOpen) {
    return true;
  }

  if (!getCascLib().CascCloseStorage(cascStorage)) {
    const detail = String(getLastCascLibError());
    throw te('worker.error.closeStorage.failed', { detail });
  }

  cascStorage = null;
  cascStorageIsOpen = false;
  cascStorageOpenedOnline = null;
  cascStorageOpenedGamePath = null;
  return true;
}

function translateCascFileReadError(
  filePath: string,
  error: CascFileReadError,
): Error {
  switch (error.kind) {
    case 'closeFailed':
      return te('worker.bridgeapi.extractFileToMemory.closeFailed', {
        filePath,
        cascError: String(getLastCascLibError(error.cascError)),
      });
    case 'invalidSize':
      return te('worker.bridgeapi.extractFileToMemory.invalidSize', {
        filePath,
        size: String(error.fileSize),
      });
    case 'readFailed':
      return te('worker.bridgeapi.extractFileToMemory.readFailed', {
        filePath,
        cascError: String(getLastCascLibError(error.cascError)),
      });
    case 'shortRead':
      return te('worker.bridgeapi.extractFileToMemory.shortRead', {
        filePath,
        expected: error.expectedBytes ?? 0,
        actual: error.actualBytes ?? 0,
      });
    case 'sizeQueryFailed':
      return te('worker.bridgeapi.extractFileToMemory.sizeFailed', {
        filePath,
        cascError: String(getLastCascLibError(error.cascError)),
      });
    case 'tooLarge':
      return te('worker.bridgeapi.extractFileToMemory.tooLarge', {
        filePath,
        size: String(error.fileSize),
      });
  }
}

export const BridgeAPI: IBridgeAPI = {
  getVersion: async () => {
    console.debug('BridgeAPI.getVersion');

    const [major, minor, patch] = packageManifest.version
      .split('.')
      .map(Number);
    return [major ?? 0, minor ?? 0, patch ?? 0];
  },

  getAppPath: async () => {
    console.debug('BridgeAPI.getAppPath');

    return getAppPath();
  },

  installD2RLoader: async (gamePath: string) => {
    console.debug('BridgeAPI.installD2RLoader', { gamePath });
    const lease = acquireRuntimeOperation('installD2RLoader');
    try {
      return await downloadAndInstallD2RLoader(gamePath);
    } finally {
      lease.release();
    }
  },

  getGamePath: async () => {
    console.debug('BridgeAPI.getGamePath');

    if (process.platform !== 'win32') {
      return null;
    }

    const appPath = getAppPath();

    const isSteamDeck = appPath.startsWith('Z:\\home\\deck\\');

    if (isSteamDeck) {
      return path.resolve(
        path.join(
          'Z:',
          'home',
          'deck',
          '.local',
          'share',
          'Steam',
          'steamapps',
          'common',
          'Diablo II Resurrected',
        ),
      );
    }

    try {
      regedit.setExternalVBSLocation(
        path.resolve(path.join(getAppPath(), 'tools')),
      );
      const regKey =
        'HKLM\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Diablo II Resurrected';
      const result = await regedit.promisified.list([regKey]);
      const value = result[regKey].values.InstallLocation.value;
      if (value == null) {
        return null;
      }
      return value.toString();
    } catch (error) {
      // useful for debugging, but not useful to expose to user
      console.debug(
        'BridgeAPI.getGamePath',
        'Failed to fetch game path from the registry',
        String(error),
      );
      return null;
    }
  },

  execute: async (executablePath: string, args: string[] = []) => {
    console.debug('BridgeAPI.execute', { executablePath, args });
    try {
      return await launchDetachedProcess(executablePath, args ?? []);
    } catch (error) {
      throw te('worker.bridgeapi.execute.failed', null, error);
    }
  },

  openStorage: async (gamePath: string, forceOnline = false) => {
    console.debug('BridgeAPI.openStorage', { gamePath, forceOnline });

    const canonicalGamePath = canonicalizeGamePath(gamePath);

    if (cascStorageIsOpen) {
      const canReuseStorage =
        cascStorageOpenedGamePath === canonicalGamePath &&
        (!forceOnline || cascStorageOpenedOnline === true);
      if (canReuseStorage) {
        return true;
      }
      closeCascStorage();
    }

    // what do these mean? who knows!
    const PATHS = [
      `${canonicalGamePath}:osi`,
      `${canonicalGamePath}:`,
      canonicalGamePath,
    ];

    if (!cascStorageIsOpen) {
      const attempts = forceOnline
        ? PATHS.map((p) => [p, true] as const)
        : [
            // try to open offline first since it's faster
            ...PATHS.map((p) => [p, false] as const),
            ...PATHS.map((p) => [p, true] as const),
          ];
      const options = makeCascOpenStorageArgs(CASC_FEATURE_ALLOW_DOWNLOAD);
      for (const [storagePath, online] of attempts) {
        const storageOut: unknown[] = [null];
        if (
          getCascLib().CascOpenStorageEx(
            storagePath,
            options,
            online,
            storageOut,
          )
        ) {
          cascStorage = storageOut[0];
          cascStorageIsOpen = true;
          cascStorageOpenedOnline = online;
          cascStorageOpenedGamePath = canonicalGamePath;
          console.debug('BridgeAPI.openStorage success', {
            storagePath,
            online,
          });
          break;
        }
      }
      if (!cascStorageIsOpen) {
        const detail = String(getLastCascLibError());
        throw te('worker.error.openStorage.failed', { detail });
      }
    }

    return cascStorageIsOpen;
  },

  readD2RLoaderConfig: async (gamePath: string) => {
    console.debug('BridgeAPI.readD2RLoaderConfig', { gamePath });
    const gameRoot = path.resolve(gamePath);
    const configFile = getD2RLoaderConfigFile(gameRoot);

    if (configFile == null) {
      return null;
    }

    try {
      const configText = readFileSync(configFile.path, 'utf-8');
      return createD2RLoaderConfig(configFile.fileName, configText);
    } catch (e) {
      throw te('worker.bridgeapi.prepareD2RLoaderLaunch.failed', null, e);
    }
  },

  prepareD2RLoaderLaunch: async (
    gamePath: string,
    settings: D2RLoaderSettings,
  ) => {
    console.debug('BridgeAPI.prepareD2RLoaderLaunch', { gamePath, settings });

    const gameRoot = path.resolve(gamePath);
    const exePath = validatePathIsSafe(
      gameRoot,
      path.resolve(gameRoot, 'D2RLoader.exe'),
    );

    if (!existsSync(exePath) || !statSync(exePath).isFile()) {
      throw te('settings.d2rLoader.missingExe');
    }

    const configFile = getD2RLoaderConfigFile(gameRoot);

    if (configFile == null) {
      throw te('settings.d2rLoader.missingTomlConfig');
    }

    try {
      const configText = readFileSync(configFile.path, 'utf-8');
      const updatedConfigText = updateD2RLoaderConfig(configText, settings);
      writeFileSync(configFile.path, Buffer.from(updatedConfigText, 'utf-8'));
    } catch (e) {
      throw te('worker.bridgeapi.prepareD2RLoaderLaunch.failed', null, e);
    }
  },

  closeStorage: async () => {
    console.debug('BridgeAPI.closeStorage');
    return closeCascStorage();
  },

  isGameFile: async (filePath: string) => {
    console.debug('BridgeAPI.isGameFile', {
      filePath,
    });

    try {
      if (!cascStorageIsOpen) {
        throw te('worker.bridgeapi.isGameFile.cascNotOpen');
      }

      const fileOut: unknown[] = [null];
      if (
        !getCascLib().CascOpenFile(
          cascStorage,
          path.join('data:data', filePath),
          0,
          0,
          fileOut,
        )
      ) {
        return false;
      }

      if (!getCascLib().CascCloseFile(fileOut[0])) {
        throw te('worker.bridgeapi.extractFileToMemory.closeFailed', {
          filePath,
          cascError: String(getLastCascLibError()),
        });
      }
    } catch (e) {
      throw te('worker.bridgeapi.isGameFile.checkFailed', null, e);
    }

    return true;
  },

  extractFileToMemory: async (filePath) => {
    console.debug('BridgeAPI.extractFileToMemory', { filePath });

    try {
      if (!cascStorageIsOpen) {
        throw te('worker.bridgeapi.extractFileToMemory.cascNotOpen');
      }

      const fileOut: unknown[] = [null];
      if (
        !getCascLib().CascOpenFile(
          cascStorage,
          path.join('data:data', filePath),
          0,
          0,
          fileOut,
        )
      ) {
        throw te('worker.bridgeapi.extractFileToMemory.openFailed', {
          filePath,
          cascError: String(getLastCascLibError()),
        });
      }

      const file = fileOut[0];
      try {
        const output = readCascFileToBuffer(getCascLib(), file);
        console.debug('BridgeAPI.extractFileToMemory', {
          filePath,
          bytesRead: output.length,
        });
        return output;
      } catch (error) {
        if (
          error instanceof CascFileReadError &&
          (error.kind === 'readFailed' || error.kind === 'sizeQueryFailed') &&
          error.cascError === CASC_ERROR_FILE_OFFLINE &&
          cascStorageOpenedOnline === false &&
          cascStorageOpenedGamePath != null
        ) {
          console.debug(
            'BridgeAPI.extractFileToMemory',
            'file not available offline - retrying with online storage',
            {
              filePath,
              errorCode: error.cascError,
            },
          );
          const gamePath = cascStorageOpenedGamePath;
          await BridgeAPI.closeStorage();
          await BridgeAPI.openStorage(gamePath, true);
          return BridgeAPI.extractFileToMemory(filePath);
        }
        if (error instanceof CascFileReadError) {
          throw translateCascFileReadError(filePath, error);
        }
        throw error;
      }
    } catch (e) {
      throw te('worker.bridgeapi.extractFileToMemory.extractFailed', null, e);
    }
  },

  createDirectory: async (filePath: string) => {
    console.debug('BridgeAPI.createDirectory', { filePath });

    try {
      if (!existsSync(filePath)) {
        mkdirSync(filePath, { recursive: true });
        return true;
      }
    } catch (e) {
      throw te('worker.bridgeapi.createDirectory.failed', null, e);
    }

    return false;
  },

  readDirectory: async (filePath: string) => {
    console.debug('BridgeAPI.readDirectory', { filePath });

    try {
      if (existsSync(filePath)) {
        const entries = readdirSync(filePath, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }));
      }
      return [];
    } catch (e) {
      throw te('worker.bridgeapi.readDirectory.failed', null, e);
    }
  },

  readModDirectory: async () => {
    console.debug('BridgeAPI.readModDirectory');

    try {
      const filePath = path.resolve(path.join(getAppPath(), 'mods'));
      if (existsSync(filePath)) {
        const entries = readdirSync(filePath, { withFileTypes: true });
        return entries
          .filter((entry) => {
            if (entry.isDirectory()) {
              return true;
            }
            if (!entry.isSymbolicLink()) {
              return false;
            }
            try {
              return statSync(path.join(filePath, entry.name)).isDirectory();
            } catch {
              // A broken/inaccessible link is not a mod, but it should not
              // prevent the other mod directories from being discovered.
              return false;
            }
          })
          .map((entry) => entry.name);
      }
      return [];
    } catch (e) {
      throw te('worker.bridgeapi.readModDirectory.failed', null, e);
    }
  },

  readFile: async (inputPath, relative) => {
    console.debug('BridgeAPI.readFile', {
      inputPath,
      relative,
    });

    try {
      const filePath = resolvePath(inputPath, relative);
      if (existsSync(filePath)) {
        return readFileSync(filePath, {
          encoding: null, // binary
          flag: 'r',
        });
      }
    } catch (e) {
      throw te('worker.bridgeapi.readFile.failed', null, e);
    }

    return null;
  },

  writeFile: async (inputPath: string, relative: Relative, data: Buffer) => {
    console.debug('BridgeAPI.writeFile', { inputPath, relative });

    try {
      const filePath = resolvePath(inputPath, relative);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, data, {
        encoding: null, // binary
        flag: 'w',
      });
    } catch (e) {
      throw te('worker.bridgeapi.writeFile.failed', null, e);
    }

    return 0;
  },

  readTextFile: async (inputPath: string, relative: Relative) => {
    console.debug('BridgeAPI.readTextFile', { inputPath, relative });

    try {
      const buffer = await BridgeAPI.readFile(inputPath, relative);
      if (buffer != null) {
        return buffer.toString('utf-8');
      }
    } catch (e) {
      throw te('worker.bridgeapi.readTextFile.failed', null, e);
    }

    return null;
  },

  writeTextFile: async (
    inputPath: string,
    relative: Relative,
    data: string,
  ) => {
    console.debug('BridgeAPI.writeTextFile', { inputPath, relative });

    try {
      const buffer = Buffer.from(data, 'utf-8');
      return await BridgeAPI.writeFile(inputPath, relative, buffer);
    } catch (e) {
      throw te('worker.bridgeapi.writeTextFile.failed', null, e);
    }
  },

  readBinaryFile: async (inputPath, relative) => {
    console.debug('BridgeAPI.readBinaryFile', {
      inputPath,
      relative,
    });

    try {
      const buffer = await BridgeAPI.readFile(inputPath, relative);
      if (buffer != null) {
        return [...buffer.values()];
      }
    } catch (e) {
      throw te('worker.bridgeapi.readBinaryFile.failed', null, e);
    }

    return null;
  },

  writeBinaryFile: async (inputPath, relative, data) => {
    console.debug('BridgeAPI.writeBinaryFile', {
      inputPath,
      relative,
    });

    try {
      const buffer = Buffer.from(data);
      return await BridgeAPI.writeFile(inputPath, relative, buffer);
    } catch (e) {
      throw te('worker.bridgeapi.writeBinaryFile.failed', null, e);
    }
  },

  readTsv: async (filePath, relative) => {
    console.debug('BridgeAPI.readTsv', { filePath });
    const textData = await BridgeAPI.readTextFile(filePath, relative);
    try {
      return parseTsv(textData);
    } catch (e) {
      throw te('worker.bridgeapi.readTsv.parseFailed', null, e);
    }
  },

  writeTsv: async (filePath, relative, data) => {
    console.debug('BridgeAPI.writeTsv', { filePath });
    const textData = encodeTsv(data);
    return await BridgeAPI.writeTextFile(filePath, relative, textData);
  },

  readJson: async (filePath, relative) => {
    console.debug('BridgeAPI.readJson', { filePath });
    const textData = await BridgeAPI.readTextFile(filePath, relative);
    try {
      return parseJson(textData);
    } catch (e) {
      throw te('worker.bridgeapi.readJson.parseFailed', null, e);
    }
  },

  writeJson: async (filePath, relative, data) => {
    console.debug('BridgeAPI.writeJson', { filePath });
    const textData = encodeJson(data);
    return await BridgeAPI.writeTextFile(filePath, relative, textData);
  },

  readTxt: async (filePath, relative) => {
    console.debug('BridgeAPI.readTxt', { filePath });
    return (await BridgeAPI.readTextFile(filePath, relative)) ?? '';
  },

  writeTxt: async (filePath, relative, data) => {
    console.debug('BridgeAPI.writeTxt', { filePath });
    return await BridgeAPI.writeTextFile(filePath, relative, data);
  },

  deleteFile: async (inputPath: string, relative: Relative) => {
    console.debug('BridgeAPI.deleteFile', { inputPath, relative });

    try {
      const filePath = resolvePath(inputPath, relative);
      if (existsSync(filePath)) {
        const stat = statSync(filePath);
        if (stat.isDirectory()) {
          rmSync(filePath, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100,
          });
        } else {
          rmSync(filePath, { force: true, maxRetries: 3, retryDelay: 100 });
        }
        // file deleted successfully
        return 0;
      }
    } catch (e) {
      throw te('worker.bridgeapi.deleteFile.failed', null, e);
    }

    // file doesn't exist
    return 1;
  },

  copyFile: async (
    fromPath: string,
    toPath: string,
    overwrite: boolean = false,
    isDryRun: boolean = false,
    outCopiedFiles?: CopiedFile[],
  ) => {
    console.debug('BridgeAPI.copyFile', {
      fromPath,
      toPath,
      overwrite,
    });

    try {
      if (!existsSync(fromPath)) {
        // source file doesn't exist
        return 2;
      }

      const stat = statSync(fromPath);
      if (stat.isDirectory()) {
        const { copiedFiles, errors } = copyDirSync(fromPath, toPath, {
          isDryRun,
          overwrite,
        });
        if (errors.length > 0) {
          throw te('worker.bridgeapi.copyFile.dirCopyErrors', {
            count: errors.length,
            errors: errors.join('\n'),
          });
        }
        outCopiedFiles?.push(...copiedFiles);
      } else {
        if (existsSync(toPath) && !overwrite) {
          // destination file already exists
          return 1;
        }
        if (!isDryRun) {
          mkdirSync(path.dirname(toPath), { recursive: true });
          copyFileSync(fromPath, toPath);
        }
        outCopiedFiles?.push({ fromPath, toPath });
      }
    } catch (e) {
      throw te('worker.bridgeapi.copyFile.failed', null, e);
    }

    // file copied successfully
    return 0;
  },

  readModInfo: async (id: string) => {
    console.debug('BridgeAPI.readModInfo', {
      id,
    });

    const result = await BridgeAPI.readTextFile(
      path.join('mods', id, 'mod.json'),
      'App',
    );

    if (result == null) {
      // check if this is a data mod
      const modPath = resolvePath(path.join('mods', id), 'App');
      if (getDataModRootPath(modPath) != null) {
        return {
          type: 'data',
          name: id,
        };
      }
    }

    if (result == null) {
      throw te('worker.bridgeapi.readModInfo.readFailed');
    }

    try {
      return {
        type: 'd2rmm',
        name: id,
        ...JSON.parse(result),
      };
    } catch (e) {
      throw te('worker.bridgeapi.readModInfo.parseFailed', null, e);
    }
  },

  readModConfig: async (id: string) => {
    console.debug('BridgeAPI.readModConfig', {
      id,
    });

    const filePath = path.join('mods', id, 'config.json');
    const result = await BridgeAPI.readTextFile(filePath, 'App');

    if (result != null) {
      try {
        return JSON.parse(result);
      } catch (e) {
        throw te('worker.bridgeapi.readModConfig.parseFailed', null, e);
      }
    }

    return null;
  },

  writeModConfig: async (id: string, value: ModConfigValue) => {
    console.debug('BridgeAPI.writeModConfig', {
      id,
      value,
    });

    const filePath = path.join('mods', id, 'config.json');
    return await BridgeAPI.writeTextFile(
      filePath,
      'App',
      JSON.stringify(value),
    );
  },

  readModCode: async (id: string) => {
    console.debug('BridgeAPI.readModCode', {
      id,
    });

    // javascript support
    {
      const relativeFilePath = path.join('mods', id, 'mod.js');
      const absoluteFilePath = path.resolve(getAppPath(), relativeFilePath);
      if (existsSync(absoluteFilePath)) {
        const result = await BridgeAPI.readTextFile(relativeFilePath, 'App');
        if (typeof result !== 'string') {
          throw te('worker.bridgeapi.readModCode.readSourceFailed');
        }

        const code = `(function(){\nconst config = JSON.parse(D2RMM.getConfigJSON());\n${result}\n})()`;

        const sourceMapGenerator = new SourceMapGenerator({
          file: path.join('mods', id, 'mod.gen.js'),
          sourceRoot: '',
        });

        code.split('\n').forEach((_line, index) => {
          sourceMapGenerator.addMapping({
            generated: { line: index + 3, column: 1 },
            original: { line: index + 1, column: 1 },
            source: relativeFilePath,
          });
        });

        return [code, sourceMapGenerator.toString()];
      }
    }

    // typescript support
    if (existsSync(path.join(getAppPath(), 'mods', id, 'mod.ts'))) {
      try {
        type Module = {
          id: string;
        };

        type ModuleWithSourceCode = Module & {
          sourceCode: string;
        };

        type ModuleWithTranspiledCode = ModuleWithSourceCode & {
          transpiledCode: string;
          sourceMapConsumer: SourceMapConsumer | null;
        };

        function processDependencies(
          module: ModuleWithSourceCode,
          absoluteFilePath: string,
        ): Module[] {
          const sourceFile = ts.createSourceFile(
            absoluteFilePath,
            module.sourceCode,
            ts.ScriptTarget.ESNext,
            true,
            ts.ScriptKind.TS,
          );
          const rootPath = path.dirname(module.id + '.ts');
          const dependencies: Module[] = [];
          sourceFile.statements.forEach((statement) => {
            if (ts.isImportDeclaration(statement)) {
              const importPath = statement.moduleSpecifier
                .getText()
                .replace(/^['"](.*)['"]$/, '$1');
              const dependencyPath = path
                // resolve relative paths
                .normalize(`${rootPath}/${importPath}`)
                // keep TS stype paths
                .replace(/\\/g, '/');
              dependencies.push({ id: dependencyPath });
              module.sourceCode = module.sourceCode.replace(
                statement.getFullText(),
                statement
                  .getFullText()
                  .replace(importPath, `./${dependencyPath}`),
              );
            }
          });
          return dependencies;
        }

        const modulesWithSourceCode: ModuleWithSourceCode[] = [];
        const modulesWithTranspiledCode: ModuleWithTranspiledCode[] = [];

        const modulesProcessed: string[] = [];
        async function processModule(module: Module): Promise<void> {
          // TODO: detect circular dependencies and throw an error
          if (modulesProcessed.includes(module.id)) {
            return;
          }
          modulesProcessed.push(module.id);

          const relativeFilePath = path.join('mods', id, `${module.id}.ts`);
          const sourceCode = await BridgeAPI.readTextFile(
            relativeFilePath,
            'App',
          );
          if (typeof sourceCode !== 'string') {
            throw te('worker.bridgeapi.readModCode.readModuleSourceFailed', {
              file: relativeFilePath,
            });
          }

          const moduleWithSourceCode = { ...module, sourceCode };
          const dependencies = processDependencies(
            moduleWithSourceCode,
            path.join(getAppPath(), relativeFilePath),
          );
          for (const dependency of dependencies) {
            await processModule(dependency);
          }
          modulesWithSourceCode.push(moduleWithSourceCode);
        }

        try {
          await processModule({ id: 'mod' });
        } catch (error) {
          throw error instanceof Error ? error : new Error(String(error));
        }

        const sourceMapGenerator = new SourceMapGenerator({
          file: path.join('mods', id, 'mod.gen.js'),
          sourceRoot: '',
        });

        for (let i = 0; i < modulesWithSourceCode.length; i++) {
          const module = modulesWithSourceCode[i];

          const transpilationResult = ts.transpileModule(module.sourceCode, {
            compilerOptions: {
              lib: [
                // I dunno why this is all necessary...
                // I just don't want to include DOM since we don't support it here
                'lib.es2015.d.ts',
                'lib.es2016.d.ts',
                'lib.es2017.d.ts',
                'lib.es2018.d.ts',
                'lib.es2019.d.ts',
                'lib.es2020.d.ts',
                'lib.es2021.d.ts',
                'lib.es2022.d.ts',
              ],
              // running webpack inside of electron is a pita and very slow
              // so we're just going to roll our own module import/export system
              // because that's a reaaaallly good idea and
              // definitely won't cause any headaches later
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ES5,
              sourceMap: true,
            },
            moduleName: module.id,
            // errors? what errors! runtime errors!
            // basically, the mod author is responsible for taking care of their
            // own type checking and type errors using their preferred editor
            // D2RMM will just transpile as best it can and run the code
            reportDiagnostics: false,
          });

          const transpiledCode = transpilationResult.outputText;
          const sourceMap = transpilationResult.sourceMapText;
          const sourceMapConsumer =
            sourceMap == null ? null : await new SourceMapConsumer(sourceMap);

          modulesWithTranspiledCode.push({
            ...module,
            transpiledCode,
            sourceMapConsumer,
          });
        }

        const header = `
function require(id) {
  if (require.loadedModules[id] == null) {
    require.load(id);
  }
  return require.loadedModules[id];
}
require.loadedModules = {};
require.load = function(id) {
  const exports = {};
  require.registeredModules[id](exports);
  require.loadedModules[id] = exports;
};
require.registeredModules = {};
require.register = function(id, getModule) {
  require.registeredModules[id] = getModule;
}
const config = JSON.parse(D2RMM.getConfigJSON());
`;
        const code = modulesWithTranspiledCode
          .reduce((agg, module) => {
            const basename = path.basename(module.id);
            const prefix = `require.register('./${module.id}', function ${basename}(exports) {`;
            const suffix = '});';
            const sourceMapConsumer = module.sourceMapConsumer;
            if (sourceMapConsumer != null) {
              const pathSeparator = process.platform === 'win32' ? '\\' : '/';
              const modulePath = `${module.id.replace(/\//g, pathSeparator)}.ts`;
              const source = path.join('mods', id, modulePath);
              const offset = agg.split('\n').length + prefix.split('\n').length;
              sourceMapConsumer.eachMapping((mapping) => {
                sourceMapGenerator.addMapping({
                  generated: {
                    line: mapping.generatedLine + offset,
                    column: mapping.generatedColumn,
                  },
                  original: {
                    line: mapping.originalLine,
                    column: mapping.originalColumn,
                  },
                  name: mapping.name,
                  source,
                });
              });
              sourceMapConsumer.destroy();
              module.sourceMapConsumer = null;
            }
            return [agg, prefix, module.transpiledCode, suffix].join('\n');
          }, header)
          .concat("\nrequire.load('./mod');");
        return [code, sourceMapGenerator.toString()];
      } catch (error) {
        throw te('worker.bridgeapi.readModCode.compileFailed', null, error);
      }
    }

    throw te('worker.bridgeapi.readModCode.noSourceFound');
  },

  // TODO: improve API signatures for save file APIs

  writeSaveFile: async (
    options: IInstallModsOptions,
    fileName: string,
    parsedData: ID2S | IStash,
  ) => {
    const lease = acquireRuntimeOperation('writeSaveFile');
    let operationRuntime: InstallationRuntime | null = null;

    try {
      console.debug('BridgeAPI.writeSaveFile', {
        fileName,
      });

      runtime = operationRuntime = new InstallationRuntime(
        BridgeAPI,
        console,
        options,
        [],
      );

      const rawData = fileName.endsWith('.d2s')
        ? await d2s.write(parsedData as ID2S)
        : fileName.endsWith('.d2i')
          ? await d2s.stash.write(
              parsedData as IStash,
              // version
              null,
              // realm
              fileName.split(/[/\\]/).pop()!.startsWith('Modern') ? 3 : 2,
            )
          : null;

      if (rawData == null) {
        throw te('worker.bridgeapi.writeSaveFile.invalidFileName');
      }

      // TODO: base this off of when the file was first read instead
      const timestamp = new Date()
        .toISOString()
        .slice(0, -5)
        .replace(/[T:]/g, '-');

      const originalRawData = await BridgeAPI.readBinaryFile(fileName, 'Saves');
      if (originalRawData != null) {
        await BridgeAPI.writeBinaryFile(
          `${fileName}.bak-${timestamp}`,
          'Saves',
          Array.from(originalRawData),
        );
      }

      return await BridgeAPI.writeBinaryFile(
        fileName,
        'Saves',
        Array.from(rawData),
      );
    } finally {
      releaseRuntimeOperation(lease, operationRuntime);
    }
  },

  readD2SData: async (options: IInstallModsOptions) => {
    const lease = acquireRuntimeOperation('readD2SData');
    let operationRuntime: InstallationRuntime | null = null;

    try {
      console.debug('BridgeAPI.readD2SData', {
        options,
      });

      runtime = operationRuntime = new InstallationRuntime(
        BridgeAPI,
        console,
        options,
        [],
      );

      if (!runtime.options.isPreExtractedData) {
        await BridgeAPI.openStorage(runtime.options.gamePath);
      }

      const d2sFiles = [
        path.join('local', 'lng', 'strings', 'item-gems.json'),
        path.join('local', 'lng', 'strings', 'item-modifiers.json'),
        path.join('local', 'lng', 'strings', 'item-nameaffixes.json'),
        path.join('local', 'lng', 'strings', 'item-names.json'),
        path.join('local', 'lng', 'strings', 'item-runes.json'),
        path.join('local', 'lng', 'strings', 'skills.json'),
        path.join('global', 'excel', 'charstats.txt'),
        path.join('global', 'excel', 'playerclass.txt'),
        path.join('global', 'excel', 'skilldesc.txt'),
        path.join('global', 'excel', 'skills.txt'),
        path.join('global', 'excel', 'raresuffix.txt'),
        path.join('global', 'excel', 'rareprefix.txt'),
        path.join('global', 'excel', 'magicprefix.txt'),
        path.join('global', 'excel', 'magicsuffix.txt'),
        path.join('global', 'excel', 'properties.txt'),
        path.join('global', 'excel', 'itemstatcost.txt'),
        path.join('global', 'excel', 'runes.txt'),
        path.join('global', 'excel', 'setitems.txt'),
        path.join('global', 'excel', 'uniqueitems.txt'),
        path.join('global', 'excel', 'itemtypes.txt'),
        path.join('global', 'excel', 'armor.txt'),
        path.join('global', 'excel', 'weapons.txt'),
        path.join('global', 'excel', 'misc.txt'),
        path.join('global', 'excel', 'gems.txt'),
        path.join('global', 'excel', 'actinfo.txt'),
        path.join('global', 'excel', 'levels.txt'),
      ];

      async function getGameFile(filePath: string): Promise<Buffer> {
        // check if the file exists in the generated MPQ mod
        if (existsSync(path.resolve(getOutputPath(), filePath))) {
          const buffer = await BridgeAPI.readFile(filePath, 'Output');
          if (buffer == null) {
            throw te('worker.bridgeapi.readD2SData.readOutputFailed', {
              path: path.resolve(getOutputPath(), filePath),
            });
          }
          return buffer;
        }

        // read file from pre-extracted data
        if (runtime!.options.isPreExtractedData) {
          if (existsSync(path.resolve(getPreExtractedDataPath(), filePath))) {
            const buffer = await BridgeAPI.readFile(
              filePath,
              'PreExtractedData',
            );
            if (buffer == null) {
              throw te('worker.bridgeapi.readD2SData.readPreExtractedFailed', {
                path: path.resolve(getPreExtractedDataPath(), filePath),
              });
            }
            return buffer;
          } else {
            throw te('worker.bridgeapi.readD2SData.findPreExtractedFailed', {
              path: path.resolve(getPreExtractedDataPath(), filePath),
            });
          }
        }

        // read file from Casc archive
        return await BridgeAPI.extractFileToMemory(path.join(filePath));
      }

      const buffers: { [key: string]: string } = {};
      for (const filePath of d2sFiles) {
        buffers[path.basename(filePath)] = readCString(
          await getGameFile(filePath),
        );
      }

      const gameData = d2s.readConstantData(buffers as d2s.Buffers);
      d2s.setConstantData(96, gameData);
      d2s.setConstantData(97, gameData);
      d2s.setConstantData(98, gameData);
      d2s.setConstantData(99, gameData);
      d2s.setConstantData(105, gameData);

      const saveFiles = await BridgeAPI.readDirectory(getSavesPath());

      const characterFiles = saveFiles.filter(
        (file) => !file.isDirectory && file.name.endsWith('.d2s'),
      );
      const characterFilesData: [string, ID2S][] = [];
      for (const file of characterFiles) {
        try {
          const rawData = await BridgeAPI.readBinaryFile(file.name, 'Saves');
          if (rawData == null) {
            throw te('worker.bridgeapi.readD2SData.fileContentNotRead');
          }
          const parsedData = await d2s.read(new Uint8Array(rawData));
          characterFilesData.push([file.name, parsedData]);
        } catch (e) {
          console.error(
            tl('worker.saveFiles.readCharacterFailed', { name: file.name }),
            e,
          );
          continue;
        }
      }
      const characters = Object.fromEntries(characterFilesData);

      const stashFiles = saveFiles.filter(
        (file) => !file.isDirectory && file.name.endsWith('.d2i'),
      );
      const stashFilesData: [string, IStash][] = [];
      for (const file of stashFiles) {
        try {
          const rawData = await BridgeAPI.readBinaryFile(file.name, 'Saves');
          if (rawData == null) {
            throw te('worker.bridgeapi.readD2SData.fileContentNotRead');
          }
          const parsedData = await d2s.stash.read(
            new Uint8Array(rawData),
            // version
            null,
            // realm
            file.name.split(/[/\\]/).pop()!.startsWith('Modern') ? 3 : 2,
          );
          stashFilesData.push([file.name, parsedData]);
        } catch (e) {
          console.error(
            tl('worker.saveFiles.readStashFailed', { name: file.name }),
            e,
          );
          continue;
        }
      }
      const stashes = Object.fromEntries(stashFilesData);

      // TODO: .d2x offline stash files
      // const offlineStashFiles = saveFiles.filter(
      //   (file) => !file.isDirectory && file.name.endsWith('.d2x'),
      // );

      // game files that the UI will need to render the save files
      const gameFiles: { [filePath: string]: TSVData | JSONData | string } = {};

      // JSON
      for (const filePath of [
        'global/ui/layouts/_profilehd.json',
        'hd/items/items.json',
        'hd/items/sets.json',
        'hd/items/uniques.json',
        'local/lng/strings/item-gems.json',
        'local/lng/strings/item-modifiers.json',
        'local/lng/strings/item-nameaffixes.json',
        'local/lng/strings/item-names.json',
        'local/lng/strings/item-runes.json',
        'local/lng/strings/levels.json',
        'local/lng/strings/monsters.json',
        'local/lng/strings/skills.json',
        'local/lng/strings/ui.json',
      ]) {
        gameFiles[filePath] = parseJson(
          readCString(await getGameFile(filePath)),
        );
      }

      // TSV
      for (const filePath of [
        'global/excel/armor.txt',
        'global/excel/charstats.txt',
        'global/excel/gems.txt',
        'global/excel/inventory.txt',
        'global/excel/itemstatcost.txt',
        'global/excel/itemtypes.txt',
        'global/excel/magicprefix.txt',
        'global/excel/magicsuffix.txt',
        'global/excel/misc.txt',
        'global/excel/playerclass.txt',
        'global/excel/properties.txt',
        'global/excel/rareprefix.txt',
        'global/excel/raresuffix.txt',
        'global/excel/runes.txt',
        'global/excel/setitems.txt',
        'global/excel/skilldesc.txt',
        'global/excel/skills.txt',
        'global/excel/uniqueitems.txt',
        'global/excel/weapons.txt',
        'global/excel/actinfo.txt',
        'global/excel/levels.txt',
      ]) {
        gameFiles[filePath] = parseTsv(
          readCString(await getGameFile(filePath)),
        );
      }

      const itemCodeToCategory: { [code: string]: string } = {};
      const itemCodeToItemRow: { [code: string]: TSVDataRow } = {};
      for (const [filePath, category] of [
        ['global/excel/weapons.txt', 'weapon'], // thanks, D2
        ['global/excel/armor.txt', 'armor'],
        ['global/excel/misc.txt', 'misc'],
      ]) {
        for (const row of (gameFiles[filePath] as TSVData).rows) {
          if ((row.code ?? '') === '') {
            continue;
          }
          itemCodeToCategory[row.code] = category;
          itemCodeToItemRow[row.code] = row;
        }
      }

      const itemTypeToItemTypesRow: { [code: string]: TSVDataRow } = {};
      const itemsTypes = gameFiles['global/excel/itemtypes.txt'] as TSVData;
      for (const row of itemsTypes.rows) {
        itemTypeToItemTypesRow[row.Code] = row;
      }

      function getAssetCodeFromIndex(index: string): string {
        return index.toLowerCase().replace(/'/g, '').replace(/ /g, '_');
      }
      const assetIDToItemCodes: { [assetID: string]: string } = {};
      const setItems = gameFiles['global/excel/setitems.txt'] as TSVData;
      for (const setItem of setItems.rows) {
        const assetID = getAssetCodeFromIndex(setItem.index);
        assetIDToItemCodes[assetID] = setItem.item;
      }
      const uniqueItems = gameFiles['global/excel/uniqueitems.txt'] as TSVData;
      for (const uniqueItem of uniqueItems.rows) {
        const assetID = getAssetCodeFromIndex(uniqueItem.index);
        assetIDToItemCodes[assetID] = uniqueItem.code;
      }

      async function extractSprite(
        itemCode: string,
        asset: string,
      ): Promise<void> {
        try {
          const category = itemCodeToCategory[itemCode];
          if (category == null) {
            console.warn(
              tl('worker.saveFiles.categoryNotFound', { code: itemCode }),
            );
            return;
          }
          const filePath = `hd/global/ui/items/${category}/${asset}.lowend.sprite`;
          if (gameFiles[filePath] != null) {
            // file already fetched
            return;
          }
          const dataURI = parseSprite(await getGameFile(filePath));
          if (dataURI == null) {
            console.warn(
              tl('worker.saveFiles.spriteConvertFailed', { code: itemCode }),
            );
            return;
          }
          gameFiles[filePath] = dataURI;
        } catch (e) {
          console.debug(
            `Could not get sprite data for item code "${itemCode}"`,
            e,
          );
        }
      }

      async function extractSpriteWithAlternatives(
        itemCode: string,
        asset: string,
      ): Promise<void> {
        await extractSprite(itemCode, asset);

        // items can have alternative graphics
        const itemRow = itemCodeToItemRow[itemCode];
        if (itemRow != null) {
          const itemType = itemRow.type;
          const itemTypesRow = itemTypeToItemTypesRow[itemType];
          if (itemTypesRow != null) {
            const numGraphics = +itemTypesRow.VarInvGfx;
            if (numGraphics > 0) {
              for (let i = 1; i <= numGraphics; i++) {
                await extractSprite(itemCode, asset + i);
              }
            }
          }
        }
      }

      for (const entry of gameFiles['hd/items/items.json'] as {
        [assetID: string]: { asset: string };
      }[]) {
        for (const assetID in entry) {
          const itemCode = assetID;
          await extractSpriteWithAlternatives(itemCode, entry[assetID].asset);
        }
      }

      for (const item of gameFiles['hd/items/sets.json'] as {
        [assetID: string]: { normal: string; uber: string; ultra: string };
      }[]) {
        for (const assetID in item) {
          const itemCode = assetIDToItemCodes[assetID];
          if (itemCode != null) {
            await extractSpriteWithAlternatives(itemCode, item[assetID].normal);
            await extractSpriteWithAlternatives(itemCode, item[assetID].uber);
            await extractSpriteWithAlternatives(itemCode, item[assetID].ultra);
          }
        }
      }

      for (const item of gameFiles['hd/items/uniques.json'] as {
        [assetID: string]: { normal: string; uber: string; ultra: string };
      }[]) {
        for (const assetID in item) {
          const itemCode = assetIDToItemCodes[assetID];
          if (itemCode != null) {
            await extractSpriteWithAlternatives(itemCode, item[assetID].normal);
            await extractSpriteWithAlternatives(itemCode, item[assetID].uber);
            await extractSpriteWithAlternatives(itemCode, item[assetID].ultra);
          }
        }
      }

      return { characters, stashes, gameFiles };
    } finally {
      try {
        if (
          operationRuntime != null &&
          !operationRuntime.options.isPreExtractedData
        ) {
          await BridgeAPI.closeStorage();
        }
      } finally {
        releaseRuntimeOperation(lease, operationRuntime);
      }
    }
  },

  installMods: async (modsToInstall: Mod[], options: IInstallModsOptions) => {
    const lease = acquireRuntimeOperation('installMods');
    let operationRuntime: InstallationRuntime | null = null;

    try {
      console.debug('BridgeAPI.installMods', {
        modsToInstall: modsToInstall.map((mod) => mod.id),
        options,
      });

      runtime = operationRuntime = new InstallationRuntime(
        BridgeAPI,
        console,
        options,
        modsToInstall,
      );
      const action = runtime.options.isDryRun ? 'Uninstall' : 'Install';
      const shouldSyncD2RLoaderOutput =
        runtime.options.syncD2RLoaderOutput === true &&
        !runtime.options.isDryRun;

      console.debug('Installation paths', {
        appPath: getAppPath(),
        savesPath: getSavesPath(),
        outputPath: getOutputPath(),
        outputRootPath: getOutputRootPath(),
        preExtractedDataPath: getPreExtractedDataPath(),
      });

      try {
        console.debug(
          'Save files',
          readdirSync(getSavesPath(), { withFileTypes: true }).map(
            (entry) => entry.name,
          ),
        );
      } catch {}

      if (!runtime.options.isPreExtractedData) {
        await BridgeAPI.openStorage(runtime.options.gamePath);
      }

      // D2RLoader prerequisite pre-application is temporarily disabled.
      // Keep this block for possible restoration later.
      // if (
      //   (runtime.modsToInstall.length > 0 || shouldSyncD2RLoaderOutput) &&
      //   runtime.options.useD2RLoader === true &&
      //   !runtime.options.isDryRun
      // ) {
      //   await applyD2RLoaderPrerequisites(runtime);
      // }

      for (let i = 0; i < runtime.modsToInstall.length; i = i + 1) {
        const startTime = Date.now();
        EventAPI.send(
          'installationProgress',
          i,
          runtime.modsToInstall.length,
        ).catch(console.error);
        runtime.mod = runtime.modsToInstall[i];
        let code: string = '';
        let sourceMap: string = '';
        try {
          console.debug(`Mod parsing code...`);
          if (runtime.mod.info.type === 'data') {
            code = datamod;
          } else {
            const result = await BridgeAPI.readModCode(runtime.mod.id);
            if (result instanceof Error) {
              throw result;
            }
            if (result == null) {
              throw te('worker.bridgeapi.installMods.readCodeFailed');
            }
            [code, sourceMap] = result;
          }
        } catch (error) {
          if (error instanceof Error) {
            console.error(tl('worker.mod.compileError'), error);
          }
          continue;
        }
        const scope = new Scope();
        try {
          await runModTransaction(runtime, async () => {
            console.debug(`${action}ing version ${runtime!.mod.info.version}`);
            console.debug(
              `Mod configuration: ${JSON.stringify(runtime!.mod.config)}`,
            );
            const vm = scope.manage(getQuickJS().newContext());
            const watchdog = installQuickJSExecutionWatchdog(vm.runtime);
            try {
              vm.setProp(
                vm.global,
                'console',
                getQuickJSProxyAPI(
                  vm,
                  scope,
                  {
                    debug: async (...args: ConsoleArg[]) => {
                      console.debug(...args);
                    },
                    log: async (...args: ConsoleArg[]) => {
                      console.log(...args);
                    },
                    warn: async (...args: ConsoleArg[]) => {
                      console.warn(...args);
                    },
                    error: async (...args: ConsoleArg[]) => {
                      console.error(...args);
                    },
                  } as ConsoleAPI,
                  watchdog,
                ),
              );
              vm.setProp(
                vm.global,
                'D2RMM',
                getQuickJSProxyAPI(vm, scope, getModAPI(runtime!), watchdog),
              );
              scope.manage(vm.unwrapResult(await vm.evalCodeAsync(code)));
            } finally {
              watchdog.dispose();
            }
          });
          console.debug(
            `Mod ${action.toLowerCase()} took ${Date.now() - startTime}ms.`,
          );
          console.log(
            tl(
              action === 'Install'
                ? 'worker.mod.installed'
                : 'worker.mod.uninstalled',
            ),
          );
        } catch (error) {
          if (error instanceof Error) {
            if (error.stack != null && sourceMap !== '') {
              // a constructor that returns a Promise smh
              const sourceMapConsumer = await new SourceMapConsumer(sourceMap);
              error.stack = applySourceMapToStackTrace(
                error.stack
                  ?.replace(/\s*at <eval>[\s\S]*/m, '')
                  ?.replace(
                    /eval.js/g,
                    path.join('mods', runtime.mod.id, 'mod.gen.js'),
                  ),
                sourceMapConsumer,
              );
              sourceMapConsumer.destroy();
            }
            console.error(tl('worker.mod.runtimeError'), error);
          }
        } finally {
          scope.dispose();
        }
      }
      runtime.mod = null;

      // An output sync is explicitly requested when loader packages or the
      // D2RLoader output mode changed. Keep the historical zero-mod no-op for
      // every other install request, and do not replace a working output when
      // selected mods all failed.
      const hasInstallOutputChanges =
        runtime.modsInstalled.length > 0 ||
        (runtime.modsToInstall.length === 0 && shouldSyncD2RLoaderOutput);

      if (
        hasInstallOutputChanges &&
        runtime.options.useD2RLoader === true &&
        !runtime.options.isDryRun
      ) {
        await applyManagedD2RLoaderPackages(runtime);
      }

      // Flush in-memory files to the generated mod output. Dry runs keep the
      // historical memory-only behavior and never modify files on disk.
      if (hasInstallOutputChanges && !runtime.options.isDryRun) {
        // Progress remains indeterminate until all generated output and save
        // data have actually reached disk. Await the notification so the UI
        // can enter its finalizing state before destructive output work starts.
        await EventAPI.send('installationStatus', {
          phase: 'finalizing',
          installedModsCount: runtime.modsInstalled.length,
          totalModsCount: runtime.modsToInstall.length,
        }).catch(console.error);

        // delete old output
        await BridgeAPI.deleteFile(
          path.join(runtime.options.mergedPath, '..'),
          'None',
        );

        // Treat the D2RLoader sibling as generated output just like the MPQ.
        // Current installation files are written back during the common flush.
        await clearD2RLoaderOutputDirectory(runtime);

        // write dataversionbuild.txt to output mod folder
        {
          const filePath = path.join('global', 'dataversionbuild.txt');
          try {
            const fileContent = runtime.options.isPreExtractedData
              ? await BridgeAPI.readFile(filePath, 'PreExtractedData')
              : await BridgeAPI.extractFileToMemory(filePath);
            if (fileContent != null) {
              await BridgeAPI.writeFile(filePath, 'Output', fileContent);
            }
          } catch (e) {
            console.debug(
              'dataversionbuild.txt not found in game data, skipping',
              e,
            );
          }
        }

        // create output directory and write modinfo
        await BridgeAPI.createDirectory(runtime.options.mergedPath);
        const baseSavesPath = path.resolve(getBaseSavesPath());
        const modsSavesPath = path.resolve(baseSavesPath, 'mods');
        const savesPath = getSavesPath();

        // use a relative path if possible - but allow an absolute path
        const isRelative = savesPath.startsWith(baseSavesPath);
        const finalSavesPath = isRelative
          ? process.platform === 'win32'
            ? path.relative(modsSavesPath, savesPath)
            : path.posix.relative(modsSavesPath, savesPath)
          : savesPath;

        console.debug('Generating modinfo.json', {
          baseSavesPath,
          modsSavesPath,
          savesPath,
          finalSavesPath,
          isRelative,
        });

        await BridgeAPI.writeTxt(
          path.join(runtime.options.mergedPath, '..', 'modinfo.json'),
          'None',
          JSON.stringify(
            {
              name: runtime.options.outputModName,
              savepath: finalSavesPath,
            },
            null,
            2,
          ),
        );
        // write all modified files to disk
        for (const {
          filePath,
          data,
        } of runtime.fileManager.getModifiedFiles()) {
          const destPath = resolveModOutputPath(runtime.options, filePath);
          mkdirSync(path.dirname(destPath), { recursive: true });
          writeFileSync(destPath, data);
        }

        const ownershipResult = removeLegacyOutputOwnershipManifest(
          getModOutputEnvelopePath(runtime.options),
        );
        if (ownershipResult.removed) {
          console.debug('Removed legacy output ownership manifest');
        } else if (ownershipResult.skipped) {
          console.warn(
            'Skipped legacy output ownership manifest because it is not a file.',
          );
        }

        if (runtime.options.normalizeOutputCRLF) {
          try {
            const { checked, converted, errors } =
              normalizeOutputCRLF(getOutputRootPath());
            console.log(
              `[CRLF normalize] Checked files: ${checked}. Converted files: ${converted}.`,
            );
            if (errors.length > 0) {
              console.warn(
                `[CRLF normalize] ${errors.length} file(s) failed during normalization.`,
              );
              for (const error of errors.slice(0, 20)) {
                console.warn(error);
              }
              if (errors.length > 20) {
                console.warn(
                  `[CRLF normalize] ...and ${errors.length - 20} more error(s).`,
                );
              }
            }
          } catch (e) {
            console.warn(
              '[CRLF normalize] Failed to normalize output files.',
              e,
            );
          }
        }
      }

      if (runtime.modsInstalled.length > 0 && !runtime.options.isDryRun) {
        await runtime.saveFiles.flush({
          read: async (filePath) => BridgeAPI.readBinaryFile(filePath, 'Saves'),
          remove: async (filePath) => {
            await BridgeAPI.deleteFile(filePath, 'Saves');
          },
          write: async (filePath, data) => {
            await BridgeAPI.writeBinaryFile(filePath, 'Saves', data);
          },
        });
      }

      await EventAPI.send(
        'installationProgress',
        runtime.modsToInstall.length,
        runtime.modsToInstall.length,
      ).catch(console.error);

      const modsInstalled = runtime.modsInstalled;
      return modsInstalled;
    } finally {
      try {
        if (
          operationRuntime != null &&
          !operationRuntime.options.isPreExtractedData
        ) {
          await BridgeAPI.closeStorage();
        }
      } finally {
        releaseRuntimeOperation(lease, operationRuntime);
      }
    }
  },
};

export async function initBridgeAPI(): Promise<void> {
  provideAPI('BridgeAPI', BridgeAPI);
}

function findBestMappingForLine(
  lineNumber: number,
  sourceMapConsumer: SourceMapConsumer,
): NullableMappedPosition {
  let bestMapping: MappingItem | null = null;
  sourceMapConsumer.eachMapping((mapping) => {
    if (
      mapping.generatedLine == lineNumber &&
      (bestMapping == null ||
        mapping.originalColumn < bestMapping.originalColumn)
    ) {
      bestMapping = mapping;
    }
  });
  bestMapping = bestMapping as MappingItem | null; // wtf TS?
  return {
    name: bestMapping?.name ?? null,
    source: bestMapping?.source ?? null,
    line: bestMapping?.originalLine ?? null,
    column: bestMapping?.originalColumn ?? null,
  };
}

function applySourceMapToStackTrace(
  stackTrace: string,
  sourceMapConsumer: SourceMapConsumer,
): string {
  return stackTrace
    .split('\n')
    .map((stackFrame) => {
      const match = stackFrame.match(/at\s+(?:.*)\s+\((.*):(\d+)(?::(\d+))?\)/);
      if (match == null) {
        return stackFrame;
      }

      const generatedPosition = {
        source: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3] ?? '1', 10),
      };

      let originalPosition =
        sourceMapConsumer.originalPositionFor(generatedPosition);
      if (originalPosition.source == null) {
        originalPosition = findBestMappingForLine(
          generatedPosition.line,
          sourceMapConsumer,
        );
      }
      if (originalPosition.source == null) {
        return stackFrame;
      }

      return stackFrame
        .replace(
          `(${generatedPosition.source}:${generatedPosition.line})`,
          `(${originalPosition.source}:${originalPosition.line})`,
        )
        .replace(
          `(${generatedPosition.source}:${generatedPosition.line}:${generatedPosition.column})`,
          `(${originalPosition.source}:${originalPosition.line}:${originalPosition.column})`,
        );
    })
    .filter((stackFrame) => !stackFrame.includes('.gen.js:'))
    .join('\n');
}
