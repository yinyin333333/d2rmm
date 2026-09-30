import {
  collectD2RLoaderLogs,
  writeD2RLoaderLogZip,
} from 'main/D2RLoaderLogExport';
import { exportD2RLoaderLogs } from 'main/ShellAPI';
import { dialog } from 'electron';
import { unzipSync, strFromU8 } from 'fflate';
import os from 'os';
import path from 'path';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';

jest.mock('electron', () => ({ dialog: { showSaveDialog: jest.fn() } }));
jest.mock('main/IPC', () => ({ provideAPI: jest.fn() }));

let root: string;
const contents: Record<string, string> = {
  'd2rloader/logs/loader.log': 'loader log',
  'mods/CustomMod/d2rloader/logs/nested/mod.log': 'mod log',
  'd2rloader/crashes/crash.dmp': 'crash dump',
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'd2rmm-log-export-'));
  for (const [name, content] of Object.entries(contents)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  (dialog.showSaveDialog as jest.Mock).mockReset();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it.each([
  ['loader', ['d2rloader/logs/loader.log']],
  ['loader-and-mod', Object.keys(contents).slice(0, 2)],
  ['all', Object.keys(contents)],
] as const)(
  'exports the exact %s scope and preserves paths and contents',
  async (scope, names) => {
    const plan = await collectD2RLoaderLogs(root, 'CustomMod', scope);
    const destination = path.join(root, 'export.zip');
    await writeD2RLoaderLogZip(plan, destination);
    const archive = unzipSync(await readFile(destination));
    expect(Object.keys(archive).sort()).toEqual([...names].sort());
    for (const name of names)
      expect(strFromU8(archive[name])).toBe(contents[name]);
  },
);

it('reports missing folders while still exporting available logs', async () => {
  await rm(path.join(root, 'mods'), { recursive: true });
  await rm(path.join(root, 'd2rloader/crashes'), { recursive: true });
  const plan = await collectD2RLoaderLogs(root, 'CustomMod', 'all');
  expect(plan.missingDirectories).toEqual([
    'mods/CustomMod/d2rloader/logs',
    'd2rloader/crashes',
  ]);
  expect(plan.files).toHaveLength(1);
});

it('preserves binary crash dumps across multiple streaming chunks', async () => {
  const dump = Buffer.alloc(256 * 1024);
  for (let index = 0; index < dump.length; index += 1) {
    dump[index] = (index * 37) % 256;
  }
  await writeFile(path.join(root, 'd2rloader/crashes/crash.dmp'), dump);
  const plan = await collectD2RLoaderLogs(root, 'CustomMod', 'all');
  const destination = path.join(root, 'export.zip');
  await writeD2RLoaderLogZip(plan, destination);
  const archive = unzipSync(await readFile(destination));
  expect(Buffer.from(archive['d2rloader/crashes/crash.dmp'])).toEqual(dump);
});

it('does not open a save dialog when there are no files', async () => {
  await rm(path.join(root, 'd2rloader'), { recursive: true });
  await expect(
    exportD2RLoaderLogs(root, 'CustomMod', 'loader'),
  ).rejects.toThrow();
  expect(dialog.showSaveDialog).not.toHaveBeenCalled();
});

it('cancels without creating a file', async () => {
  (dialog.showSaveDialog as jest.Mock).mockResolvedValue({ canceled: true });
  await expect(
    exportD2RLoaderLogs(root, 'CustomMod', 'all'),
  ).resolves.toBeNull();
  expect((await readdir(root)).sort()).toEqual(['d2rloader', 'mods']);
});

it('uses the save path, appends .zip, and returns the saved archive', async () => {
  const destination = path.join(root, 'chosen');
  (dialog.showSaveDialog as jest.Mock).mockResolvedValue({
    canceled: false,
    filePath: destination,
  });
  await expect(exportD2RLoaderLogs(root, 'CustomMod', 'all')).resolves.toEqual({
    path: `${destination}.zip`,
    missingDirectories: [],
  });
  expect(
    Object.keys(unzipSync(await readFile(`${destination}.zip`))),
  ).toHaveLength(3);
});

it('preserves an existing destination and cleans up on a read failure', async () => {
  const plan = await collectD2RLoaderLogs(root, 'CustomMod', 'loader');
  const destination = path.join(root, 'export.zip');
  await writeFile(destination, 'previous archive');
  await rm(plan.files[0].source);
  await expect(writeD2RLoaderLogZip(plan, destination)).rejects.toThrow();
  expect(await readFile(destination, 'utf8')).toBe('previous archive');
  expect((await readdir(root)).some((name) => name.endsWith('.tmp'))).toBe(
    false,
  );
});

it('rejects mod names that escape the configured mod folder', async () => {
  await expect(
    collectD2RLoaderLogs(root, '../OtherMod', 'all'),
  ).rejects.toThrow();
});
