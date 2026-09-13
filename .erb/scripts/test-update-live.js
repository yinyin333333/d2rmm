// Isolated packaged-app end-to-end test. No real installation/game is used.
// The fixture's old ASAR package metadata is 1 patch older; all new bytes come
// from the actual final ZIP. Only GitHub transport is replaced in the debugger.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const WebSocket = require('ws');
const { digest, generateManifest } = require('../../src/updater/manifest');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sockets = [];
const watchdog = setTimeout(() => {
  console.error('Packaged update test did not complete');
  process.exit(1);
}, 180000);
const [source, archive, output] = process.argv
  .slice(2)
  .map((value) => path.resolve(value));
const version = require('../../release/app/package.json').version;
const oldVersion = version.replace(/\d+$/, (n) => String(Number(n) - 1));
const root = path.join(output, '설치 폴더');
fs.mkdirSync(output, { recursive: true });
if (fs.existsSync(root)) throw new Error('Use a new isolated output directory');
fs.cpSync(source, root, { recursive: true });
fs.writeFileSync(path.join(root, 'ENABLE_LOCAL_PREFERENCES'), '');
const asarPath = path.join(root, 'resources/app.asar');
const bytes = fs.readFileSync(asarPath);
const headerSize = bytes.readUInt32LE(4);
const headerLength = bytes.readUInt32LE(12);
const header = JSON.parse(bytes.subarray(16, 16 + headerLength));
const entry = header.files['package.json'];
const start = 8 + headerSize + Number(entry.offset);
const original = bytes.subarray(start, start + entry.size).toString('utf8');
const changed = original.replace(version, oldVersion);
if (Buffer.byteLength(changed) !== entry.size || changed === original)
  throw new Error('Fixture version must have equal byte length');
Buffer.from(changed).copy(bytes, start);
if (entry.integrity) {
  entry.integrity.hash = digest(Buffer.from(changed));
  entry.integrity.blocks = [];
  for (let offset = 0; offset < entry.size; offset += entry.integrity.blockSize)
    entry.integrity.blocks.push(
      digest(
        bytes.subarray(
          start + offset,
          Math.min(
            start + entry.size,
            start + offset + entry.integrity.blockSize,
          ),
        ),
      ),
    );
}
const nextHeader = Buffer.from(JSON.stringify(header));
if (nextHeader.length !== headerLength)
  throw new Error('ASAR fixture header length changed');
