import { startupMark, startupMeasure } from '../../shared/startupProfiler';
import { initAppInfoAPI } from './AppInfoAPI';
import { initBridgeAPI } from './BridgeAPI';
import { initCascLib } from './CascLib';
import { initConsoleAPI } from './ConsoleAPI';
import { initEventAPI } from './EventAPI';
import { initIPC } from './IPC';
import { initModUpdaterAPI } from './ModUpdaterAPI';
import { initAsar } from './asar';
import { initI18n } from './i18n';
import { initQuickJS } from './quickjs';

async function start(): Promise<void> {
  startupMark('worker', 'worker process entry');
  console.debug('[worker] Initializing...');
  console.debug('[worker] Initializing i18n...');
  await startupMeasure('worker', 'initI18n', initI18n);
  console.debug('[worker] Initializing IPC...');
  await startupMeasure('worker', 'initIPC', initIPC);
  console.debug('[worker] Initializing EventAPI...');
  await startupMeasure('worker', 'initEventAPI', initEventAPI);
  console.debug('[worker] Initializing ConsoleAPI...');
  await startupMeasure('worker', 'initConsoleAPI', initConsoleAPI);
  console.debug('[worker] Initializing AppInfoAPI...');
  await startupMeasure('worker', 'initAppInfoAPI', initAppInfoAPI);
  console.debug('[worker] Initializing Asar...');
  await startupMeasure('worker', 'initAsar', initAsar);
  console.debug('[worker] Initializing QuickJS...');
  await startupMeasure('worker', 'initQuickJS', initQuickJS);
  console.debug('[worker] Initializing CascLib...');
  await startupMeasure('worker', 'initCascLib', initCascLib);
  console.debug('[worker] Initializing BridgeAPI...');
  await startupMeasure('worker', 'initBridgeAPI', initBridgeAPI);
  console.debug('[worker] Initializing ModUpdaterAPI...');
  await startupMeasure('worker', 'initModUpdaterAPI', initModUpdaterAPI);
  console.debug('[worker] Initialized');
  startupMark('worker', 'worker initialized');
}

start().then().catch(console.error);
