// Shared by packaging and the download validator. User trees are never owned.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST = '.d2rmm-program.json';
function safeName(name) {
  if (typeof name !== 'string' || name.length > 220 || name.includes('\\'))
    return false;
  return name.split('/').every(
    (part) =>
      part.length > 0 &&
      // eslint-disable-next-line no-control-regex
      !/[<>:"|?*\x00-\x1f]/.test(part) &&
      !/[. ]$/.test(part) &&
      part !== '.' &&
      part !== '..' &&
      !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
  );
}
function isProgram(name) {
  if (!safeName(name)) return false;
  if (/^(resources|locales|tools)\//.test(name)) return true;
  return (
    !name.includes('/') &&
    (name === 'D2RMM Custom.exe' ||
      /^(LICENSE(?:\.electron\.txt|S\.chromium\.html)?|version|types\.d\.ts|tsconfig\.json|vk_swiftshader_icd\.json)$/.test(
        name,
      ) ||
      /^(?:[a-zA-Z0-9_-]+\.(?:dll|pak|dat|bin))$/.test(name))
  );
}
function digest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function validateManifest(value, version, arch) {
  if (
    value?.format !== 1 ||
    value.product !== 'D2RMM Custom' ||
    value.platform !== 'win32' ||
    value.arch !== arch ||
    value.version !== version ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    !Array.isArray(value.files) ||
    value.files.length < 3 ||
    value.files.length > 20000
  )
    throw new Error('Invalid program manifest/version/platform.');
  const seen = new Set();
  for (const file of value.files) {
    if (
      !isProgram(file.path) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      seen.has(file.path.toLowerCase())
    )
      throw new Error('Invalid or duplicate program file.');
    seen.add(file.path.toLowerCase());
  }
  for (const name of [
    'D2RMM Custom.exe',
    'resources/app.asar',
    'resources/updater.ps1',
    'resources/updater-launcher.exe',
  ]) {
    if (!seen.has(name.toLowerCase()))
      throw new Error(`Missing program file: ${name}`);
  }
  return value;
}
function generateManifest(root, version, arch) {
  const files = [];
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Link in package: ${name}`);
      if (entry.isDirectory()) {
        if (['resources', 'locales', 'tools'].includes(name) || prefix !== '')
          walk(path.join(directory, entry.name), name + '/');
      } else if (isProgram(name)) {
        const data = fs.readFileSync(path.join(root, name));
        files.push({ path: name, size: data.length, sha256: digest(data) });
      }
    }
  }
  walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = validateManifest(
    {
      format: 1,
      product: 'D2RMM Custom',
      platform: 'win32',
      arch,
      version,
      files,
    },
    version,
    arch,
  );
  fs.writeFileSync(
    path.join(root, MANIFEST),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}
module.exports = {
  MANIFEST,
  safeName,
  isProgram,
  digest,
  validateManifest,
  generateManifest,
};
