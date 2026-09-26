import { extractFile } from '@electron/asar';
import { createHash } from 'crypto';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { Entry, open, ZipFile } from 'yauzl';
import { compareVersions } from '../shared/version';
import {
  MANIFEST,
  safeName,
  digest,
  validateManifest,
} from '../updater/manifest';
import { fetchUpdate } from './AppUpdateNetwork';
import { createReadStream, createWriteStream, fs } from './UpdateFileSystem';

export type ReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string;
};
export type UpdateRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  body: string;
  assets: ReleaseAsset[];
};
export function selectRelease(
  releases: UpdateRelease[],
  current: string,
): { version: string; asset: ReleaseAsset } | null {
  const candidates = releases
    .filter(
      (release) =>
        !release.draft &&
        !release.body?.includes('#alias') &&
        /^v\d+\.\d+\.\d+$/.test(release.tag_name),
    )
    .map((release) => ({
      version: release.tag_name.slice(1),
      assets: release.assets,
    }))
    .filter(({ version }) => compareVersions(version, current) < 0)
    .sort((a, b) => compareVersions(a.version, b.version));
  for (const { version, assets } of candidates) {
    // GitHub replaces spaces in uploaded asset names with dots.
    const matching = assets.filter(
      (asset) =>
        asset.name.replace(/ /g, '.') === `D2RMM.Custom.${version}.zip`,
    );
    if (matching.length === 1) return { version, asset: matching[0] };
  }
  return null;
}
export function updateRequestSignal(
  timeout: number,
  signal?: AbortSignal,
): AbortSignal {
  // Electron 35 supports any(); the project's older DOM declarations omit it.
  const signals = AbortSignal as typeof AbortSignal & {
    any(signals: AbortSignal[]): AbortSignal;
  };
  return signals.any([
    ...(signal == null ? [] : [signal]),
    AbortSignal.timeout(timeout),
  ]);
}
export async function downloadPackage(
  asset: ReleaseAsset,
  destination: string,
  progress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const requestSignal = updateRequestSignal(10 * 60 * 1000, signal);
  requestSignal.throwIfAborted();
  const url = new URL(asset.browser_download_url);
  if (
    url.origin !== 'https://github.com' ||
    !url.pathname.startsWith('/yinyin333333/d2rmm/releases/download/') ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > 1024 ** 3
  )
    throw new Error('Invalid release asset.');
  const response = await fetchUpdate(url.href, {
    signal: requestSignal,
  });
  if (!response.ok || response.body == null) {
    await response.body?.cancel();
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  let received = 0;
  const hash = createHash('sha256');
  const source = Readable.fromWeb(response.body as never);
  source.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (received > asset.size)
      source.destroy(new Error('Download exceeds release size.'));
    hash.update(chunk);
    progress(Math.min(100, (received / asset.size) * 100));
  });
  await pipeline(source, createWriteStream(destination, { flags: 'wx' }), {
    signal: requestSignal,
  });
  if (received !== asset.size) throw new Error('Incomplete download.');
  const checksum = hash.digest('hex');
  if (asset.digest != null && asset.digest !== `sha256:${checksum}`)
    throw new Error('Release SHA-256 does not match.');
}

