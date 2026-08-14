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
import packageManifest from '../../package.json';

type HookContext = {
  appOutDir: string;
  outDir: string;
  packager: {
    appInfo: { productName: string; version: string };
    platform: { nodeName: string };
  };
};

const afterSign = require('../../afterSign.js').default as (
  context: HookContext,
) => Promise<void>;
const afterPack = require('../../afterPack.js').default as (
  context: HookContext,
) => Promise<void>;

describe('packaging hook phase and platform boundaries', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'd2rmm-package-hook-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { force: true, recursive: true });
  });

  function context(platform: string): HookContext {
    const outDir = path.join(tempRoot, 'out');
    const appOutDir = path.join(outDir, `${platform}-unpacked`);
    mkdirSync(appOutDir, { recursive: true });
    writeFileSync(path.join(appOutDir, 'marker.txt'), platform);
    writeFileSync(
      path.join(outDir, 'types.d.ts'),
      'import x from "x";\ntype A = 1;',
    );
    writeFileSync(path.join(outDir, 'config-schema.json'), '{"ok":true}');
    return {
      appOutDir,
      outDir,
      packager: {
        appInfo: { productName: 'D2RMM Test', version: '1.2.3' },
        platform: { nodeName: platform },
      },
    };
  }

  it('configures resource copy before signing', () => {
    expect(packageManifest.build.afterPack).toBe('./afterPack.js');
    expect(packageManifest.build.afterSign).toBe('./afterSign.js');
  });

  it.each(['linux', 'darwin'])(
    'afterSign does not mutate or wrap %s output',
    async (platform) => {
      const hookContext = context(platform);

      await afterSign(hookContext);

      expect(
        readFileSync(path.join(hookContext.appOutDir, 'marker.txt'), 'utf8'),
      ).toBe(platform);
      expect(
        existsSync(path.join(hookContext.appOutDir, 'D2RMM Test 1.2.3')),
      ).toBe(false);
      const appContents =
        platform === 'darwin'
          ? path.join(hookContext.appOutDir, 'D2RMM Test.app', 'Contents')
          : hookContext.appOutDir;
      expect(existsSync(path.join(appContents, 'types.d.ts'))).toBe(false);
    },
  );

  it.each(['linux', 'darwin'])(
    'afterPack copies generated resources into %s output before signing',
    async (platform) => {
      const hookContext = context(platform);
      const appContents =
        platform === 'darwin'
          ? path.join(hookContext.appOutDir, 'D2RMM Test.app', 'Contents')
          : hookContext.appOutDir;

      await afterPack(hookContext);

      expect(readFileSync(path.join(appContents, 'types.d.ts'), 'utf8')).toBe(
        '\ntype A = 1;',
      );
      expect(
        readFileSync(
          path.join(appContents, 'mods', 'config-schema.json'),
          'utf8',
        ),
      ).toBe('{"ok":true}');
    },
  );

  it('wraps Windows output only after generated resources are present', async () => {
    const hookContext = context('win32');
    await afterPack(hookContext);
    await afterSign(hookContext);
    const wrappedRoot = path.join(hookContext.appOutDir, 'D2RMM Test 1.2.3');

    expect(readFileSync(path.join(wrappedRoot, 'marker.txt'), 'utf8')).toBe(
      'win32',
    );
    expect(existsSync(path.join(wrappedRoot, 'types.d.ts'))).toBe(true);
    expect(
      existsSync(path.join(wrappedRoot, 'mods', 'config-schema.json')),
    ).toBe(true);
  });
});
