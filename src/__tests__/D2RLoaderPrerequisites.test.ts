import type { IBridgeAPI, IInstallModsOptions } from 'bridge/BridgeAPI';
import type { ConsoleAPI } from 'bridge/ConsoleAPI';
import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import {
  applyD2RLoaderPrerequisites,
  clearD2RLoaderOutputDirectory,
  D2R_LOADER_PREREQUISITE_FILES,
  updateBindDemonSkill,
} from '../main/worker/D2RLoaderPrerequisites';
import { InstallationRuntime } from '../main/worker/InstallationRuntime';
import { getModAPI } from '../main/worker/ModAPI';
import { parseTsv } from '../main/worker/TSVParser';

jest.mock('main/worker/CascLib', () => ({
  readCString: (buffer: Buffer) => buffer.toString('utf8'),
}));

const ORIGINAL_SKILLS = [
  'skill\tsrvstfunc\tcltstfunc\tnote',
  'Other Skill\t1\t2\tuntouched',
  'Bind Demon\t3\t4\ttarget',
  '',
].join('\n');

function makeOptions(
  overrides: Partial<IInstallModsOptions> = {},
): IInstallModsOptions {
  return {
    gamePath: 'fake-game',
    isDryRun: false,
    isPreExtractedData: false,
    mergedPath: 'fake-output',
    normalizeOutputCRLF: false,
    outputModName: 'FakeOutput',
    preExtractedDataPath: 'fake-pre-extracted',
    savesPath: 'fake-saves',
    useD2RLoader: true,
    ...overrides,
  };
}