// Extract to a newly created private staging directory. Validate central metadata
// before opening streams; never follow archive links or write user-data entries.
export async function stagePackage(
  zipPath: string,
  stage: string,
  version: string,
  arch: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    open(
      zipPath,
      { lazyEntries: true, strictFileNames: true },
      (error, archive) => (error ? reject(error) : resolve(archive)),
    ),
  );
  const entries: Entry[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      let total = 0;
      const names = new Set<string>();
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: Entry) => {
        try {
          signal?.throwIfAborted();
          const name = entry.fileName.replace(/\/$/, '');
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (
            !safeName(name) ||
            mode === 0o120000 ||
            entry.externalFileAttributes & 0x400 ||
            names.has(name.toLowerCase()) ||
            entry.generalPurposeBitFlag & 1
          )
            throw new Error(`Unsafe archive entry: ${entry.fileName}`);
          names.add(name.toLowerCase());
          total += entry.uncompressedSize;
          if (total > 3 * 1024 ** 3 || names.size > 20000)
            throw new Error('Update archive too large.');
          entries.push(entry);
          zip.readEntry();
        } catch (error) {
          reject(error);
        }
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  const manifests = entries.filter(
    (entry) =>
      entry.fileName === MANIFEST || entry.fileName.endsWith(`/${MANIFEST}`),
  );
  if (manifests.length !== 1) throw new Error('Expected one program manifest.');
  const prefix = manifests[0].fileName.slice(0, -MANIFEST.length);
  if (
    prefix.split('/').length > 2 ||
    entries.some((entry) => !entry.fileName.startsWith(prefix))
  )
    throw new Error('Invalid ZIP root layout.');
  // Reopen with autoClose disabled so streams can be read after enumeration.
  const reader = await new Promise<ZipFile>((resolve, reject) =>
    open(zipPath, { lazyEntries: true, autoClose: false }, (error, archive) =>
      error ? reject(error) : resolve(archive),
    ),
  );
  const readEntry = (entry: Entry) =>
    new Promise<Readable>((resolve, reject) =>
      reader.openReadStream(entry, (error, stream) =>
        error ? reject(error) : resolve(stream),
      ),
    );
  try {
    if (manifests[0].uncompressedSize > 8 * 1024 ** 2)
      throw new Error('Manifest too large.');
    const chunks: Buffer[] = [];
    for await (const chunk of await readEntry(manifests[0]))
      chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    const manifest = validateManifest(
      JSON.parse(raw.toString('utf8')),
      version,
      arch,
    );
    const expected = new Map<
      string,
      { path: string; size: number; sha256: string }
    >(
      manifest.files.map(
        (file: { path: string; size: number; sha256: string }) => [
          file.path,
          file,
        ],
      ),
    );
    await fs.mkdir(stage, { recursive: false });
    for (const entry of entries) {
      signal?.throwIfAborted();
      const name = entry.fileName.slice(prefix.length);
      if (entry.fileName.endsWith('/')) continue;
      if (name === MANIFEST) continue;
      const file = expected.get(name);
      if (file == null) {
        // Distribution scaffolding is allowed but never applied to an installation.
        if (
          /^(mods|d2rloader|d2rloader-packages)\//.test(name) ||
          /^ENABLE_(LOCAL|GLOBAL)_PREFERENCES$/.test(name)
        )
          continue;
        throw new Error(`Unlisted package file: ${name}`);
      }
      if (file.size !== entry.uncompressedSize)
        throw new Error(`Size mismatch: ${name}`);
      const target = path.join(stage, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await pipeline(
        await readEntry(entry),
        createWriteStream(target, { flags: 'wx' }),
        { signal },
      );
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(target, { signal }))
        hash.update(chunk);
      if (hash.digest('hex') !== file.sha256)
        throw new Error(`Corrupt program file: ${name}`);
      expected.delete(name);
    }
    if (expected.size !== 0) throw new Error('Incomplete program package.');
    const packagedInfo = JSON.parse(
      extractFile(
        path.join(stage, 'resources/app.asar'),
        'package.json',
      ).toString('utf8'),
    );
    if (
      packagedInfo.name !== 'd2rmm' ||
      packagedInfo.version !== version ||
      packagedInfo.main !== './dist/main/main.js'
    )
      throw new Error(
        'Packaged application identity/version does not match the release.',
      );
    // Check PE architecture as well as declared package metadata.
    const exe = await fs.readFile(path.join(stage, 'D2RMM Custom.exe'));
    const pe = exe.length >= 64 ? exe.readUInt32LE(60) : -1;
    if (
      exe.toString('ascii', 0, 2) !== 'MZ' ||
      pe < 0 ||
      pe + 6 > exe.length ||
      exe.readUInt32LE(pe) !== 0x4550 ||
      exe.readUInt16LE(pe + 4) !== 0x8664
    )
      throw new Error('Expected a Windows x64 executable.');
    await fs.writeFile(path.join(stage, MANIFEST), raw, { flag: 'wx' });
  } finally {
    reader.close();
  }
}

export async function validateInstallation(
  root: string,
  version: string,
  arch: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const manifest = validateManifest(
    JSON.parse(await fs.readFile(path.join(root, MANIFEST), 'utf8')),
    version,
    arch,
  );
  for (const file of manifest.files) {
    signal?.throwIfAborted();
    const target = path.join(root, file.path);
    await assertNoLinks(target);
    const data = await fs.readFile(target, { signal });
    if (data.length !== file.size || digest(data) !== file.sha256)
      throw new Error(`Installed program file changed: ${file.path}`);
  }
}
export async function assertNoLinks(target: string): Promise<void> {
  let current = path.resolve(target);
  for (;;) {
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error(`Linked update path: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
