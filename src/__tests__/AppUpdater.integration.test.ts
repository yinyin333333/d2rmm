import { spawn, spawnSync, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { generateManifest, digest } from '../updater/manifest';

const windows = process.platform === 'win32' ? describe : describe.skip;
const ps = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe',
);
const script = path.resolve('src/updater/updater.ps1');
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => Promise<boolean>): Promise<void> {
  const end = Date.now() + 20000;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error('Timed out');
    await delay(50);
  }
}
async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}
windows('real Windows updater in isolated installations', () => {
  let temporary: string;
  let executable: Buffer;
  const children: ChildProcess[] = [];
  beforeAll(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'd2rmm-update-test-'));
    const source = `using System; using System.IO; using System.Threading; public class Fixture { public static void Main() { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "restarted.txt"), Environment.CurrentDirectory); File.WriteAllText(Environment.GetEnvironmentVariable("D2RMM_UPDATE_ACK"), File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"fixture-ack.json"))); Thread.Sleep(6000); } }`;
    const compiler = path.join(temporary, 'compile.ps1');
    await fs.writeFile(
      compiler,
      `Add-Type -TypeDefinition '${source}' -OutputAssembly '${path.join(temporary, 'fixture.exe').replace(/'/g, "''")}' -OutputType ConsoleApplication`,
    );
    const result = spawnSync(ps, ['-NoProfile', '-File', compiler], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    executable = await fs.readFile(path.join(temporary, 'fixture.exe'));
  }, 30000);
  afterAll(async () => {
    children.forEach((child) => {
      if (child.exitCode == null) child.kill();
    });
    await delay(6500);
    await fs.rm(temporary, { recursive: true, force: true });
  }, 15000);
  async function fixture(transition?: string) {
    const root = await fs.mkdtemp(
      path.join(temporary, '설치 폴더 installation-'),
    );
    const work = await fs.mkdtemp(path.join(root, '.d2rmm-update-'));
    const stage = path.join(work, 'stage');
    const write = async (base: string, name: string, data: string | Buffer) => {
      const file = path.join(base, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data);
    };
    for (const base of [root, stage]) {
      await write(base, 'D2RMM Custom.exe', executable);
      await write(
        base,
        'resources/app.asar',
        base === root ? 'old application' : 'new application',
      );
      await write(base, 'resources/updater.ps1', await fs.readFile(script));
      await write(base, 'resources/updater-launcher.exe', 'launcher');
    }
    await write(root, 'resources/obsolete.bin', 'obsolete program');
    await write(stage, 'resources/new/deep/added.bin', 'new file');
    await write(
      stage,
      'resources/한글 자료/새 파일.bin',
      'new localized resource',
    );
    if (transition === 'directory-to-file') {
      await write(root, 'resources/runtime/old.dat', 'old runtime');
      await write(stage, 'resources/runtime', 'new runtime');
    }
    if (transition === 'file-to-directory') {
      await write(root, 'resources/runtime', 'old runtime');
      await write(stage, 'resources/runtime/new.dat', 'new runtime');
    }
    const protectedNames = [
      'mods/mod/config.json',
      'mods/config-schema.json',
      'd2rloader/plugins/test.dll',
      'd2rloader/config.json',
      'd2rloader-packages/test.zip',
      'config.json',
      'Local Storage/leveldb/000001.log',
      'Cache/test',
      'Preferences',
      'ENABLE_LOCAL_PREFERENCES',
      'ENABLE_GLOBAL_PREFERENCES',
      'unknown.txt',
      'resources/user-added.txt',
      'game/mods/a.mpq/data/test',
    ];
    for (const name of protectedNames)
      await write(root, name, Buffer.from(`user data: ${name}\x00\xff`));
    // user-added files are deliberately absent from the program ownership manifest
    await fs.rename(
      path.join(root, 'resources/user-added.txt'),
      path.join(root, 'user-added.tmp'),
    );
    generateManifest(root, '1.0.0', 'x64');
    await fs.rename(
      path.join(root, 'user-added.tmp'),
      path.join(root, 'resources/user-added.txt'),
    );
    generateManifest(stage, '1.1.0', 'x64');
    const hashes = new Map(
      await Promise.all(
        protectedNames.map(
          async (name) =>
            [name, digest(await fs.readFile(path.join(root, name)))] as const,
        ),
      ),
    );
    const plan = path.join(work, 'plan.json');
    await write(
      root,
      'fixture-ack.json',
      JSON.stringify({ version: '1.1.0', userData: root }),
    );
    const createPlan = (pids: number[]) =>
      fs.writeFile(
        plan,
        JSON.stringify({
          root,
          stage,
          oldVersion: '1.0.0',
          version: '1.1.0',
          arch: 'x64',
          pids,
          cwd: root,
          userData: root,
        }),
      );
    const start = (extra: string[] = []) => {
      const child = spawn(
        ps,
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
          '-Plan',
          plan,
          '-Headless',
          ...extra,
        ],
        { windowsHide: true },
      );
      children.push(child);
      let output = '';
      child.stderr?.on('data', (data) => {
        output += data;
      });
      const done = new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', (code) => {
          if (output) console.log(output);
          resolve(code);
        });
      });
      return { child, done };
    };
    const preserved = async () => {
      for (const [name, hash] of hashes)
        expect(digest(await fs.readFile(path.join(root, name)))).toBe(hash);
    };
    return { root, stage, work, plan, createPlan, start, preserved };
  }
  test('waits for actual exit, updates only owned files, adds directories, removes obsolete files, restarts with cwd', async () => {
    const f = await fixture();
    const old = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    children.push(old);
    await f.createPlan([old.pid!]);
    const { done } = f.start();
    await until(() => exists(path.join(f.work, 'ready')));
    await fs.writeFile(path.join(f.work, 'authorize'), 'yes');
    await delay(400);
    expect(
      await fs.readFile(path.join(f.root, 'resources/app.asar'), 'utf8'),
    ).toBe('old application');
    expect(await exists(path.join(f.root, 'D2RMM Custom.exe'))).toBe(true);
    old.kill();
    expect(await done).toBe(0);
    expect(
      await fs.readFile(path.join(f.root, 'resources/app.asar'), 'utf8'),
    ).toBe('new application');
    expect(await exists(path.join(f.root, 'resources/obsolete.bin'))).toBe(
      false,
    );
    expect(
      await fs.readFile(
        path.join(f.root, 'resources/new/deep/added.bin'),
        'utf8',
      ),
    ).toBe('new file');
    expect(await fs.readFile(path.join(f.root, 'restarted.txt'), 'utf8')).toBe(
      f.root,
    );
    await f.preserved();
  }, 30000);
  test('rolls back a real partial replacement without mixed versions', async () => {
    const f = await fixture();
    await f.createPlan([]);
    const { done } = f.start(['-FailAfterInstall', '2']);
    await until(() => exists(path.join(f.work, 'ready')));
    await fs.writeFile(path.join(f.work, 'authorize'), 'yes');
    expect(await done).toBe(1);
    expect(
      await fs.readFile(path.join(f.work, 'update.log'), 'utf8'),
    ).toContain('Injected file replacement failure');
    expect(
      await fs.readFile(path.join(f.root, 'resources/app.asar'), 'utf8'),
    ).toBe('old application');
    expect(
      await fs.readFile(path.join(f.root, 'resources/obsolete.bin'), 'utf8'),
    ).toBe('obsolete program');
    expect(
      await exists(path.join(f.root, 'resources/new/deep/added.bin')),
    ).toBe(false);
    expect(await exists(path.join(f.root, '.d2rmm-update-lock'))).toBe(false);
    expect(await exists(path.join(f.root, 'restarted.txt'))).toBe(false);
    await f.preserved();
  }, 30000);
  test.each(['directory-to-file', 'file-to-directory'])(
    'supports owned %s transitions',
    async (transition) => {
      const f = await fixture(transition);
      await f.createPlan([]);
      const { done } = f.start();
      await until(() => exists(path.join(f.work, 'ready')));
      await fs.writeFile(path.join(f.work, 'authorize'), 'yes');
      expect(await done).toBe(0);
      expect(
        await fs.readFile(
          path.join(
            f.root,
            transition === 'directory-to-file'
              ? 'resources/runtime'
              : 'resources/runtime/new.dat',
          ),
          'utf8',
        ),
      ).toBe('new runtime');
      await f.preserved();
      expect(await exists(path.join(f.work, 'backup'))).toBe(false);
      expect(await exists(path.join(f.work, 'stage'))).toBe(false);
    },
    30000,
  );
  test('refuses directory-to-file when user files are mixed in, before any replacement', async () => {
    const f = await fixture('directory-to-file');
    await f.createPlan([]);
    await fs.writeFile(path.join(f.root, 'resources/runtime/user.dat'), 'keep');
    const { done } = f.start();
    await until(() => exists(path.join(f.work, 'ready')));
    await fs.writeFile(path.join(f.work, 'authorize'), 'yes');
    expect(await done).toBe(1);
    expect(await exists(path.join(f.work, 'journal.json'))).toBe(false);
    expect(
      await fs.readFile(
        path.join(f.root, 'resources/runtime/user.dat'),
        'utf8',
      ),
    ).toBe('keep');
    await f.preserved();
  }, 30000);
  test('recovers an abruptly terminated partial application using the actual journal', async () => {
    const f = await fixture('file-to-directory');
    await f.createPlan([]);
    const { done } = f.start(['-CrashAfterInstall', '3']);
    await until(() => exists(path.join(f.work, 'ready')));
    await fs.writeFile(path.join(f.work, 'authorize'), 'yes');
    expect(await done).toBe(99);
    expect(await exists(path.join(f.root, '.d2rmm-update-lock'))).toBe(true);
    const recovered = f.start(['-Recover']);
    expect(await recovered.done).toBe(0);
    expect(
      await fs.readFile(path.join(f.root, 'resources/app.asar'), 'utf8'),
    ).toBe('old application');
    expect(
      await fs.readFile(path.join(f.root, 'resources/runtime'), 'utf8'),
    ).toBe('old runtime');
    expect(await exists(path.join(f.root, '.d2rmm-update-lock'))).toBe(false);
    await f.preserved();
  }, 30000);
  test('rejects an unowned destination before changing the old executable', async () => {
    const f = await fixture();
    await f.createPlan([]);
    await fs.mkdir(path.join(f.root, 'resources/new/deep'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(f.root, 'resources/new/deep/added.bin'),
      'user file',
    );
    const { done } = f.start();
    await until(() => exists(path.join(f.work, 'ready')));
    await fs.writeFile(path.join(f.work, 'authorize'), 'yes');
    expect(await done).toBe(1);
    expect(
      await fs.readFile(
        path.join(f.root, 'resources/new/deep/added.bin'),
        'utf8',
      ),
    ).toBe('user file');
    expect(
      await fs.readFile(path.join(f.root, 'resources/app.asar'), 'utf8'),
    ).toBe('old application');
    await f.preserved();
  }, 30000);
  test('cancelled handoff preserves installation and removes owned lock', async () => {
    const f = await fixture();
    await f.createPlan([]);
    const { done } = f.start();
    await until(() => exists(path.join(f.work, 'ready')));
    await fs.writeFile(path.join(f.work, 'cancel'), 'cancel');
    expect(await done).toBe(1);
    expect(await exists(path.join(f.root, '.d2rmm-update-lock'))).toBe(false);
    await f.preserved();
  }, 30000);
  test('a locked program file prevents replacement before the journal starts', async () => {
    const f = await fixture();
    await f.createPlan([]);
    const signal = path.join(f.work, 'file-locked');
    const command = `$f=[IO.File]::Open('${path.join(f.root, 'resources/app.asar').replace(/'/g, "''")}','Open','ReadWrite','None'); [IO.File]::WriteAllText('${signal.replace(/'/g, "''")}','ready'); Start-Sleep -Seconds 30; $f.Dispose()`;
    const holder = spawn(
      ps,
      [
        '-NoProfile',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ],
      { windowsHide: true },
    );
    children.push(holder);
    await until(() => exists(signal));
    const { done } = f.start();
    await until(() => exists(path.join(f.work, 'ready')));
    await fs.writeFile(path.join(f.work, 'authorize'), 'yes');
    expect(await done).toBe(1);
    expect(await exists(path.join(f.work, 'journal.json'))).toBe(false);
    holder.kill();
    await delay(100);
    expect(
      await fs.readFile(path.join(f.root, 'resources/app.asar'), 'utf8'),
    ).toBe('old application');
    await f.preserved();
  }, 30000);
  test('junction destinations are refused without touching their contents', async () => {
    const f = await fixture();
    await f.createPlan([]);
    const external = await fs.mkdtemp(path.join(temporary, 'external-'));
    await fs.writeFile(path.join(external, 'keep'), 'outside data');
    await fs.symlink(external, path.join(f.root, 'resources/new'), 'junction');
    const { done } = f.start();
    await until(() => exists(path.join(f.work, 'ready')));
    await fs.writeFile(path.join(f.work, 'authorize'), 'yes');
    expect(await done).toBe(1);
    expect(await exists(path.join(f.work, 'journal.json'))).toBe(false);
    expect(await fs.readFile(path.join(external, 'keep'), 'utf8')).toBe(
      'outside data',
    );
    await f.preserved();
  }, 30000);
  test('a second helper cannot take or remove the first helper installation lock', async () => {
    const f = await fixture();
    await f.createPlan([]);
    const first = f.start();
    await until(() => exists(path.join(f.work, 'ready')));
    const second = f.start();
    expect(await second.done).toBe(1);
    expect(
      await fs.readFile(path.join(f.root, '.d2rmm-update-lock'), 'utf8'),
    ).toBe(f.plan);
    await fs.writeFile(path.join(f.work, 'cancel'), 'cancel');
    expect(await first.done).toBe(1);
    await f.preserved();
  }, 30000);
  test('a corrupt recovery journal leaves the interrupted-installation lock in place', async () => {
    const f = await fixture();
    await f.createPlan([]);
    await fs.writeFile(path.join(f.root, '.d2rmm-update-lock'), f.plan);
    await fs.writeFile(path.join(f.work, 'journal.json'), '{interrupted');
    const recovery = f.start(['-Recover']);
    expect(await recovery.done).toBe(1);
    expect(
      await fs.readFile(path.join(f.root, '.d2rmm-update-lock'), 'utf8'),
    ).toBe(f.plan);
    await f.preserved();
  }, 30000);
  test.each(['mods/test/config.json', 'resources/user-not-owned.bin'])(
    'invalid recovery journal cannot delete %s',
    async (name) => {
      const f = await fixture();
      await f.createPlan([]);
      const target = path.join(f.root, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'preserve');
      await fs.writeFile(path.join(f.root, '.d2rmm-update-lock'), f.plan);
      await fs.writeFile(
        path.join(f.work, 'journal.json'),
        JSON.stringify([{ name, existed: false }]),
      );
      const recovery = f.start(['-Recover']);
      expect(await recovery.done).toBe(1);
      expect(await fs.readFile(target, 'utf8')).toBe('preserve');
      expect(
        await fs.readFile(path.join(f.root, '.d2rmm-update-lock'), 'utf8'),
      ).toBe(f.plan);
    },
    30000,
  );
});
