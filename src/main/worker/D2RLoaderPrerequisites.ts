import { readFileSync } from 'fs';
import path from 'path';
import { getAppPath, getIsPackaged, getResourcesPath } from './AppInfoAPI';
import type { InstallationRuntime } from './InstallationRuntime';
import { resolveModOutputPath } from './PathSafety';
import { encodeTsv, parseTsv } from './TSVParser';

export const D2R_LOADER_PREREQUISITE_FILES = {
  desecratedZones: path.join('hd', 'global', 'excel', 'desecratedzones.json'),
  monPreset: path.join('global', 'excel', 'monpet.txt'),
  skills: path.join('global', 'excel', 'skills.txt'),
} as const;

const PREREQUISITE_OPERATION = 'D2RLoader prerequisites';

type D2RLoaderPrerequisiteRuntime = Pick<
  InstallationRuntime,
  'BridgeAPI' | 'fileManager' | 'options'
>;

function findHeader(headers: string[], expected: string): string {
  const header = headers.find(
    (candidate) => candidate.trim().toLowerCase() === expected,
  );
  if (header == null) {
    throw new Error(
      `D2RLoader prerequisite could not find the "${expected}" column in skills.txt.`,
    );
  }
  return header;
}

export function updateBindDemonSkill(skillsText: string): string {
  const skills = parseTsv(skillsText.replace(/\0.*$/s, ''));
  const skillHeader = findHeader(skills.headers, 'skill');
  const serverStartHeader = findHeader(skills.headers, 'srvstfunc');
  const clientStartHeader = findHeader(skills.headers, 'cltstfunc');
  const bindDemon = skills.rows.find(
    (row) => row[skillHeader]?.trim().toLowerCase() === 'bind demon',
  );

  if (bindDemon == null) {
    throw new Error(
      'D2RLoader prerequisite could not find the "Bind Demon" row in skills.txt.',
    );
  }

  bindDemon[serverStartHeader] = '30';
  bindDemon[clientStartHeader] = '58';
  return encodeTsv(skills);
}

export function getD2RLoaderPrerequisiteAssetRoot(): string {
  const applicationRoot = getIsPackaged() ? getResourcesPath() : getAppPath();
  return path.join(applicationRoot, 'assets', 'd2rloader-prerequisites');
}

async function markPrerequisiteFile(
  runtime: D2RLoaderPrerequisiteRuntime,
  filePath: string,
  data: Buffer,
): Promise<void> {
  runtime.fileManager.setData(filePath, data);
  await runtime.fileManager.read(filePath, PREREQUISITE_OPERATION);
  await runtime.fileManager.write(filePath, PREREQUISITE_OPERATION);
}

async function readGameFile(
  runtime: D2RLoaderPrerequisiteRuntime,
  filePath: string,
): Promise<Buffer> {
  const data = runtime.options.isPreExtractedData
    ? await runtime.BridgeAPI.readFile(filePath, 'PreExtractedData')
    : await runtime.BridgeAPI.extractFileToMemory(filePath);
  if (data == null) {
    throw new Error(
      `D2RLoader prerequisite could not read game file "${filePath}".`,
    );
  }
  return data;
}

export async function applyD2RLoaderPrerequisites(
  runtime: D2RLoaderPrerequisiteRuntime,
  assetRoot: string = getD2RLoaderPrerequisiteAssetRoot(),
): Promise<void> {
  if (
    runtime.options.useD2RLoader !== true ||
    runtime.options.isDryRun
  ) {
    return;
  }

  await markPrerequisiteFile(
    runtime,
    D2R_LOADER_PREREQUISITE_FILES.desecratedZones,
    readFileSync(path.join(assetRoot, 'desecratedzones.json')),
  );
  await markPrerequisiteFile(
    runtime,
    D2R_LOADER_PREREQUISITE_FILES.monPreset,
    readFileSync(path.join(assetRoot, 'monpet.txt')),
  );

  const skillsPath = D2R_LOADER_PREREQUISITE_FILES.skills;
  const originalSkills = await readGameFile(runtime, skillsPath);
  runtime.fileManager.setData(skillsPath, originalSkills);
  await runtime.fileManager.extract(skillsPath, PREREQUISITE_OPERATION);
  await runtime.fileManager.read(skillsPath, PREREQUISITE_OPERATION);
  runtime.fileManager.setData(
    skillsPath,
    Buffer.from(updateBindDemonSkill(originalSkills.toString('utf8')), 'utf8'),
  );
  await runtime.fileManager.write(skillsPath, PREREQUISITE_OPERATION);
}

export async function clearD2RLoaderOutputDirectory(
  runtime: D2RLoaderPrerequisiteRuntime,
): Promise<string | null> {
  if (
    runtime.options.useD2RLoader !== true ||
    runtime.options.isDirectMode ||
    runtime.options.isDryRun
  ) {
    return null;
  }

  const outputPath = resolveModOutputPath(
    runtime.options,
    path.join('..', '..', 'd2rloader'),
  );
  await runtime.BridgeAPI.deleteFile(outputPath, 'None');
  return outputPath;
}