nextHeader.copy(bytes, 16);
fs.writeFileSync(asarPath, bytes);
generateManifest(root, oldVersion, 'x64');
const protectedFiles = {
  'mods/test/mod.json': JSON.stringify({
    name: 'Preserved test mod',
    author: 'QA',
    version: '1.0.0',
  }),
  'mods/test/mod.js': '',
  'mods/test/config.json': '{"test":123}',
  'd2rloader/plugins/source/keep.bin': 'plugin bytes',
  'd2rloader/plugins/manifest.json': JSON.stringify({
    version: 2,
    name: 'plugins',
    importedAt: '2026-01-01T00:00:00.000Z',
    warnings: [],
    files: [
      {
        role: 'support',
        sha256: digest(Buffer.from('plugin bytes')),
        sourcePath: 'keep.bin',
        targetPath: null,
        targetRoot: null,
      },
    ],
  }),
  'config.json': 'root config',
  'unknown-user-file.txt': 'keep me',
};
for (const [name, data] of Object.entries(protectedFiles)) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}
const executable = path.join(root, 'D2RMM Custom.exe');
const env = { ...process.env, START_MINIMIZED: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let appProcess;
async function until(fn, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      if (!/navigated or closed|Promise was collected/.test(String(error)))
        throw error;
    }
    await delay(100);
  }
  throw new Error('Timed out');
}
async function connect(port) {
  const info = await until(async () => {
    try {
      const v = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json();
      return v.find((x) => x.webSocketDebuggerUrl);
    } catch {
      return null;
    }
  });
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  sockets.push(ws);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  let sequence = 0;
  const pending = new Map();
  ws.on('message', (data) => {
    const v = JSON.parse(data);
    if (v.id && pending.has(v.id)) {
      const { resolve, reject } = pending.get(v.id);
      pending.delete(v.id);
      v.error ? reject(new Error(v.error.message)) : resolve(v.result);
    }
  });
  return {
    close: () => ws.close(),
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    eval: async function (expression) {
      const r = await this.send('Runtime.evaluate', {
        expression,
        awaitPromise: false,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result?.value;
    },
  };
}
async function launch() {
  appProcess = spawn(
    executable,
    ['--inspect=19339', '--remote-debugging-port=19340'],
    { cwd: root, env, windowsHide: true, stdio: 'ignore' },
  );
  const main = await connect(19339);
  if ((await main.eval('process.pid')) !== appProcess.pid)
    throw new Error('Debugger is not attached to this isolated fixture');
  return { main, page: await connect(19340) };
}
async function closeFixture() {
  // Let debugger close frames leave the event loop before synchronously waiting
  // for the debuggee to quit; Node otherwise waits for its inspector client.
  await delay(200);
  const ps = path.join(
    process.env.SystemRoot,
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const closeScript = path.join(output, 'close.ps1');
  fs.writeFileSync(
    closeScript,
    `$p = Get-Process | Where-Object { $_.Path -eq '${executable.replace(/'/g, "''")}' }; foreach ($item in $p) { if (!$item.HasExited) { if (!$item.CloseMainWindow() -or !$item.WaitForExit(5000)) { $item.Kill(); $item.WaitForExit() } } }`,
    'utf8',
  );
  const result = spawnSync(
    ps,
    [
      '-NoProfile',
      '-Command',
      `& ([ScriptBlock]::Create([IO.File]::ReadAllText('${closeScript.replace(/'/g, "''")}',[Text.Encoding]::UTF8)))`,
    ],
    { windowsHide: true, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr);
}
(async () => {
  const first = await launch();
  await until(async () =>
    /Update D2RMM|D2RMM 업데이트/.test(
      await first.page.eval('document.body.innerText'),
    ),
  );
  const saved = {
    'enabled-mods': '{"test":true}',
    'mods-order': '["test"]',
    'installed-mods': '[{"id":"test","config":{"test":123}}]',
    'update-test-marker': '설정 보존 확인',
  };
  await first.page.eval(
    `Object.entries(${JSON.stringify(saved)}).forEach(([key,value])=>localStorage.setItem(key,value));`,
  );
  await first.page.send('Page.reload');
  await delay(1500);
  const assetURL = `https://github.com/yinyin333333/d2rmm/releases/download/v${version}/D2RMM%20Custom%20${version}.zip`;
  const release = {
    tag_name: `v${version}`,
    draft: false,
    prerelease: true,
    body: 'test canonical release',
    assets: [
      {
        name: `D2RMM Custom ${version}.zip`,
        browser_download_url: assetURL,
        size: fs.statSync(archive).size,
        digest: `sha256:${digest(fs.readFileSync(archive))}`,
      },
    ],
  };
  await first.main.eval(
    `globalThis.fetch=async(input)=>{const url=String(input);if(url.startsWith('https://api.github.com/repos/yinyin333333/d2rmm/releases'))return new Response(${JSON.stringify(JSON.stringify([release]))});if(url===${JSON.stringify(assetURL)})return new Response(process.mainModule.require('original-fs').readFileSync(${JSON.stringify(archive)}));throw new Error('Unexpected test network request '+url);};`,
  );
  await first.page.eval(
    `Array.from(document.querySelectorAll('button')).find(b=>/Update D2RMM|D2RMM 업데이트/.test(b.textContent)).click()`,
  );
  await until(async () =>
    first.page.eval(
      `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('${version}')&&!b.disabled)`,
    ),
  );
  const actualOld = await first.main.eval(
    `process.mainModule.require('electron').app.getVersion()`,
  );
  if (actualOld !== oldVersion) throw new Error('Old fixture version mismatch');
  await first.page.eval(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('${version}')&&!b.disabled).click()`,
  );
  const job = await until(async () => {
    const found = fs
      .readdirSync(root)
      .find(
        (n) =>
          n.startsWith('.d2rmm-update-') &&
          fs.existsSync(path.join(root, n, 'plan.json')),
      );
    return found && path.join(root, found);
  });
  first.page.close();
  first.main.close();
  await until(async () => {
    const status = path.join(job, 'status.json');
    if (!fs.existsSync(status)) return false;
    let value;
    try {
      value = JSON.parse(fs.readFileSync(status, 'utf8'));
    } catch {
      return false;
    }
    if (value.phase === 'failed') throw new Error(value.message);
    return value.phase === 'complete';
  });
  await until(
    async () =>
      !fs.existsSync(path.join(job, 'backup')) &&
      !fs.existsSync(path.join(job, 'stage')),
  );
  const ack = JSON.parse(
    fs.readFileSync(path.join(job, 'restarted.json'), 'utf8'),
  );
  if (ack.version !== version || ack.userData !== root)
    throw new Error('Restart confirmation mismatch');
  await closeFixture();
  await delay(500);
  const final = await launch();
  await until(async () =>
    /Update D2RMM|D2RMM 업데이트/.test(
      await final.page.eval('document.body.innerText'),
    ),
  );
  const actualSaved = await final.page.eval(
    `Object.fromEntries(${JSON.stringify(Object.keys(saved))}.map(key=>[key,localStorage.getItem(key)]))`,
  );
  if (JSON.stringify(actualSaved) !== JSON.stringify(saved))
    throw new Error(`Settings changed: ${JSON.stringify(actualSaved)}`);
  for (const [name, data] of Object.entries(protectedFiles))
    if (fs.readFileSync(path.join(root, name), 'utf8') !== data)
      throw new Error('User data changed: ' + name);
  const screenshot = await final.page.send('Page.captureScreenshot');
  fs.writeFileSync(
    path.join(output, 'restarted.png'),
    Buffer.from(screenshot.data, 'base64'),
  );
  const finalVersion = await final.main.eval(
    `process.mainModule.require('electron').app.getVersion()`,
  );
  final.page.close();
  final.main.close();
  await closeFixture();
  const report = {
    passed: true,
    oldVersion: actualOld,
    newVersion: finalVersion,
    userData: ack.userData,
    saved: actualSaved,
    protectedFiles: Object.keys(protectedFiles),
    zipFiles: JSON.parse(
      fs.readFileSync(path.join(root, '.d2rmm-program.json'), 'utf8'),
    ).files.length,
  };
  fs.writeFileSync(
    path.join(output, 'result.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(report);
  clearTimeout(watchdog);
  sockets.forEach((socket) => socket.terminate());
  process.exit(0);
})().catch(async (error) => {
  console.error(error);
  sockets.forEach((socket) => socket.close());
  try {
    await closeFixture();
  } catch {}
  process.exitCode = 1;
  clearTimeout(watchdog);
  sockets.forEach((socket) => socket.terminate());
  process.exit(1);
});
