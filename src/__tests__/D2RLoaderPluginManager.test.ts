import { zipSync } from 'fflate';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { setImmediate as nodeSetImmediate } from 'timers';
import {
  D2R_LOADER_LEGACY_PACKAGES_DIRECTORY,
  D2R_LOADER_PACKAGE_MANIFEST,
  D2R_LOADER_PACKAGES_DIRECTORY,
  applyManagedD2RLoaderPackages,
  deleteD2RLoaderPluginPackage,
  getManagedD2RLoaderDeployment,
  importD2RLoaderPluginSources,
  readD2RLoaderPluginPackageJSON,
  readD2RLoaderPluginInventory,
  saveD2RLoaderPluginPackageJSON,
  synchronizeD2RLoaderPluginDirectory,
  type D2RLoaderPackageManifest,
} from '../main/worker/D2RLoaderPluginAPI';

jest.mock('main/worker/CascLib', () => ({
  readCString: (buffer: Buffer) => buffer.toString('utf8'),
}));

function writeFile(filePath: string, data: string | Buffer): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, data);
}

function fakePluginDLL(
  extraText: string = '',
  extraBuffer: Buffer = Buffer.alloc(0),
): Buffer {
  return Buffer.concat([
    Buffer.from(
      `MZ\0D2RLoaderGetPluginInfo\0D2RLoaderLoadPlugin\0${extraText}\0`,
      'utf8',
    ),
    extraBuffer,
  ]);
}

