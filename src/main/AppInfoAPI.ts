import type { IAppInfoAPI, GetPathParams } from 'bridge/AppInfoAPI';
import { app } from 'electron';
import path from 'path';
import { provideAPI } from './IPC';

function getAppPath() {
  return app.isPackaged
    ? path.resolve(process.resourcesPath, '..')
    : path.resolve(__dirname, '..', '..');
}

function isSteamDeck() {
  const appPath = getAppPath();
  return appPath.startsWith('Z:\\home\\deck\\');
}

export function getDefaultBaseSavesPath(
  userProfile: string | undefined,
  homePath: string,
): string {
  return path.resolve(
    path.join(
      userProfile ?? homePath,
      'Saved Games',
      'Diablo II Resurrected',
    ),
  );
}

export async function initAppInfoAPI(): Promise<void> {
  provideAPI('AppInfoAPI', {
    getIsPackaged: async () => {
      return app.isPackaged;
    },
    getPath: async (name: GetPathParams) => {
      return path.resolve(app.getPath(name));
    },
    getResourcesPath: async () => {
      return path.resolve(process.resourcesPath);
    },
    getDirname: async () => {
      return __dirname;
    },
    getBaseSavesPath: async () => {
      // Steam Deck: /home/deck/.local/share/Steam/steamapps/compatdata/2536520/pfx/drive_c/users/steamuser/Saved Games/Diablo II Resurrected/
      if (isSteamDeck()) {
        return path.resolve(
          path.join(
            'Z:',
            'home',
            'deck',
            '.local',
            'share',
            'Steam',
            'steamapps',
            'compatdata',
            '2536520',
            'pfx',
            'drive_c',
            'users',
            'steamuser',
            'Saved Games',
            'Diablo II Resurrected',
          ),
        );
      }

      // Windows: C:\Users\<username>\Saved Games\Diablo II Resurrected
      return getDefaultBaseSavesPath(
        process.env.USERPROFILE,
        app.getPath('home'),
      );
    },
    getAppPath: async () => {
      return getAppPath();
    },
  } as IAppInfoAPI);
}
