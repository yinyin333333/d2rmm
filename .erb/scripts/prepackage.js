/**
 * Runs before `npm run package` to build platform-specific binaries
 * that are not checked into the repository:
 *   - CascLib shared library (CascLib.dll / CascLib.dylib)
 */
const { execSync } = require('child_process');

function run(script) {
  execSync(`npm run ${script}`, { stdio: 'inherit' });
}

switch (process.platform) {
  case 'win32':
    run('build:casclib:win');
    break;
  case 'linux':
    run('build:casclib:linux');
    break;
  default:
    run('build:casclib:mac');
}