describe('D2RLoader plugin package manager', () => {
  const originalSetImmediate = global.setImmediate;
  let tempRoot: string;
  let appRoot: string;
  let incomingRoot: string;
  let sentinelPath: string;

  beforeAll(() => {
    global.setImmediate = nodeSetImmediate;
  });

  afterAll(() => {
    global.setImmediate = originalSetImmediate;
  });

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-plugins-'));
    appRoot = path.join(tempRoot, 'app');
    incomingRoot = path.join(tempRoot, 'incoming');
    sentinelPath = path.join(tempRoot, 'outside', 'sentinel.txt');
    mkdirSync(appRoot, { recursive: true });
    writeFile(sentinelPath, 'outside sentinel');
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function expectSentinelUnchanged(): void {
    expect(readFileSync(sentinelPath, 'utf8')).toBe('outside sentinel');
  }

  it('creates d2rloader before any plugin is imported', () => {
    const packagesRoot = path.join(
      appRoot,
      D2R_LOADER_PACKAGES_DIRECTORY,
    );
    expect(existsSync(packagesRoot)).toBe(false);

    const inventory = readD2RLoaderPluginInventory(appRoot, []);

    expect(inventory.managedRoot).toBe(packagesRoot);
    expect(existsSync(packagesRoot)).toBe(true);
  });

  it('rescans mod-scoped loader folders and preserves duplicate origins', () => {
    writeFile(
      path.join(appRoot, 'mods', 'Mod A', 'd2rloader', 'plugins', 'same.dll'),
      'A',
    );
    writeFile(
      path.join(appRoot, 'mods', 'Mod B', 'D2RLoader', 'Plugins', 'same.dll'),
      'B',
    );
    writeFile(
      path.join(appRoot, 'mods', 'Mod B', 'D2RLoader', 'Patches', 'fix.json'),
      '{}',
    );
    writeFile(
      path.join(
        appRoot,
        'mods',
        'Mod B',
        'D2RLoader',
        'Config',
        'settings.toml',
      ),
      'enabled = true',
    );
    writeFile(
      path.join(
        appRoot,
        'mods',
        'Mod B',
        'D2RLoader',
        'Config',
        'd2rloader.toml',
      ),
      'global = true',
    );
    writeFile(path.join(appRoot, 'mods', 'Mod A', 'ordinary.txt'), 'ignore');
    writeFile(
      path.join(appRoot, 'mods', 'Mod C', 'Wrapped.mpq', 'modinfo.json'),
      '{}',
    );
    mkdirSync(path.join(appRoot, 'mods', 'Mod C', 'Wrapped.mpq', 'data'), {
      recursive: true,
    });
    writeFile(
      path.join(
        appRoot,
        'mods',
        'Mod C',
        'Wrapped.mpq',
        'd2rloader',
        'plugins',
        'wrapped.dll',
      ),
      'C',
    );

    const first = readD2RLoaderPluginInventory(appRoot, [
      'Mod B',
      'Mod C',
      'Mod A',
    ]);

    expect(
      first.plugins.map(({ sourceName, relativePath }) => [
        sourceName,
        relativePath,
      ]),
    ).toEqual([
      ['Mod A', 'same.dll'],
      ['Mod B', 'same.dll'],
      [`Mod C (${path.join('Wrapped.mpq')})`, 'wrapped.dll'],
    ]);
    expect(first.patches).toEqual([
      expect.objectContaining({
        sourceName: 'Mod B',
        relativePath: 'fix.json',
      }),
    ]);
    expect(first.configs).toEqual([
      expect.objectContaining({
        editableSource: {
          category: 'config',
          loaderRootPath: 'D2RLoader',
          modID: 'Mod B',
          sourcePath: 'settings.toml',
          sourceType: 'mod',
        },
        editableSourcePath: 'settings.toml',
        sourceName: 'Mod B',
        relativePath: 'settings.toml',
      }),
    ]);

    rmSync(path.join(appRoot, 'mods', 'Mod A', 'd2rloader'), {
      recursive: true,
    });
    const refreshed = readD2RLoaderPluginInventory(appRoot, [
      'Mod A',
      'Mod B',
      'Mod C',
    ]);
    expect(refreshed.plugins).toHaveLength(2);
    expect(refreshed.plugins[0].sourceName).toBe('Mod B');
    expectSentinelUnchanged();
  });

  it('keeps a folder as one named package and classifies plugin assets by content', async () => {
    const source = path.join(incomingRoot, 'Example Bundle');
    writeFile(
      path.join(source, 'bin', 'Release', 'Example.dll'),
      fakePluginDLL(
        'Data\\Global\\UI\\Layouts\\layout.json',
        Buffer.from('Data\\Global\\Excel\\example.txt\0', 'utf16le'),
      ),
    );
    writeFile(
      path.join(source, 'config', 'example-sample.toml'),
      'enabled=true',
    );
    writeFile(path.join(source, 'example.txt'), 'key\tvalue');
    writeFile(
      path.join(source, 'layout.json'),
      '{"type":"Panel","name":"Example","fields":{},"children":[]}',
    );
    writeFile(path.join(source, 'notes.json'), '{"enabled":true}');
    writeFile(path.join(source, 'README.md'), 'instructions');

    const result = await importD2RLoaderPluginSources(appRoot, [source]);

    expect(result.packages).toEqual(['Example Bundle']);
    const manifestPath = path.join(
      appRoot,
      'd2rloader',
      'Example Bundle',
      D2R_LOADER_PACKAGE_MANIFEST,
    );
    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as D2RLoaderPackageManifest;
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: path.join('bin', 'Release', 'Example.dll'),
          role: 'plugin',
          targetRoot: 'd2rloader',
          targetPath: path.join('plugins', 'Example.dll'),
        }),
        expect.objectContaining({
          sourcePath: path.join('config', 'example-sample.toml'),
          role: 'config',
          targetPath: path.join('config', 'example-sample.toml'),
        }),
        expect.objectContaining({
          sourcePath: 'example.txt',
          role: 'data',
          targetRoot: 'data',
          targetPath: path.join('global', 'excel', 'example.txt'),
        }),
        expect.objectContaining({
          sourcePath: 'layout.json',
          role: 'plugin',
          targetRoot: 'd2rloader',
          targetPath: path.join('plugins', 'layout.json'),
        }),
        expect.objectContaining({
          sourcePath: 'notes.json',
          role: 'plugin',
          targetRoot: 'd2rloader',
          targetPath: path.join('plugins', 'notes.json'),
        }),
      ]),
    );
    expect(existsSync(path.join(path.dirname(manifestPath), 'source'))).toBe(
      true,
    );
    expectSentinelUnchanged();
  });

  it('classifies a patch by schema and rejects an unrelated standalone JSON', async () => {
    const patchPath = path.join(incomingRoot, 'maxstashgold.json');
    writeFile(
      patchPath,
      JSON.stringify({
        version: 1,
        name: 'Patch',
        patches: [{ op: 'write-u32', rva: '0x1000', value: '1' }],
      }),
    );
    const configPath = path.join(incomingRoot, 'settings.json');
    writeFile(configPath, '{"enabled":true}');

    await expect(
      importD2RLoaderPluginSources(appRoot, [patchPath, configPath]),
    ).rejects.toThrow(/no plugin DLL companion/i);
    expect(existsSync(path.join(appRoot, 'd2rloader'))).toBe(false);

    const result = await importD2RLoaderPluginSources(appRoot, [patchPath]);
    expect(result.packages).toEqual(['maxstashgold']);
    const inventory = readD2RLoaderPluginInventory(appRoot, []);
    expect(inventory.patches).toEqual([
      expect.objectContaining({
        sourceName: 'maxstashgold',
        relativePath: 'maxstashgold.json',
      }),
    ]);
    expect(inventory.packages.map(({ name }) => name)).toEqual([
      'maxstashgold',
    ]);
    const openedPatch = readD2RLoaderPluginPackageJSON(
      appRoot,
      'maxstashgold',
      'maxstashgold.json',
    );
    expect(openedPatch.role).toBe('patch');
    const editedPatch = JSON.stringify({
      name: 'Edited Patch',
      patches: [{ op: 'write-u32', rva: '0x1000', value: '2' }],
      version: 1,
    });
    saveD2RLoaderPluginPackageJSON(
      appRoot,
      'maxstashgold',
      'maxstashgold.json',
      openedPatch.sha256,
      editedPatch,
    );
    expect(
      readD2RLoaderPluginPackageJSON(
        appRoot,
        'maxstashgold',
        'maxstashgold.json',
      ),
    ).toEqual(
      expect.objectContaining({ contents: editedPatch, role: 'patch' }),
    );
    expectSentinelUnchanged();
  });

  it('keeps patch schema priority over a companion plugin DLL', async () => {
    const source = path.join(incomingRoot, 'Mixed Package');
    writeFile(path.join(source, 'Mixed.dll'), fakePluginDLL());
    writeFile(
      path.join(source, 'memory.jsonc'),
      '{/* jsonc patch */ "version":1,"patches":[{"op":"write-u8","rva":"0x1234"}]}',
    );
    writeFile(
      path.join(source, 'future.json'),
      '{"version":999,"patches":[{"op":"unknown","rva":"0x1234"}]}',
    );
    writeFile(path.join(source, 'empty.json'), '{"version":1,"patches":[]}');

    await importD2RLoaderPluginSources(appRoot, [source]);
    const inventory = readD2RLoaderPluginInventory(appRoot, []);

    expect(inventory.plugins.map(({ relativePath }) => relativePath)).toEqual([
      'empty.json',
      'future.json',
      'Mixed.dll',
    ]);
    expect(inventory.patches.map(({ relativePath }) => relativePath)).toEqual([
      'memory.jsonc',
    ]);
    expectSentinelUnchanged();
  });

  it('rejects invalid companion JSON instead of silently preserving it', async () => {
    const source = path.join(incomingRoot, 'Broken Companion');
    writeFile(path.join(source, 'Broken.dll'), fakePluginDLL());
    writeFile(path.join(source, 'broken.jsonc'), "{'json5Only':true}");

    await expect(
      importD2RLoaderPluginSources(appRoot, [source]),
    ).rejects.toThrow(/companion JSON\/JSONC is invalid/i);
    expect(existsSync(path.join(appRoot, 'd2rloader'))).toBe(false);
    expectSentinelUnchanged();
  });

  it('keeps multiple loose companion files from one folder in one package', async () => {
    const source = path.join(incomingRoot, 'Shared Plugin Pack');
    const dllPath = path.join(source, 'Shared.dll');
    const configPath = path.join(source, 'D2RPlugins.json');
    const configContents = Buffer.from('{/* jsonc */ "enabled":true}');
    writeFile(dllPath, fakePluginDLL('/D2RPlugins.json'));
    writeFile(configPath, configContents);

    const result = await importD2RLoaderPluginSources(appRoot, [
      dllPath,
      configPath,
    ]);

    expect(result.packages).toEqual(['Shared']);
    const manifest = JSON.parse(
      readFileSync(
        path.join(appRoot, 'd2rloader', 'Shared', D2R_LOADER_PACKAGE_MANIFEST),
        'utf8',
      ),
    ) as D2RLoaderPackageManifest;
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'plugin',
          sourcePath: 'Shared.dll',
          targetPath: path.join('plugins', 'Shared.dll'),
        }),
        expect.objectContaining({
          role: 'plugin',
          sourcePath: 'D2RPlugins.json',
          targetPath: path.join('plugins', 'D2RPlugins.json'),
          targetRoot: 'd2rloader',
        }),
      ]),
    );
    expect(result.warnings).toEqual([]);
    expect(
      readD2RLoaderPluginInventory(appRoot, []).plugins.map(
        ({ relativePath }) => relativePath,
      ),
    ).toEqual(['D2RPlugins.json', 'Shared.dll']);
    const deployedConfig = getManagedD2RLoaderDeployment(appRoot).find(
      ({ targetPath }) =>
        targetPath === path.join('plugins', 'D2RPlugins.json'),
    );
    expect(deployedConfig?.data).toEqual(configContents);
    expectSentinelUnchanged();
  });

  it('reads and atomically edits managed plugin JSONC without changing its role', async () => {
    const source = path.join(incomingRoot, 'Editable Plugin');
    const originalJSON = '{\r\n  // original\r\n  "enabled": true,\r\n}\r\n';
    const editedJSON = '{\n  // edited in D2RMM\n  "enabled": false,\n}\n';
    const dllBytes = fakePluginDLL('/D2RPlugins.json');
    writeFile(path.join(source, 'Editable.dll'), dllBytes);
    writeFile(path.join(source, 'D2RPlugins.json'), originalJSON);
    await importD2RLoaderPluginSources(appRoot, [source]);
    const beforeInventory = readD2RLoaderPluginInventory(appRoot, []);
    const editableItem = beforeInventory.plugins.find(
      ({ name }) => name === 'D2RPlugins.json',
    );

    expect(editableItem?.editableSourcePath).toBe('D2RPlugins.json');
    const opened = readD2RLoaderPluginPackageJSON(
      appRoot,
      'Editable Plugin',
      'D2RPlugins.json',
    );
    expect(opened).toMatchObject({
      contents: originalJSON,
      format: 'json',
      packageName: 'Editable Plugin',
      role: 'plugin',
      sourcePath: 'D2RPlugins.json',
      targetPath: path.join('plugins', 'D2RPlugins.json'),
    });

    const saved = saveD2RLoaderPluginPackageJSON(
      appRoot,
      'Editable Plugin',
      'D2RPlugins.json',
      opened.sha256,
      editedJSON,
    );
    const reopened = readD2RLoaderPluginPackageJSON(
      appRoot,
      'Editable Plugin',
      'D2RPlugins.json',
    );
    const afterInventory = readD2RLoaderPluginInventory(appRoot, []);
    const deployment = getManagedD2RLoaderDeployment(appRoot);

    expect(saved.warnings).toEqual([]);
    expect(reopened.contents).toBe(editedJSON);
    expect(reopened.sha256).toBe(saved.sha256);
    expect(afterInventory.managedSignature).not.toBe(
      beforeInventory.managedSignature,
    );
    expect(
      deployment.find(
        ({ targetPath }) =>
          targetPath === path.join('plugins', 'D2RPlugins.json'),
      )?.data,
    ).toEqual(Buffer.from(editedJSON));
    expect(
      deployment.find(({ targetPath }) => targetPath.endsWith('Editable.dll'))
        ?.data,
    ).toEqual(dllBytes);
    expectSentinelUnchanged();
  });

  it('reads and atomically edits managed TOML config', async () => {
    const source = path.join(incomingRoot, 'Editable TOML');
    const originalTOML = 'enabled = true\r\n[feature]\r\nmode = "old"\r\n';
    const editedTOML = 'enabled = false\n[feature]\nmode = "safe"\n';
    writeFile(path.join(source, 'Editable.dll'), fakePluginDLL());
    writeFile(path.join(source, 'settings.toml'), originalTOML);
    await importD2RLoaderPluginSources(appRoot, [source]);

    const beforeInventory = readD2RLoaderPluginInventory(appRoot, []);
    const editableItem = beforeInventory.configs.find(
      ({ name }) => name === 'settings.toml',
    );
    expect(editableItem?.editableSourcePath).toBe('settings.toml');

    const opened = readD2RLoaderPluginPackageJSON(
      appRoot,
      'Editable TOML',
      'settings.toml',
    );
    expect(opened).toMatchObject({
      contents: originalTOML,
      format: 'toml',
      packageName: 'Editable TOML',
      role: 'config',
      sourcePath: 'settings.toml',
      targetPath: path.join('config', 'settings.toml'),
    });

    const saved = saveD2RLoaderPluginPackageJSON(
      appRoot,
      'Editable TOML',
      'settings.toml',
      opened.sha256,
      editedTOML,
    );
    const reopened = readD2RLoaderPluginPackageJSON(
      appRoot,
      'Editable TOML',
      'settings.toml',
    );
    const afterInventory = readD2RLoaderPluginInventory(appRoot, []);
    const deployment = getManagedD2RLoaderDeployment(appRoot);

    expect(saved.warnings).toEqual([]);
    expect(reopened).toMatchObject({
      contents: editedTOML,
      format: 'toml',
      role: 'config',
      sha256: saved.sha256,
    });
    expect(afterInventory.managedSignature).not.toBe(
      beforeInventory.managedSignature,
    );
    expect(
      deployment.find(
        ({ targetPath }) =>
          targetPath === path.join('config', 'settings.toml'),
      )?.data,
    ).toEqual(Buffer.from(editedTOML));
    expectSentinelUnchanged();
  });

  it('keeps d2rloader.toml outside plugin TOML editing and deployment', async () => {
    const source = path.join(incomingRoot, 'TOML Boundary');
    writeFile(path.join(source, 'Boundary.dll'), fakePluginDLL());
    writeFile(path.join(source, 'plugin-settings.toml'), 'enabled = true\n');
    writeFile(path.join(source, 'd2rloader.toml'), 'loader = true\n');

    await importD2RLoaderPluginSources(appRoot, [source]);

    const packagePath = path.join(appRoot, 'd2rloader', 'TOML Boundary');
    const manifest = JSON.parse(
      readFileSync(
        path.join(packagePath, D2R_LOADER_PACKAGE_MANIFEST),
        'utf8',
      ),
    ) as D2RLoaderPackageManifest;
    expect(
      manifest.files.find(({ sourcePath }) => sourcePath === 'plugin-settings.toml'),
    ).toEqual(
      expect.objectContaining({
        role: 'config',
        targetPath: path.join('config', 'plugin-settings.toml'),
        targetRoot: 'd2rloader',
      }),
    );
    expect(
      manifest.files.find(({ sourcePath }) => sourcePath === 'd2rloader.toml'),
    ).toEqual(
      expect.objectContaining({
        role: 'support',
        targetPath: null,
        targetRoot: null,
      }),
    );

    const inventory = readD2RLoaderPluginInventory(appRoot, []);
    expect(inventory.configs.map(({ name }) => name)).toEqual([
      'plugin-settings.toml',
    ]);
    expect(() =>
      readD2RLoaderPluginPackageJSON(
        appRoot,
        'TOML Boundary',
        'd2rloader.toml',
      ),
    ).toThrow(/not an editable.*plugin TOML/i);
    expect(
      getManagedD2RLoaderDeployment(appRoot).some(
        ({ targetPath }) => path.basename(targetPath) === 'd2rloader.toml',
      ),
    ).toBe(false);
    expectSentinelUnchanged();
  });

  it('rejects stale, invalid, or reclassified JSON edits without changing the package', async () => {
    const source = path.join(incomingRoot, 'Protected Editor');
    writeFile(path.join(source, 'Protected.dll'), fakePluginDLL());
    writeFile(path.join(source, 'settings.json'), '{"enabled":true}');
    await importD2RLoaderPluginSources(appRoot, [source]);
    const packagePath = path.join(appRoot, 'd2rloader', 'Protected Editor');
    const sourcePath = path.join(packagePath, 'source', 'settings.json');
    const manifestPath = path.join(packagePath, D2R_LOADER_PACKAGE_MANIFEST);
    const opened = readD2RLoaderPluginPackageJSON(
      appRoot,
      'Protected Editor',
      'settings.json',
    );
    const originalSource = readFileSync(sourcePath);
    const originalManifest = readFileSync(manifestPath);

    expect(() =>
      saveD2RLoaderPluginPackageJSON(
        appRoot,
        'Protected Editor',
        'settings.json',
        '0'.repeat(64),
        '{"enabled":false}',
      ),
    ).toThrow(/changed since the editor was opened/i);
    expect(() =>
      saveD2RLoaderPluginPackageJSON(
        appRoot,
        'Protected Editor',
        'settings.json',
        opened.sha256,
        "{'json5Only':true}",
      ),
    ).toThrow(/invalid JSON\/JSONC/i);
    expect(() =>
      saveD2RLoaderPluginPackageJSON(
        appRoot,
        'Protected Editor',
        'settings.json',
        opened.sha256,
        '{"version":1,"patches":[{"op":"write-u8","rva":"0x10"}]}',
      ),
    ).toThrow(/cannot be changed into a patch/i);
    expect(() =>
      readD2RLoaderPluginPackageJSON(
        appRoot,
        'Protected Editor',
        '../settings.json',
      ),
    ).toThrow(/not an editable/i);
    expect(() =>
      readD2RLoaderPluginPackageJSON(
        appRoot,
        'Protected Editor',
        'Protected.dll',
      ),
    ).toThrow(/not an editable/i);
    expect(() =>
      saveD2RLoaderPluginPackageJSON(
        appRoot,
        'Protected Editor',
        'settings.json',
        opened.sha256,
        ' '.repeat(4 * 1024 * 1024 + 1),
      ),
    ).toThrow(/editor limit/i);
    expect(readFileSync(sourcePath)).toEqual(originalSource);
    expect(readFileSync(manifestPath)).toEqual(originalManifest);
    expectSentinelUnchanged();
  });

  it('rolls back the whole package when an edited JSON install fails', async () => {
    const source = path.join(incomingRoot, 'Editor Rollback');
    writeFile(path.join(source, 'Rollback.dll'), fakePluginDLL());
    writeFile(path.join(source, 'settings.json'), '{"value":"old"}');
    await importD2RLoaderPluginSources(appRoot, [source]);
    const packagePath = path.join(appRoot, 'd2rloader', 'Editor Rollback');
    const sourcePath = path.join(packagePath, 'source', 'settings.json');
    const manifestPath = path.join(packagePath, D2R_LOADER_PACKAGE_MANIFEST);
    const opened = readD2RLoaderPluginPackageJSON(
      appRoot,
      'Editor Rollback',
      'settings.json',
    );
    const originalSource = readFileSync(sourcePath);
    const originalManifest = readFileSync(manifestPath);

    expect(() =>
      saveD2RLoaderPluginPackageJSON(
        appRoot,
        'Editor Rollback',
        'settings.json',
        opened.sha256,
        '{"value":"new"}',
        (operation) => {
          if (operation === 'install') {
            throw new Error('synthetic editor install failure');
          }
        },
      ),
    ).toThrow('synthetic editor install failure');
    expect(readFileSync(sourcePath)).toEqual(originalSource);
    expect(readFileSync(manifestPath)).toEqual(originalManifest);
    expectSentinelUnchanged();
  });

  it('does not overwrite an external package edit made during JSON staging', async () => {
    const source = path.join(incomingRoot, 'Editor Concurrent Change');
    writeFile(path.join(source, 'Concurrent.dll'), fakePluginDLL());
    writeFile(path.join(source, 'settings.json'), '{"value":"old"}');
    await importD2RLoaderPluginSources(appRoot, [source]);
    const packagePath = path.join(
      appRoot,
      'd2rloader',
      'Editor Concurrent Change',
    );
    const sourcePath = path.join(packagePath, 'source', 'settings.json');
    const manifestPath = path.join(packagePath, D2R_LOADER_PACKAGE_MANIFEST);
    const opened = readD2RLoaderPluginPackageJSON(
      appRoot,
      'Editor Concurrent Change',
      'settings.json',
    );
    const originalManifest = readFileSync(manifestPath);
    const externalEdit = '{"value":"external"}';

    expect(() =>
      saveD2RLoaderPluginPackageJSON(
        appRoot,
        'Editor Concurrent Change',
        'settings.json',
        opened.sha256,
        '{"value":"editor"}',
        (operation) => {
          if (operation === 'backup') {
            writeFileSync(sourcePath, externalEdit);
          }
        },
      ),
    ).toThrow(/changed before the JSON\/JSONC edit could be committed/i);
    expect(readFileSync(sourcePath, 'utf8')).toBe(externalEdit);
    expect(readFileSync(manifestPath)).toEqual(originalManifest);
    expectSentinelUnchanged();
  });

  it('migrates the legacy storage root and reclassifies v1 package manifests', async () => {
    const source = path.join(incomingRoot, 'Legacy Plugin');
    writeFile(
      path.join(source, 'Legacy.dll'),
      fakePluginDLL('/D2RPlugins.json'),
    );
    writeFile(
      path.join(source, 'D2RPlugins.json'),
      '{/* legacy jsonc */ "enabled":true}',
    );
    await importD2RLoaderPluginSources(appRoot, [source]);

    const currentRoot = path.join(appRoot, D2R_LOADER_PACKAGES_DIRECTORY);
    const legacyRoot = path.join(appRoot, D2R_LOADER_LEGACY_PACKAGES_DIRECTORY);
    const manifestPath = path.join(
      currentRoot,
      'Legacy Plugin',
      D2R_LOADER_PACKAGE_MANIFEST,
    );
    const legacyManifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as D2RLoaderPackageManifest;
    legacyManifest.version = 1;
    const legacyJSON = legacyManifest.files.find(
      ({ sourcePath }) => sourcePath === 'D2RPlugins.json',
    );
    if (legacyJSON == null) throw new Error('Expected legacy JSON manifest.');
    legacyJSON.role = 'config';
    legacyJSON.targetPath = 'D2RPlugins.json';
    legacyManifest.warnings = ['legacy loader-root inference'];
    writeFileSync(manifestPath, JSON.stringify(legacyManifest, null, 2));
    const manifestBytesBeforeMigration = readFileSync(manifestPath);

    const supportPackagePath = path.join(currentRoot, 'Legacy Support Only');
    writeFile(
      path.join(supportPackagePath, 'source', 'orphan.json'),
      "{'legacyJson5Only':true}",
    );
    writeFile(
      path.join(supportPackagePath, D2R_LOADER_PACKAGE_MANIFEST),
      JSON.stringify({
        files: [
          {
            role: 'support',
            sha256: '0'.repeat(64),
            sourcePath: 'orphan.json',
            targetPath: null,
            targetRoot: null,
          },
        ],
        importedAt: '2026-07-11T00:00:00.000Z',
        name: 'Legacy Support Only',
        version: 1,
        warnings: [],
      }),
    );
    const supportManifestBytesBeforeMigration = readFileSync(
      path.join(supportPackagePath, D2R_LOADER_PACKAGE_MANIFEST),
    );
    renameSync(currentRoot, legacyRoot);
    writeFile(
      path.join(currentRoot, 'D2RMM-PLUGINS-README.txt'),
      'D2RLoader plugin package directory',
    );

    const inventory = readD2RLoaderPluginInventory(appRoot, []);
    const deployment = getManagedD2RLoaderDeployment(appRoot);

    expect(inventory.managedRoot).toBe(currentRoot);
    expect(existsSync(currentRoot)).toBe(true);
    expect(existsSync(legacyRoot)).toBe(false);
    expect(inventory.plugins.map(({ relativePath }) => relativePath)).toEqual([
      'D2RPlugins.json',
      'Legacy.dll',
    ]);
    expect(deployment).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: 'Legacy Plugin',
          targetPath: path.join('plugins', 'D2RPlugins.json'),
          targetRoot: 'd2rloader',
        }),
      ]),
    );
    expect(readFileSync(manifestPath)).toEqual(manifestBytesBeforeMigration);
    expect(
      inventory.packages.find(({ name }) => name === 'Legacy Support Only')
        ?.unmappedFiles,
    ).toEqual(['orphan.json']);
    expect(
      readFileSync(
        path.join(
          currentRoot,
          'Legacy Support Only',
          D2R_LOADER_PACKAGE_MANIFEST,
        ),
      ),
    ).toEqual(supportManifestBytesBeforeMigration);
    expectSentinelUnchanged();
  });

  it('refuses ambiguous roots and adopts a plugin folder copied into d2rloader', async () => {
    const currentRoot = path.join(appRoot, D2R_LOADER_PACKAGES_DIRECTORY);
    const legacyRoot = path.join(appRoot, D2R_LOADER_LEGACY_PACKAGES_DIRECTORY);
    mkdirSync(currentRoot, { recursive: true });
    mkdirSync(legacyRoot, { recursive: true });
    writeFile(path.join(currentRoot, 'pending.zip'), 'pending');
    writeFile(path.join(legacyRoot, 'legacy-entry'), 'legacy');

    expect(() => readD2RLoaderPluginInventory(appRoot, [])).toThrow(
      /both current and legacy/i,
    );
    expect(existsSync(currentRoot)).toBe(true);
    expect(existsSync(legacyRoot)).toBe(true);

    rmSync(legacyRoot, { recursive: true });
    rmSync(path.join(currentRoot, 'pending.zip'));
    const manualFolder = path.join(currentRoot, 'plugins');
    writeFile(
      path.join(manualFolder, 'existing.dll'),
      fakePluginDLL('/settings.toml'),
    );
    writeFile(path.join(manualFolder, 'settings.toml'), 'enabled = true\n');

    const synchronized =
      await synchronizeD2RLoaderPluginDirectory(appRoot);
    const inventory = readD2RLoaderPluginInventory(appRoot, []);

    expect(synchronized.packages).toEqual(['plugins']);
    expect(
      existsSync(path.join(manualFolder, D2R_LOADER_PACKAGE_MANIFEST)),
    ).toBe(true);
    expect(
      existsSync(path.join(manualFolder, 'source', 'existing.dll')),
    ).toBe(true);
    expect(inventory.plugins).toEqual([
      expect.objectContaining({
        relativePath: 'existing.dll',
        sourceName: 'plugins',
        sourceType: 'managed',
      }),
    ]);
    expect(inventory.configs).toEqual([
      expect.objectContaining({
        editableSourcePath: 'settings.toml',
        relativePath: 'settings.toml',
        sourceName: 'plugins',
        sourceType: 'managed',
      }),
    ]);
    expectSentinelUnchanged();
  });

  it('imports a ZIP copied directly into the pre-created d2rloader folder', async () => {
    const currentRoot = path.join(appRoot, D2R_LOADER_PACKAGES_DIRECTORY);
    const zipPath = path.join(currentRoot, 'Manual.zip');
    const readmePath = path.join(currentRoot, 'D2RMM-PLUGINS-README.txt');
    mkdirSync(currentRoot, { recursive: true });
    writeFile(readmePath, 'plugin package directory');
    writeFile(
      zipPath,
      Buffer.from(
        zipSync({
          'Manual/Manual.dll': new Uint8Array(fakePluginDLL()),
          'Manual/settings.toml': Uint8Array.from(
            Buffer.from('enabled = true\n'),
          ),
        }),
      ),
    );

    const synchronized =
      await synchronizeD2RLoaderPluginDirectory(appRoot);
    const inventory = readD2RLoaderPluginInventory(appRoot, []);

    expect(synchronized.packages).toEqual(['Manual']);
    expect(existsSync(readmePath)).toBe(true);
    expect(existsSync(zipPath)).toBe(false);
    expect(
      existsSync(
        path.join(currentRoot, 'Manual', D2R_LOADER_PACKAGE_MANIFEST),
      ),
    ).toBe(true);
    expect(inventory.plugins).toEqual([
      expect.objectContaining({
        relativePath: 'Manual.dll',
        sourceName: 'Manual',
      }),
    ]);
    expect(inventory.configs).toEqual([
      expect.objectContaining({
        editableSourcePath: path.join('Manual', 'settings.toml'),
        relativePath: 'settings.toml',
        sourceName: 'Manual',
      }),
    ]);
    expectSentinelUnchanged();
  });

  it('rejects loader-wide d2rloader.toml from the plugin input directory', async () => {
    const currentRoot = path.join(appRoot, D2R_LOADER_PACKAGES_DIRECTORY);
    const globalConfigPath = path.join(currentRoot, 'd2rloader.toml');
    mkdirSync(currentRoot, { recursive: true });
    writeFile(globalConfigPath, 'default_mod = "D2RMM"\n');

    await expect(
      synchronizeD2RLoaderPluginDirectory(appRoot),
    ).rejects.toThrow(/loader-wide configuration.*Settings/i);
    expect(readFileSync(globalConfigPath, 'utf8')).toBe(
      'default_mod = "D2RMM"\n',
    );
    expectSentinelUnchanged();
  });

  it('accepts an empty current storage root while scanning mod plugins, but refuses a reparse point', () => {
    const currentRoot = path.join(appRoot, D2R_LOADER_PACKAGES_DIRECTORY);
    mkdirSync(currentRoot, { recursive: true });
    writeFile(
      path.join(
        appRoot,
        'mods',
        'Reimagined',
        'd2rloader',
        'plugins',
        'Reimagined.dll',
      ),
      'mod plugin',
    );

    const inventory = readD2RLoaderPluginInventory(appRoot, ['Reimagined']);
    expect(inventory.managedRoot).toBe(currentRoot);
    expect(inventory.plugins).toEqual([
      expect.objectContaining({
        relativePath: 'Reimagined.dll',
        sourceName: 'Reimagined',
        sourceType: 'mod',
      }),
    ]);
    expect(existsSync(currentRoot)).toBe(true);
    rmdirSync(currentRoot);

    const outsideRoot = path.join(tempRoot, 'outside-loader-root');
    mkdirSync(outsideRoot, { recursive: true });
    symlinkSync(
      outsideRoot,
      currentRoot,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() => readD2RLoaderPluginInventory(appRoot, [])).toThrow(
      /must be a real directory/i,
    );
    expectSentinelUnchanged();
  });

  it('stops when an unfinished managed-package transaction is present', async () => {
    const source = path.join(incomingRoot, 'Stable Package');
    writeFile(path.join(source, 'Stable.dll'), fakePluginDLL());
    await importD2RLoaderPluginSources(appRoot, [source]);
    const transactionRemainder = path.join(
      appRoot,
      D2R_LOADER_PACKAGES_DIRECTORY,
      '.Stable Package.incoming-interrupted',
    );
    mkdirSync(transactionRemainder);

    expect(() => readD2RLoaderPluginInventory(appRoot, [])).toThrow(
      /unfinished transaction|unsupported hidden entry/i,
    );
    expect(
      existsSync(
        path.join(appRoot, D2R_LOADER_PACKAGES_DIRECTORY, 'Stable Package'),
      ),
    ).toBe(true);
    expectSentinelUnchanged();
  });

  it('preflights ZIP paths and leaves storage and the outside sentinel unchanged', async () => {
    const zipPath = path.join(incomingRoot, 'unsafe.zip');
    writeFile(
      zipPath,
      Buffer.from(
        zipSync({
          '../escape.dll': fakePluginDLL(),
        }),
      ),
    );

    await expect(
      importD2RLoaderPluginSources(appRoot, [zipPath]),
    ).rejects.toThrow(/unsafe|outside|traversal/i);
    expect(existsSync(path.join(appRoot, 'd2rloader'))).toBe(false);
    expectSentinelUnchanged();
  });

  it('rejects conflicting managed targets before deployment', async () => {
    const sourceA = path.join(incomingRoot, 'Package A');
    const sourceB = path.join(incomingRoot, 'Package B');
    writeFile(path.join(sourceA, 'Same.dll'), fakePluginDLL('A'));
    writeFile(path.join(sourceB, 'same.DLL'), fakePluginDLL('B'));
    await importD2RLoaderPluginSources(appRoot, [sourceA, sourceB]);

    expect(() => getManagedD2RLoaderDeployment(appRoot)).toThrow(/conflict/i);
    expectSentinelUnchanged();
  });

  it('rejects a managed manifest whose targets no longer match source classification', async () => {
    const sourceA = path.join(incomingRoot, 'Package A');
    const sourceB = path.join(incomingRoot, 'Package B');
    writeFile(path.join(sourceA, 'Parent.dll'), fakePluginDLL('parent'));
    writeFile(path.join(sourceB, 'Child.dll'), fakePluginDLL('child'));
    await importD2RLoaderPluginSources(appRoot, [sourceA, sourceB]);

    const childManifestPath = path.join(
      appRoot,
      'd2rloader',
      'Package B',
      D2R_LOADER_PACKAGE_MANIFEST,
    );
    const childManifest = JSON.parse(
      readFileSync(childManifestPath, 'utf8'),
    ) as D2RLoaderPackageManifest;
    childManifest.files[0].targetPath = path.join(
      'plugins',
      'Parent.dll',
      'Child.dll',
    );
    writeFileSync(childManifestPath, JSON.stringify(childManifest));

    expect(() => getManagedD2RLoaderDeployment(appRoot)).toThrow(
      /manifest does not match its source classification/i,
    );
    expect(() => readD2RLoaderPluginInventory(appRoot, [])).toThrow(
      /manifest does not match its source classification/i,
    );
    expectSentinelUnchanged();
  });

  it('reports managed plugin, config, and data conflicts in inventory', async () => {
    const sourceA = path.join(incomingRoot, 'Package A');
    const sourceB = path.join(incomingRoot, 'Package B');
    const references = '/D2RPlugins.json\0Data\\Global\\Excel\\shared.txt';
    writeFile(path.join(sourceA, 'A.dll'), fakePluginDLL(references));
    writeFile(path.join(sourceB, 'B.dll'), fakePluginDLL(references));
    writeFile(path.join(sourceA, 'D2RPlugins.json'), '{"package":"A"}');
    writeFile(path.join(sourceB, 'D2RPlugins.json'), '{"package":"B"}');
    writeFile(path.join(sourceA, 'shared.toml'), 'package="A"');
    writeFile(path.join(sourceB, 'shared.toml'), 'package="B"');
    writeFile(path.join(sourceA, 'shared.txt'), 'A');
    writeFile(path.join(sourceB, 'shared.txt'), 'B');
    await importD2RLoaderPluginSources(appRoot, [sourceA, sourceB]);

    const inventory = readD2RLoaderPluginInventory(appRoot, []);

    expect(inventory.conflicts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /plugins[\\/]D2RPlugins\.json.*Package A.*Package B/i,
        ),
        expect.stringMatching(
          /config[\\/]shared\.toml.*Package A.*Package B/i,
        ),
        expect.stringMatching(
          /data[\\/]global[\\/]excel[\\/]shared\.txt.*Package A.*Package B/i,
        ),
      ]),
    );
    expectSentinelUnchanged();
  });

  it('rejects a managed manifest reparse point', async () => {
    const source = path.join(incomingRoot, 'Linked Manifest');
    writeFile(path.join(source, 'Plugin.dll'), fakePluginDLL());
    await importD2RLoaderPluginSources(appRoot, [source]);
    const manifestPath = path.join(
      appRoot,
      'd2rloader',
      'Linked Manifest',
      D2R_LOADER_PACKAGE_MANIFEST,
    );
    const outsideManifest = path.join(tempRoot, 'outside-manifest');
    mkdirSync(outsideManifest, { recursive: true });
    rmSync(manifestPath, { force: true });
    symlinkSync(
      outsideManifest,
      manifestPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(() => readD2RLoaderPluginInventory(appRoot, [])).toThrow(
      /symbolic link|junction|reparse point/i,
    );
    expectSentinelUnchanged();
  });

  it('rejects a managed source-root junction', async () => {
    const source = path.join(incomingRoot, 'Linked Source');
    writeFile(path.join(source, 'Plugin.dll'), fakePluginDLL());
    await importD2RLoaderPluginSources(appRoot, [source]);
    const managedSource = path.join(
      appRoot,
      'd2rloader',
      'Linked Source',
      'source',
    );
    const outsideSource = path.join(tempRoot, 'outside-source');
    writeFile(path.join(outsideSource, 'Plugin.dll'), fakePluginDLL('outside'));
    rmSync(managedSource, { force: true, recursive: true });
    symlinkSync(
      outsideSource,
      managedSource,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(() => getManagedD2RLoaderDeployment(appRoot)).toThrow(
      /symbolic link|junction|reparse point/i,
    );
    expectSentinelUnchanged();
  });

  it('rejects a junction inside a managed source path', async () => {
    const source = path.join(incomingRoot, 'Linked Child');
    writeFile(path.join(source, 'nested', 'Plugin.dll'), fakePluginDLL());
    await importD2RLoaderPluginSources(appRoot, [source]);
    const managedNested = path.join(
      appRoot,
      'd2rloader',
      'Linked Child',
      'source',
      'nested',
    );
    const outsideNested = path.join(tempRoot, 'outside-nested');
    writeFile(path.join(outsideNested, 'Plugin.dll'), fakePluginDLL('outside'));
    rmSync(managedNested, { force: true, recursive: true });
    symlinkSync(
      outsideNested,
      managedNested,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(() => getManagedD2RLoaderDeployment(appRoot)).toThrow(
      /symbolic link|junction|reparse point/i,
    );
    expectSentinelUnchanged();
  });

  it('keeps deployment hashes and bytes in one immutable source snapshot', async () => {
    const source = path.join(incomingRoot, 'Snapshot');
    const original = fakePluginDLL('original');
    writeFile(path.join(source, 'Snapshot.dll'), original);
    await importD2RLoaderPluginSources(appRoot, [source]);

    const deployment = getManagedD2RLoaderDeployment(appRoot);
    const plugin = deployment.find(({ targetPath }) =>
      targetPath.endsWith('Snapshot.dll'),
    );
    expect(plugin).toBeDefined();
    writeFileSync(plugin!.sourcePath, fakePluginDLL('changed-after-snapshot'));

    expect(plugin!.data).toEqual(original);
    expect(plugin!.data).not.toEqual(readFileSync(plugin!.sourcePath));
    expectSentinelUnchanged();
  });

  it('rolls back every package when a later batch replacement fails', async () => {
    const sourceA = path.join(incomingRoot, 'Package A');
    const sourceB = path.join(incomingRoot, 'Package B');
    writeFile(path.join(sourceA, 'A.dll'), fakePluginDLL('old-a'));
    writeFile(path.join(sourceB, 'B.dll'), fakePluginDLL('old-b'));
    await importD2RLoaderPluginSources(appRoot, [sourceA, sourceB]);
    const installedA = path.join(
      appRoot,
      'd2rloader',
      'Package A',
      'source',
      'A.dll',
    );
    const installedB = path.join(
      appRoot,
      'd2rloader',
      'Package B',
      'source',
      'B.dll',
    );
    const oldA = readFileSync(installedA);
    const oldB = readFileSync(installedB);
    writeFile(path.join(sourceA, 'A.dll'), fakePluginDLL('new-a'));
    writeFile(path.join(sourceB, 'B.dll'), fakePluginDLL('new-b'));

    await expect(
      importD2RLoaderPluginSources(
        appRoot,
        [sourceA, sourceB],
        (operation, packageName) => {
          if (operation === 'install' && packageName === 'Package B') {
            throw new Error('injected second package failure');
          }
        },
      ),
    ).rejects.toThrow('injected second package failure');

    expect(readFileSync(installedA)).toEqual(oldA);
    expect(readFileSync(installedB)).toEqual(oldB);
    expect(readdirSync(path.join(appRoot, 'd2rloader')).sort()).toEqual([
      'Package A',
      'Package B',
    ]);
    expectSentinelUnchanged();
  });

  it('rejects a tampered manifest target outside managed deployment roots', async () => {
    const source = path.join(incomingRoot, 'Tampered');
    writeFile(path.join(source, 'Tampered.dll'), fakePluginDLL());
    await importD2RLoaderPluginSources(appRoot, [source]);
    const manifestPath = path.join(
      appRoot,
      'd2rloader',
      'Tampered',
      D2R_LOADER_PACKAGE_MANIFEST,
    );
    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as D2RLoaderPackageManifest;
    manifest.files[0].targetPath = path.join('..', '..', 'outside.dll');
    writeFileSync(manifestPath, JSON.stringify(manifest));

    expect(() => getManagedD2RLoaderDeployment(appRoot)).toThrow(
      /invalid.*target path/i,
    );
    expectSentinelUnchanged();
  });

  it('rejects a manifest that redirects plugin JSON into MPQ data', async () => {
    const source = path.join(incomingRoot, 'JSON Boundary');
    writeFile(path.join(source, 'Boundary.dll'), fakePluginDLL());
    writeFile(path.join(source, 'settings.json'), '{"enabled":true}');
    await importD2RLoaderPluginSources(appRoot, [source]);
    const manifestPath = path.join(
      appRoot,
      'd2rloader',
      'JSON Boundary',
      D2R_LOADER_PACKAGE_MANIFEST,
    );
    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as D2RLoaderPackageManifest;
    const settings = manifest.files.find(
      ({ sourcePath }) => sourcePath === 'settings.json',
    );
    if (settings == null) throw new Error('Expected plugin settings JSON.');
    settings.role = 'data';
    settings.targetRoot = 'data';
    settings.targetPath = path.join('global', 'ui', 'settings.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));

    expect(() => getManagedD2RLoaderDeployment(appRoot)).toThrow(
      /manifest does not match its source classification/i,
    );
    expectSentinelUnchanged();
  });

  it('stages managed plugin companions for D2RLoader output', async () => {
    const source = path.join(incomingRoot, 'Deploy Me');
    writeFile(path.join(source, 'Deploy.dll'), fakePluginDLL());
    writeFile(
      path.join(source, 'layout.json'),
      '{"type":"Panel","name":"Deploy","fields":{},"children":[]}',
    );
    await importD2RLoaderPluginSources(appRoot, [source]);

    const data = new Map<string, Buffer>();
    const fileManager = {
      exists: (filePath: string) => data.has(filePath),
      getData: (filePath: string) => data.get(filePath) ?? null,
      getModifiedFiles: () =>
        Array.from(data, ([filePath, value]) => ({
          data: value,
          filePath,
        })),
      read: jest.fn(async () => {}),
      setData: jest.fn((filePath: string, value: Buffer) => {
        data.set(filePath, value);
      }),
      write: jest.fn(async () => {}),
    };
    const runtime = {
      BridgeAPI: { getAppPath: async () => appRoot },
      fileManager,
      options: {
        isDryRun: false,
        useD2RLoader: true,
      },
    } as unknown as Parameters<typeof applyManagedD2RLoaderPackages>[0];

    const applied = await applyManagedD2RLoaderPackages(runtime);

    expect(applied).toEqual(
      expect.arrayContaining([
        path.join('..', '..', 'd2rloader', 'plugins', 'Deploy.dll'),
        path.join('..', '..', 'd2rloader', 'plugins', 'layout.json'),
      ]),
    );
    expect(fileManager.write).toHaveBeenCalledTimes(2);
    expectSentinelUnchanged();
  });

  it('rejects tampered managed targets before staging writes', async () => {
    const source = path.join(incomingRoot, 'Nested Target');
    writeFile(path.join(source, 'Nested.dll'), fakePluginDLL());
    await importD2RLoaderPluginSources(appRoot, [source]);
    const manifestPath = path.join(
      appRoot,
      'd2rloader',
      'Nested Target',
      D2R_LOADER_PACKAGE_MANIFEST,
    );
    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as D2RLoaderPackageManifest;
    manifest.files[0].targetPath = path.join('plugins', 'shared', 'Nested.dll');
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const modTarget = path.join('..', '..', 'd2rloader', 'plugins', 'shared');
    const write = jest.fn(async () => {});
    const runtime = {
      BridgeAPI: { getAppPath: async () => appRoot },
      fileManager: {
        exists: () => false,
        getData: () => null,
        getModifiedFiles: () => [
          { data: Buffer.from('mod'), filePath: modTarget },
        ],
        read: jest.fn(async () => {}),
        setData: jest.fn(),
        write,
      },
      options: {
        isDryRun: false,
        useD2RLoader: true,
      },
    } as unknown as Parameters<typeof applyManagedD2RLoaderPackages>[0];

    await expect(applyManagedD2RLoaderPackages(runtime)).rejects.toThrow(
      /manifest does not match its source classification/i,
    );
    expect(write).not.toHaveBeenCalled();
    expectSentinelUnchanged();
  });

  it('rejects mod/mod file-directory conflicts without managed packages', async () => {
    const parentTarget = path.join(
      '..',
      '..',
      'd2rloader',
      'plugins',
      'shared',
    );
    const childTarget = path.join(parentTarget, 'Nested.dll');
    const siblingTarget = path.join(
      '..',
      '..',
      'd2rloader',
      'plugins',
      'shared-old.dll',
    );
    const write = jest.fn(async () => {});
    const runtime = {
      BridgeAPI: { getAppPath: async () => appRoot },
      fileManager: {
        exists: () => false,
        getData: () => null,
        getModifiedFiles: () => [
          { data: Buffer.from('child'), filePath: childTarget },
          { data: Buffer.from('sibling'), filePath: siblingTarget },
          { data: Buffer.from('parent'), filePath: parentTarget },
        ],
        read: jest.fn(async () => {}),
        setData: jest.fn(),
        write,
      },
      options: {
        isDryRun: false,
        useD2RLoader: true,
      },
    } as unknown as Parameters<typeof applyManagedD2RLoaderPackages>[0];

    await expect(applyManagedD2RLoaderPackages(runtime)).rejects.toThrow(
      /enabled mods.*file\/directory conflict/i,
    );
    expect(write).not.toHaveBeenCalled();
    expectSentinelUnchanged();
  });

  it('rejects different mod data that resolves to one normalized target', async () => {
    const write = jest.fn(async () => {});
    const runtime = {
      BridgeAPI: { getAppPath: async () => appRoot },
      fileManager: {
        exists: () => false,
        getData: () => null,
        getModifiedFiles: () => [
          {
            data: Buffer.from('first'),
            filePath: 'global//excel/shared.txt',
          },
          {
            data: Buffer.from('second'),
            filePath: 'global/excel/shared.txt',
          },
        ],
        read: jest.fn(async () => {}),
        setData: jest.fn(),
        write,
      },
      options: {
        isDryRun: false,
        useD2RLoader: true,
      },
    } as unknown as Parameters<typeof applyManagedD2RLoaderPackages>[0];

    await expect(applyManagedD2RLoaderPackages(runtime)).rejects.toThrow(
      /same normalized output target/i,
    );
    expect(write).not.toHaveBeenCalled();
    expectSentinelUnchanged();
  });

  it('deduplicates identical managed data already supplied through a mod alias', async () => {
    const source = path.join(incomingRoot, 'Aliased Target');
    const pluginData = fakePluginDLL('alias');
    writeFile(path.join(source, 'Alias.dll'), pluginData);
    await importD2RLoaderPluginSources(appRoot, [source]);

    const aliasTarget = '../../d2rloader/plugins/tmp/../Alias.dll';
    let modData = pluginData;
    const write = jest.fn(async () => {});
    const runtime = {
      BridgeAPI: { getAppPath: async () => appRoot },
      fileManager: {
        exists: () => false,
        getData: () => null,
        getModifiedFiles: () => [{ data: modData, filePath: aliasTarget }],
        read: jest.fn(async () => {}),
        setData: jest.fn(),
        write,
      },
      options: {
        isDryRun: false,
        useD2RLoader: true,
      },
    } as unknown as Parameters<typeof applyManagedD2RLoaderPackages>[0];

    await expect(applyManagedD2RLoaderPackages(runtime)).resolves.toEqual([]);
    expect(write).not.toHaveBeenCalled();

    modData = Buffer.from('different mod data');
    await expect(applyManagedD2RLoaderPackages(runtime)).rejects.toThrow(
      /same normalized output target/i,
    );
    expect(write).not.toHaveBeenCalled();
    expectSentinelUnchanged();
  });

  it('deletes only a validated managed package', async () => {
    const source = path.join(incomingRoot, 'Delete Me');
    writeFile(path.join(source, 'DeleteMe.dll'), fakePluginDLL());
    await importD2RLoaderPluginSources(appRoot, [source]);

    deleteD2RLoaderPluginPackage(appRoot, 'Delete Me');

    expect(existsSync(path.join(appRoot, 'd2rloader', 'Delete Me'))).toBe(
      false,
    );
    expect(existsSync(path.join(appRoot, 'd2rloader'))).toBe(true);
    expect(() => deleteD2RLoaderPluginPackage(appRoot, '../outside')).toThrow(
      /invalid/i,
    );
    expectSentinelUnchanged();
  });
});
