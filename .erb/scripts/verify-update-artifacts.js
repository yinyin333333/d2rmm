// Run after artifact construction so a skipped signing hook or mutated ZIP
// cannot publish a self-update package with stale/missing ownership hashes.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
require('ts-node').register({ transpileOnly: true });
const { stagePackage } = require('../../src/main/AppUpdatePackage');
exports.default = async (context) => {
  const version = require('../../release/app/package.json').version;
  for (const artifact of context.artifactPaths) {
    if (path.basename(artifact) !== `D2RMM Custom ${version}.zip`) continue;
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'd2rmm-verify-'));
    const watchdog = setTimeout(() => {
      console.error('Update ZIP validation timed out.');
      process.exit(1);
    }, 90000);
    try {
      await stagePackage(
        artifact,
        path.join(temporary, 'stage'),
        version,
        'x64',
      );
      console.log(`Verified self-update ZIP: ${artifact}`);
    } finally {
      clearTimeout(watchdog);
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  return [];
};