describe('D2RLoader installation prerequisites', () => {
  let assetRoot: string;
  let extractFileToMemory: jest.Mock;
  let readFile: jest.Mock;
  let runtime: InstallationRuntime;

  beforeEach(() => {
    assetRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-loader-prereq-'));
    writeFileSync(
      path.join(assetRoot, 'desecratedzones.json'),
      '{"prepared":true}',
    );
    writeFileSync(path.join(assetRoot, 'monpet.txt'), 'prepared-monpet');

    extractFileToMemory = jest
      .fn()
      .mockResolvedValue(Buffer.from(ORIGINAL_SKILLS));
    readFile = jest.fn().mockResolvedValue(Buffer.from(ORIGINAL_SKILLS));
    const bridge = {
      extractFileToMemory,
      isGameFile: jest.fn().mockResolvedValue(true),
      readFile,
    } as unknown as IBridgeAPI;
    const consoleAPI = {
      debug: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as ConsoleAPI;
    runtime = new InstallationRuntime(bridge, consoleAPI, makeOptions(), []);
  });

  afterEach(() => {
    rmSync(assetRoot, { force: true, recursive: true });
  });

  it('ships the exact prepared source assets', () => {
    const bundledAssetRoot = path.resolve(
      __dirname,
      '../../assets/d2rloader-prerequisites',
    );
    const desecratedZones = readFileSync(
      path.join(bundledAssetRoot, 'desecratedzones.json'),
    );
    const monPreset = readFileSync(path.join(bundledAssetRoot, 'monpet.txt'));

    expect(() => JSON.parse(desecratedZones.toString('utf8'))).not.toThrow();
    expect(createHash('sha256').update(desecratedZones).digest('hex')).toBe(
      'dac33ac66ac34f125c1af09fe1ae4b12ea5b07e8ecdf416f39157725fa4f2000',
    );
    expect(createHash('sha256').update(monPreset).digest('hex')).toBe(
      'd08402b46505ce36cb97bf5b74783d49d09b8cf487769c5c238898d7ab728276',
    );
  });

  it('seeds all three files before later mod reads', async () => {
    await applyD2RLoaderPrerequisites(runtime, assetRoot);

    expect(
      runtime.fileManager
        .getData(D2R_LOADER_PREREQUISITE_FILES.desecratedZones)
        ?.toString('utf8'),
    ).toBe('{"prepared":true}');
    expect(
      runtime.fileManager
        .getData(D2R_LOADER_PREREQUISITE_FILES.monPreset)
        ?.toString('utf8'),
    ).toBe('prepared-monpet');

    const preparedSkills = parseTsv(
      runtime.fileManager
        .getData(D2R_LOADER_PREREQUISITE_FILES.skills)!
        .toString('utf8'),
    );
    expect(preparedSkills.rows).toEqual([
      {
        skill: 'Other Skill',
        srvstfunc: '1',
        cltstfunc: '2',
        note: 'untouched',
      },
      {
        skill: 'Bind Demon',
        srvstfunc: '30',
        cltstfunc: '58',
        note: 'target',
      },
    ]);
    expect(
      runtime.fileManager.getModifiedFiles().map(({ filePath }) => filePath),
    ).toEqual([
      'hd/global/excel/desecratedzones.json',
      'global/excel/monpet.txt',
      'global/excel/skills.txt',
    ]);
    expect(extractFileToMemory).toHaveBeenCalledWith(
      D2R_LOADER_PREREQUISITE_FILES.skills,
    );

    runtime.mod = {
      config: {},
      id: 'LaterMod',
      info: { name: 'LaterMod', type: 'd2rmm', version: '1.0.0' },
    };
    const laterModView = await getModAPI(runtime).readTsv(
      D2R_LOADER_PREREQUISITE_FILES.skills,
    );
    expect(laterModView.rows[1]).toEqual(
      expect.objectContaining({
        skill: 'Bind Demon',
        srvstfunc: '30',
        cltstfunc: '58',
      }),
    );
    expect(extractFileToMemory).toHaveBeenCalledTimes(1);
  });

  it('uses pre-extracted skills when that data source is selected', async () => {
    runtime.options.isPreExtractedData = true;

    await applyD2RLoaderPrerequisites(runtime, assetRoot);

    expect(readFile).toHaveBeenCalledWith(
      D2R_LOADER_PREREQUISITE_FILES.skills,
      'PreExtractedData',
    );
    expect(extractFileToMemory).not.toHaveBeenCalled();
  });

  it.each([
    ['the option is disabled', { useD2RLoader: false }],
    ['the operation is an uninstall', { isDryRun: true }],
  ])('does nothing when %s', async (_label, overrides) => {
    runtime.options = makeOptions(overrides);

    await applyD2RLoaderPrerequisites(runtime, assetRoot);

    expect(runtime.fileManager.getModifiedFiles()).toEqual([]);
    expect(extractFileToMemory).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('fails safely when the required skills row is unavailable', () => {
    expect(() =>
      updateBindDemonSkill(
        ['skill\tsrvstfunc\tcltstfunc', 'Other\t1\t2', ''].join('\n'),
      ),
    ).toThrow('could not find the "Bind Demon" row');
  });

  it('removes only the generated D2RLoader sibling before a new install flush', async () => {
    const fakeRoot = mkdtempSync(
      path.join(os.tmpdir(), 'd2rmm-loader-output-'),
    );
    try {
      const gameRoot = path.join(fakeRoot, 'game');
      const outputRoot = path.join(gameRoot, 'mods', 'Merged');
      const loaderRoot = path.join(outputRoot, 'd2rloader');
      const outputSentinel = path.join(outputRoot, 'user-stays.txt');
      const outsideSentinel = path.join(fakeRoot, 'outside-stays.txt');
      mkdirSync(path.join(loaderRoot, 'plugins'), { recursive: true });
      writeFileSync(path.join(loaderRoot, 'plugins', 'stale.dll'), 'stale');
      writeFileSync(outputSentinel, 'output-sentinel');
      writeFileSync(outsideSentinel, 'outside-sentinel');

      const deleteFile = jest.fn(
        async (filePath: string, relative: string): Promise<number> => {
          expect(relative).toBe('None');
          rmSync(filePath, { force: true, recursive: true });
          return 1;
        },
      );
      const cleanupRuntime = new InstallationRuntime(
        {
          deleteFile,
        } as unknown as IBridgeAPI,
        runtime.console,
        makeOptions({
          gamePath: gameRoot,
          mergedPath: path.join(outputRoot, 'Merged.mpq', 'data'),
          outputModName: 'Merged',
        }),
        [],
      );

      await expect(clearD2RLoaderOutputDirectory(cleanupRuntime)).resolves.toBe(
        loaderRoot,
      );
      expect(deleteFile).toHaveBeenCalledWith(loaderRoot, 'None');
      expect(existsSync(loaderRoot)).toBe(false);
      expect(readFileSync(outputSentinel, 'utf8')).toBe('output-sentinel');
      expect(readFileSync(outsideSentinel, 'utf8')).toBe('outside-sentinel');
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
  });

  it('clears generated D2RLoader output when a standard-mode install replaces the output', async () => {
    const fakeRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-loader-off-'));
    try {
      const deleteFile = jest.fn();
      runtime.BridgeAPI = { deleteFile } as unknown as IBridgeAPI;
      runtime.options = makeOptions({
        gamePath: fakeRoot,
        mergedPath: path.join(
          fakeRoot,
          'mods',
          'FakeOutput',
          'FakeOutput.mpq',
          'data',
        ),
        outputModName: 'FakeOutput',
        useD2RLoader: false,
      });

      await expect(
        clearD2RLoaderOutputDirectory(runtime),
      ).resolves.not.toBeNull();
      expect(deleteFile).toHaveBeenCalledWith(expect.any(String), 'None');
    } finally {
      rmSync(fakeRoot, { force: true, recursive: true });
    }
  });
});
