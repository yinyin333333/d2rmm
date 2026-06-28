import { initAppInfoAPI } from 'renderer/AppInfoAPI';
import { initConsoleAPI } from 'renderer/ConsoleAPI';
import { initEventAPI } from 'renderer/EventAPI';
import { initIPC } from 'renderer/IPC';
import { initI18n } from 'renderer/i18n';
import App from 'renderer/react/App';
import { startupMark, startupMeasure } from 'shared/startupProfiler';
import { createRoot } from 'react-dom/client';

async function initUI(): Promise<void> {
  startupMark('renderer', 'React root render start');
  const container = document.getElementById('root');
  const root = createRoot(container!);
  root.render(<App />);
  startupMark('renderer', 'React root render call returned');
  requestAnimationFrame(() => {
    startupMark('renderer', 'first animation frame after React render');
  });
}

async function start(): Promise<void> {
  startupMark('renderer', 'renderer app bootstrap start');
  console.debug('[renderer] Initializing...');
  console.debug('[renderer] Initializing i18n...');
  await startupMeasure('renderer', 'initI18n', initI18n);
  console.debug('[renderer] Initializing IPC...');
  await startupMeasure('renderer', 'initIPC', initIPC);
  console.debug('[renderer] Initializing EventAPI...');
  await startupMeasure('renderer', 'initEventAPI', initEventAPI);
  console.debug('[renderer] Initializing ConsoleAPI...');
  await startupMeasure('renderer', 'initConsoleAPI', initConsoleAPI);
  console.debug('[renderer] Initializing AppInfoAPI...');
  await startupMeasure('renderer', 'initAppInfoAPI', initAppInfoAPI);
  console.debug('[renderer] Initializing UI...');
  await startupMeasure('renderer', 'initUI', initUI);
  console.debug('[renderer] Initialized');
  startupMark('renderer', 'renderer initialized');
}

start().then().catch(console.error);
