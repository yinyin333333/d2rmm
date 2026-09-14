const fs = require('fs-extra');
const path = require('path');

exports.default = async function afterSign(context) {
  const { productName, version } = context.packager.appInfo;
  if (context.packager.platform.nodeName !== 'win32') {
    return;
  }
  // rcedit/signing mutates the executable after afterPack, even without a
  // certificate. Hash final bytes immediately before wrapping the ZIP root.
  const arch = require('builder-util').Arch[context.arch];
  require('./src/updater/manifest').generateManifest(
    context.appOutDir,
    version,
    arch,
  );

  // Wrap only the Windows portable app in a versioned folder. Generated
  // resources are copied in afterPack, before platform signing occurs.
  const source = context.appOutDir;
  const intermediary = path.join(context.outDir, `${productName} ${version}`);
  const destination = path.join(context.appOutDir, `${productName} ${version}`);
  fs.moveSync(source, intermediary);
  fs.moveSync(intermediary, destination);
};
