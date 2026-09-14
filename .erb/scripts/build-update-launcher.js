const { spawnSync } = require('child_process');
const path = require('path');
module.exports = function buildUpdateLauncher(destination) {
  const compiler = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  );
  const result = spawnSync(
    compiler,
    [
      '/nologo',
      '/target:winexe',
      '/platform:x64',
      `/out:${destination}`,
      path.resolve(__dirname, '../../src/updater/Launcher.cs'),
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Updater launcher build failed: ${result.stdout}\n${result.stderr}`,
    );
};
