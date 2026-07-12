const fs = require('fs-extra');
const path = require('path');

function getAppContentsDir(context) {
  const { productName } = context.packager.appInfo;
  const isMac = context.packager.platform.nodeName === 'darwin';
  return isMac
    ? path.join(context.appOutDir, `${productName}.app`, 'Contents')
    : context.appOutDir;
}

function copyGeneratedResources(context) {
  const appContentsDir = getAppContentsDir(context);
  const typesTarget = path.join(appContentsDir, 'types.d.ts');
  const schemaTarget = path.join(
    appContentsDir,
    'mods',
    'config-schema.json',
  );
  fs.ensureDirSync(path.dirname(typesTarget));
  fs.ensureDirSync(path.dirname(schemaTarget));

  fs.writeFileSync(
    typesTarget,
    fs
      .readFileSync(path.join(context.outDir, 'types.d.ts'), 'utf-8')
      .replace(/^import (.|[\n\r])*? from .*?;$/gm, ''),
    'utf-8',
  );
  fs.copyFileSync(
    path.join(context.outDir, 'config-schema.json'),
    schemaTarget,
  );
}

exports.copyGeneratedResources = copyGeneratedResources;
exports.default = async function afterPack(context) {
  copyGeneratedResources(context);
};
