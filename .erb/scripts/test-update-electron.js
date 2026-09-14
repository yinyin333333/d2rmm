// Usage: node .erb/scripts/test-update-electron.js <electron.exe> <unpacked-root> <zip>
// Execute the production validators in real Electron main, not ELECTRON_RUN_AS_NODE.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const [runtime, root, zip] = process.argv
  .slice(2)
  .map((value) => path.resolve(value));
const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), 'd2rmm-electron-verify-'),
);
const result = path.join(temporary, 'result.json');
const entry = path.join(temporary, 'main.cjs');
const version = require('../../release/app/package.json').version;
fs.writeFileSync(
  entry,
  `
const {app} = require('electron');
const fs = require('original-fs');
require(${JSON.stringify(require.resolve('ts-node'))}).register({transpileOnly:true,project:${JSON.stringify(path.resolve('tsconfig.json'))}});
const {validateInstallation,stagePackage} = require(${JSON.stringify(path.resolve('src/main/AppUpdatePackage.ts'))});
const deadline = setTimeout(()=>{fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({error:'validation timeout'}));app.exit(1)},90000);
app.whenReady().then(async()=>{
 await validateInstallation(${JSON.stringify(root)},${JSON.stringify(version)},'x64');
 await stagePackage(${JSON.stringify(zip)},${JSON.stringify(path.join(temporary, 'stage'))},${JSON.stringify(version)},'x64');
 fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({validated:true,electron:process.versions.electron,files:JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root, '.d2rmm-program.json'))},'utf8')).files.length}));
 clearTimeout(deadline);app.exit(0);
}).catch(error=>{fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({error:String(error),stack:error.stack}));clearTimeout(deadline);app.exit(1)});
`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(runtime, [entry], {
  env,
  windowsHide: true,
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  if (!fs.existsSync(result)) {
    console.error(
      'Electron exited without validator completion',
      code,
      temporary,
    );
    process.exitCode = 1;
    return;
  }
  const value = JSON.parse(fs.readFileSync(result, 'utf8'));
  console.log(value);
  if (code !== 0 || !value.validated) process.exitCode = 1;
  else fs.rmSync(temporary, { recursive: true, force: true });
});
