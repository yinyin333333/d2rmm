import { createPackage } from '@electron/asar';
import { randomBytes } from 'crypto';
import { zipSync } from 'fflate';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { setImmediate as nodeSetImmediate } from 'timers';
import {
  selectRelease,
  stagePackage,
  UpdateRelease,
} from '../main/AppUpdatePackage';
import { digest, safeName, isProgram } from '../updater/manifest';

global.setImmediate = nodeSetImmediate;

test('selects newest canonical preview release and excludes compatibility aliases', () => {
  const release = (version: string, body = ''): UpdateRelease => ({
    tag_name: `v${version}`,
    draft: false,
    prerelease: true,
    body,
    assets: [
      {
        name: `D2RMM Custom ${version}.zip`,
        browser_download_url: '',
        size: 1,
      },
    ],
  });
  expect(
    selectRelease(
      [release('1.2.0'), release('1.3.0'), release('9.0.0', '#alias')],
      '1.1.0',
    )?.version,
  ).toBe('1.3.0');
  expect(selectRelease([release('1.2.0')], '1.2.0')).toBeNull();
});
test.each([
  '../escape',
  'a/../b',
  'C:/file',
  'resources/x:stream',
  'resources/CON.txt',
  'resources/x.',
  'resources/x ',
  'resources\\x',
  'resources//x',
])('rejects Windows path escape %s', (name) =>
  expect(safeName(name)).toBe(false),
);
test.each([
  'mods/config-schema.json',
  'd2rloader/plugins/x.dll',
  'd2rloader-packages/a.zip',
  'Local Storage/a',
  'Preferences',
  'config.json',
  'ENABLE_LOCAL_PREFERENCES',
  'ENABLE_GLOBAL_PREFERENCES',
])('never owns user path %s', (name) => expect(isProgram(name)).toBe(false));

describe('actual ZIP package validation', () => {
  let temporary: string;
  let files: Record<string, Uint8Array>;
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'd2rmm-zip-test-'));
    const source = path.join(temporary, 'app');
    await fs.mkdir(source);
    await fs.writeFile(
      path.join(source, 'package.json'),
      JSON.stringify({
        name: 'd2rmm',
        version: '1.2.0',
        main: './dist/main/main.js',
      }),
    );
    await createPackage(source, path.join(temporary, 'app.asar'));
    const exe = Buffer.alloc(128);
    exe.write('MZ');
    exe.writeUInt32LE(64, 60);
    exe.writeUInt32LE(0x4550, 64);
    exe.writeUInt16LE(0x8664, 68);
    files = {
      'D2RMM Custom.exe': exe,
      'resources/app.asar': await fs.readFile(path.join(temporary, 'app.asar')),
      'resources/updater.ps1': Buffer.from('updater'),
      'resources/updater-launcher.exe': Buffer.from('launcher'),
      'resources/new/deep/data.bin': Buffer.from('new data'),
    };
  });
  afterEach(async () => fs.rm(temporary, { recursive: true, force: true }));
  const manifest = (contents: Record<string, Uint8Array>) =>
    Buffer.from(
      JSON.stringify({
        format: 1,
        product: 'D2RMM Custom',
        platform: 'win32',
        arch: 'x64',
        version: '1.2.0',
        files: Object.entries(contents).map(([name, data]) => ({
          path: name,
          size: data.length,
          sha256: digest(data),
        })),
      }),
    );
  async function run(
    contents: Record<string, Uint8Array>,
    version = '1.2.0',
    arch = 'x64',
  ) {
    const zip = path.join(temporary, 'update.zip');
    await fs.writeFile(
      zip,
      zipSync(
        Object.fromEntries(
          Object.entries(contents).map(([name, data]) => [
            name,
            new Uint8Array(data),
          ]),
        ),
      ),
    );
    await stagePackage(zip, path.join(temporary, 'stage'), version, arch);
  }
  test('accepts versioned ZIP root, nested program files and ignores shipped user scaffolding', async () => {
    const contents = {
      ...files,
      '.d2rmm-program.json': manifest(files),
      'mods/config-schema.json': Buffer.from('do not copy'),
      'd2rloader/.gitkeep': Buffer.alloc(0),
    };
    await run(
      Object.fromEntries(
        Object.entries(contents).map(([name, data]) => [
          `D2RMM Custom 1.2.0/${name}`,
          data,
        ]),
      ),
    );
    expect(
      await fs.readFile(
        path.join(temporary, 'stage/resources/new/deep/data.bin'),
        'utf8',
      ),
    ).toBe('new data');
    await expect(
      fs.access(path.join(temporary, 'stage/mods')),
    ).rejects.toThrow();
  });
  test('rejects corrupt content before applying anything', async () => {
    await expect(
      run({
        ...files,
        '.d2rmm-program.json': manifest(files),
        'resources/new/deep/data.bin': Buffer.from('bad data'),
      }),
    ).rejects.toThrow();
  });
  test('finishes multi-megabyte incompressible ZIP streams', async () => {
    const large = randomBytes(4 * 1024 * 1024);
    files['resources/large.bin'] = large;
    await run({ ...files, '.d2rmm-program.json': manifest(files) });
    expect(
      digest(
        await fs.readFile(path.join(temporary, 'stage/resources/large.bin')),
      ),
    ).toBe(digest(large));
  });
  test('rejects mismatched target version', async () => {
    await expect(
      run({ ...files, '.d2rmm-program.json': manifest(files) }, '1.3.0'),
    ).rejects.toThrow();
  });
  test('rejects mismatched architecture', async () => {
    await expect(
      run(
        { ...files, '.d2rmm-program.json': manifest(files) },
        '1.2.0',
        'arm64',
      ),
    ).rejects.toThrow();
  });
  test('rejects actual asar version differing from claimed manifest', async () => {
    const value = JSON.parse(manifest(files).toString());
    value.version = '1.3.0';
    await expect(
      run(
        { ...files, '.d2rmm-program.json': Buffer.from(JSON.stringify(value)) },
        '1.3.0',
      ),
    ).rejects.toThrow('identity/version');
  });
  test('rejects case aliases and unlisted files', async () => {
    await expect(
      run({
        ...files,
        '.d2rmm-program.json': manifest(files),
        'RESOURCES/app.asar': Buffer.from('alias'),
      }),
    ).rejects.toThrow();
  });
  test('rejects traversal', async () => {
    await expect(
      run({
        ...files,
        '.d2rmm-program.json': manifest(files),
        '../user': Buffer.from('escape'),
      }),
    ).rejects.toThrow();
  });
});
