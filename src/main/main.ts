import 'core-js/stable';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import log from 'electron-log/main';
import path from 'path';
import 'regenerator-runtime/runtime';
import { tl } from '../shared/i18n';
import { startupMark, startupMeasure } from '../shared/startupProfiler';
import { initAppInfoAPI } from './AppInfoAPI';
import { initConsoleAPI } from './ConsoleAPI';
import { initEventAPI } from './EventAPI';
import { initIPC } from './IPC';
import { initNxmProtocolAPI } from './NxmProtocolAPI';
import { RendererIPCAPI } from './RendererIPCAPI';
import { initRequestAPI } from './RequestAPI';
import { initShellAPI } from './ShellAPI';
import { getWorkers, spawnNewWorker } from './Workers';
import { initI18n } from './i18n';
import { initPreferences } from './preferences';
import { resolveHtmlPath } from './util';
import { CURRENT_VERSION } from './version';

(async () => {
  startupMark('main', 'main process entry');
  const isSingleInstance = app.requestSingleInstanceLock();
  if (!isSingleInstance) {
    app.quit();
    return;
  }

  const appPath = app.isPackaged
    ? path.resolve(process.resourcesPath, '..')
    : path.resolve(__dirname, '..', '..');

  log.initialize();
  log.transports.file.resolvePathFn = () =>
    path.resolve(path.join(appPath, 'd2rmm.log'));
  Object.assign(console, log.functions);

  const isSteamDeck = appPath.startsWith('Z:\\home\\deck\\');

  console.log(`[main] Starting D2RMM ${CURRENT_VERSION}...`);
  console.debug('environment', {
    platform: process.platform,
    node_environment: process.env.NODE_ENV,
    git_commit: process.env.GIT_COMMIT_HASH ?? 'dev',
    user_profile: process.env.USERPROFILE,
    app_path: appPath,
    home_path: path.resolve(app.getPath('home')),
    is_stream_deck: isSteamDeck,
  });

  let mainWindow: BrowserWindow | null = null;
  if (process.env.NODE_ENV === 'production') {
    const sourceMapSupport = require('source-map-support');
    sourceMapSupport.install();
  }

  const isDevelopment =
    process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

  if (isDevelopment) {
    require('electron-debug')();
  }

  const installExtensions = async () => {
    const installer = require('electron-devtools-installer');
    const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
    const extensions = ['REACT_DEVELOPER_TOOLS'];

    return installer
      .default(
        extensions.map((name) => installer[name]),
        forceDownload,
      )
      .catch(console.log);
  };

  const createWindow = async () => {
    startupMark('main', 'createWindow start');
    console.debug('[main] Initializing...');
    if (isDevelopment) {
      await startupMeasure('main', 'installExtensions', installExtensions);
    }

    const RESOURCES_PATH = app.isPackaged
      ? path.join(process.resourcesPath, 'assets')
      : path.join(__dirname, '../../assets');

    const getAssetPath = (...paths: string[]): string => {
      return path.join(RESOURCES_PATH, ...paths);
    };

    const preloadPath = path.join(__dirname, 'preload.js');
    startupMark('main', `preload path setup: ${preloadPath}`);
    startupMark('main', 'BrowserWindow constructor start');
    mainWindow = new BrowserWindow({
      show: false,
      width: 1024,
      height: 728,
      icon: getAssetPath('icon.png'),
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
      },
    });
    startupMark('main', 'BrowserWindow constructor completed');
    mainWindow.setTitle(
      `[D2RMM Custom] Diablo II: Resurrected Mod Manager ${CURRENT_VERSION}`,
    );
    mainWindow.removeMenu();

    mainWindow.on('ready-to-show', () => {
      startupMark('main', 'ready-to-show');
      if (!mainWindow) {
        throw new Error('"mainWindow" is not defined');
      }
      if (process.env.START_MINIMIZED) {
        mainWindow.minimize();
        startupMark('main', 'window minimized');
      } else {
        mainWindow.show();
        startupMark('main', 'window shown');
      }
    });

    mainWindow.webContents.on('dom-ready', () => {
      startupMark('main', 'dom-ready');
    });

    mainWindow.webContents.on('did-finish-load', () => {
      startupMark('main', 'did-finish-load');
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    // Open urls in the user's browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url).catch(console.error);
      return { action: 'deny' };
    });

    console.debug('[main] Initializing IPC...');
    await startupMeasure('main', 'initIPC', () => initIPC(mainWindow!));
    console.debug('[main] Initializing EventAPI...');
    await startupMeasure('main', 'initEventAPI', initEventAPI);
    console.debug('[main] Initializing ConsoleAPI...');
    await startupMeasure('main', 'initConsoleAPI', initConsoleAPI);
    console.debug('[main] Initializing AppInfoAPI...');
    await startupMeasure('main', 'initAppInfoAPI', initAppInfoAPI);
    console.debug('[main] Initializing ShellAPI...');
    await startupMeasure('main', 'initShellAPI', initShellAPI);
    console.debug('[main] Initializing RequestAPI...');
    await startupMeasure('main', 'initRequestAPI', initRequestAPI);
    console.debug('[main] Initializing NxmProtocolAPI...');
    await startupMeasure('main', 'initNxmProtocolAPI', initNxmProtocolAPI);
    console.debug('[main] Initialized');

    try {
      console.debug('[main] Spawning worker...');
      await startupMeasure('main', 'spawnNewWorker', spawnNewWorker);
      console.debug('[main] Worker spawned successfully!');
    } catch (e) {
      console.error(tl('main.worker.spawnFailed'), e);
      app.quit();
    }

    await startupMeasure('main', 'loadURL', () =>
      mainWindow!.loadURL(resolveHtmlPath('index.html')),
    );
    startupMark('main', 'createWindow completed');
  };

  app.on('window-all-closed', () => {
    // Respect the OSX convention of having the application in memory even
    // after all windows have been closed
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  let isSafeToQuit = false;
  app.on('before-quit', (event) => {
    if (!isSafeToQuit) {
      event.preventDefault();
      const timeoutID = setTimeout(() => {
        isSafeToQuit = true;
        app.quit();
      }, 5000);
      RendererIPCAPI.disconnect()
        .catch(console.error)
        .finally(() => {
          clearTimeout(timeoutID);
          isSafeToQuit = true;
          app.quit();
        });
      return;
    }
    getWorkers().forEach((worker) => worker.kill());
    BrowserWindow.getAllWindows().forEach((win) => win.close());
    ipcMain.removeAllListeners();
  });

  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    // Someone tried to run a second instance of D2RMM, we should focus the primary window instead.
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  startupMark('main', 'initPreferences start');
  initPreferences();
  startupMark('main', 'initPreferences completed');

  console.debug('[main] Initializing i18n...');
  startupMeasure('main', 'initI18n', initI18n).catch(console.error);

  app
    .whenReady()
    .then(() => {
      startupMark('main', 'app.whenReady resolved');
      createWindow().catch(console.error);
      app.on('activate', () => {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (mainWindow === null) createWindow().catch(console.error);
      });
    })
    .catch(console.error);
})()
  .then()
  .catch(console.error);
