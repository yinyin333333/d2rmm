import type { INxmProtocolAPI } from 'bridge/NxmProtocolAPI';
import { app } from 'electron';
import path from 'path';
import { EventAPI } from './EventAPI';
import { provideAPI } from './IPC';
import { NxmProtocolQueue } from './NxmProtocolQueue';

const deliveryQueue = new NxmProtocolQueue((eventID, payload) =>
  EventAPI.send(eventID, payload),
);
let isCapturingNxmProtocolEvents = false;
let hasCapturedInitialArgv = false;

function captureArgv(argv: readonly string[]): void {
  for (const arg of argv) deliveryQueue.enqueue(arg);
}

export function captureNxmProtocolEvents(
  argv: readonly string[] = process.argv,
): void {
  if (!isCapturingNxmProtocolEvents) {
    isCapturingNxmProtocolEvents = true;
    app.on('open-url', (event, url) => {
      if (deliveryQueue.enqueue(url)) event.preventDefault();
    });
    app.on('second-instance', (_event, commandLine, _workingDirectory) => {
      captureArgv(commandLine);
    });
  }
  if (!hasCapturedInitialArgv) {
    hasCapturedInitialArgv = true;
    captureArgv(argv);
  }
}

export async function initNxmProtocolAPI(): Promise<void> {
  captureNxmProtocolEvents();
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
    rendererReady: async () => deliveryQueue.markRendererReady(),
    unregister: async () => app.removeAsDefaultProtocolClient(...args),
  } as INxmProtocolAPI);
}
