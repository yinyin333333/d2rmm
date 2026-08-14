import type { WorkerLifecycleIPCMessage } from 'bridge/IPC';
import { startupMark, startupMeasure } from '../../shared/startupProfiler';
import { initAppInfoAPI } from './AppInfoAPI';
import { initBridgeAPI } from './BridgeAPI';
import { initCascLib } from './CascLib';
import { initConsoleAPI } from './ConsoleAPI';
import { initD2RLoaderPluginAPI } from './D2RLoaderPluginAPI';
import { initEventAPI } from './EventAPI';
import { initIPC } from './IPC';
import { initLocaleAPI } from './LocaleAPI';
import { initModUpdaterAPI } from './ModUpdaterAPI';
import { runWorkerInitialization } from './WorkerLifecycle';
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
  console.debug('[worker] Initializing LocaleAPI...');
  await startupMeasure('worker', 'initLocaleAPI', initLocaleAPI);
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
  console.debug('[worker] Initializing D2RLoaderPluginAPI...');
  await startupMeasure(
    'worker',
    'initD2RLoaderPluginAPI',
    initD2RLoaderPluginAPI,
  );
  console.debug('[worker] Initialized');
  startupMark('worker', 'worker initialized');
}

function sendWorkerLifecycleMessage(
  message: WorkerLifecycleIPCMessage,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.send == null || !process.connected) {
      reject(new Error('Worker IPC transport is disconnected.'));
      return;
    }
    process.send(message, (error: Error | null) => {
      if (error != null) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

runWorkerInitialization(
  start,
  sendWorkerLifecycleMessage,
  process.exit.bind(process),
).catch(console.error);
