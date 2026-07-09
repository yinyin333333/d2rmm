import type { INxmProtocolAPI } from 'bridge/NxmProtocolAPI';
import { app } from 'electron';
import path from 'path';
import { URL } from 'url';
import { EventAPI } from './EventAPI';
import { provideAPI } from './IPC';

let isInitialized = false;

export async function initNxmProtocolAPI(): Promise<void> {
  if (isInitialized) {
    return;
  }
  isInitialized = true;

  let args: [string, string | undefined, string[] | undefined] = [
    'nxm',
    undefined,
    undefined,
  ];

  if (process.defaultApp && process.argv.length > 1) {
    const scriptArgs: string[] = [process.argv[1]];
    if (process.argv[2]) {
      scriptArgs.push(path.resolve(path.join('node_modules', process.argv[2])));
    }
    if (process.argv[3]) {
      scriptArgs.push(path.resolve(process.argv[3]));
    }
    args = ['nxm', process.execPath, scriptArgs];
  }

  provideAPI('NxmProtocolAPI', {
    getIsRegistered: async () => app.isDefaultProtocolClient(...args),
    register: async () => app.setAsDefaultProtocolClient(...args),
    unregister: async () => app.removeAsDefaultProtocolClient(...args),
  } as INxmProtocolAPI);

  function onOpenNxmUrl(url: string): boolean {
    try {
      const { host, pathname, protocol, searchParams } = new URL(url);
      if (protocol !== 'nxm:') {
        return false;
      }
      const paths = pathname.split('/');
      const game = host;
      if (game !== 'diablo2resurrected') {
        return false;
      }
      if (paths[1] === 'mods' && paths[3] === 'files') {
        const nexusModID = paths[2];
        const nexusFileIDRaw = paths[4];
        const nexusFileID = Number(nexusFileIDRaw);
        const key = searchParams.get('key');
        const expiresRaw = searchParams.get('expires');
        const expires = expiresRaw == null ? null : Number(expiresRaw);
        if (
          nexusModID != null &&
          /^\d+$/.test(nexusModID) &&
          nexusFileIDRaw != null &&
          /^\d+$/.test(nexusFileIDRaw) &&
          (expiresRaw == null || /^\d+$/.test(expiresRaw))
        ) {
          EventAPI.send('nexus-mods-open-url', {
            nexusModID,
            nexusFileID,
            key,
            expires,
          })
            .then()
            .catch(console.error);
          return true;
        }
      } else if (paths[1] === 'collections' && paths[3] === 'revisions') {
        const collectionSlug = paths[2];
        const revisionNumberRaw = paths[4];
        const revisionNumber = Number(revisionNumberRaw);
        if (
          collectionSlug != null &&
          collectionSlug !== '' &&
          revisionNumberRaw != null &&
          /^\d+$/.test(revisionNumberRaw)
        ) {
          EventAPI.send('nexus-mods-open-collection-url', {
            collectionSlug,
            revisionNumber,
          })
            .then()
            .catch(console.error);
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  app.on('open-url', (event, url) => {
    if (onOpenNxmUrl(url)) {
      event.preventDefault();
    }
  });

  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    onOpenNxmUrl(commandLine[commandLine.length - 1] ?? '');
  });
}
