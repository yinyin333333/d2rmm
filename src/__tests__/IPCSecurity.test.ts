import type { IPCMessage, IPCMessageRequest } from 'bridge/IPC';
import {
  consumeAPI,
  initIPC,
  markWorkerReady,
  provideAPI,
  registerWorker,
  unregisterWorker,
} from 'main/IPC';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

const mockIpcMainOn = jest.fn();

jest.mock('electron', () => ({
  ipcMain: {
    on: (...args: unknown[]) => mockIpcMainOn(...args),
  },
}));

class FakeChildProcess extends EventEmitter {
  connected = true;

  send = jest.fn((...args: unknown[]) => {
    const callback = args.find((arg) => typeof arg === 'function') as
      | ((error: Error | null) => void)
      | undefined;
    callback?.(null);
    return true;
  });
}

class FakeWebContents extends EventEmitter {
  readonly mainFrame = {};
  send = jest.fn();

  isDestroyed = (): boolean => false;
}

function asChildProcess(worker: FakeChildProcess): ChildProcess {
  return worker as unknown as ChildProcess;
}

function rendererEvent(
  renderer: FakeWebContents,
  senderFrame: unknown = renderer.mainFrame,
): Electron.IpcMainEvent {
  return {
    sender: renderer,
    senderFrame,
  } as unknown as Electron.IpcMainEvent;
}

async function bindRenderer(
  renderer: FakeWebContents,
): Promise<(event: Electron.IpcMainEvent, message: unknown) => void> {
  await initIPC({ webContents: renderer } as never);
  return mockIpcMainOn.mock.calls.find(([channel]) => channel === 'ipc')?.[1];
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('main IPC renderer trust boundary', () => {
  it('accepts a well-formed request from the current top frame', async () => {
    const renderer = new FakeWebContents();
    const listener = await bindRenderer(renderer);
    const ping = jest.fn(async () => 'pong');
    provideAPI('TrustedRendererTestAPI', { ping });

    listener(rendererEvent(renderer), {
      id: 'renderer:trusted',
      namespace: 'TrustedRendererTestAPI',
      api: 'ping',
      args: [],
    } as IPCMessageRequest);
    await flushPromises();

    expect(ping).toHaveBeenCalledTimes(1);
    expect(renderer.send).toHaveBeenCalledWith('ipc', {
      id: 'renderer:trusted',
      result: 'pong',
    });
  });

  it('drops stale, foreign, missing-sender, and subframe requests', async () => {
    const staleRenderer = new FakeWebContents();
    await bindRenderer(staleRenderer);
    const renderer = new FakeWebContents();
    const listener = await bindRenderer(renderer);
    const foreignRenderer = new FakeWebContents();
    const ping = jest.fn(async () => 'pong');
    provideAPI('UntrustedRendererTestAPI', { ping });
    const worker = new FakeChildProcess();
    const child = asChildProcess(worker);
    registerWorker(child);
    markWorkerReady(child);
    const request: IPCMessageRequest = {
      id: 'renderer:untrusted',
      namespace: 'UntrustedRendererTestAPI',
      api: 'ping',
      args: [],
    };

    listener(rendererEvent(staleRenderer), request);
    listener(rendererEvent(foreignRenderer), request);
    listener({} as Electron.IpcMainEvent, request);
    listener(rendererEvent(renderer, {}), request);
    listener(rendererEvent(renderer, {}), {
      id: 'renderer:untrusted-worker',
      namespace: 'UntrustedWorkerOnlyTestAPI',
      api: 'ping',
      args: [],
    });
    await flushPromises();

    expect(ping).not.toHaveBeenCalled();
    expect(worker.send).not.toHaveBeenCalled();
    expect(renderer.send).not.toHaveBeenCalled();
    expect(staleRenderer.send).not.toHaveBeenCalled();
    expect(foreignRenderer.send).not.toHaveBeenCalled();
    unregisterWorker(child);
  });

  it('rejects identified malformed messages without invoking a handler or worker', async () => {
    const renderer = new FakeWebContents();
    const listener = await bindRenderer(renderer);
    const ping = jest.fn(async () => 'pong');
    provideAPI('MalformedRendererTestAPI', { ping });
    const worker = new FakeChildProcess();
    const child = asChildProcess(worker);
    registerWorker(child);
    markWorkerReady(child);

    listener(rendererEvent(renderer), {
      id: 'renderer:malformed-request',
      namespace: 'MalformedRendererTestAPI',
      api: 'ping',
      args: 'not-an-array',
    });
    listener(rendererEvent(renderer), {
      id: 'renderer:malformed-control',
      control: 'transport-closed',
    });
    listener(rendererEvent(renderer), {
      id: 'renderer:malformed-worker-request',
      namespace: 'MalformedWorkerOnlyTestAPI',
      api: 'ping',
      args: { not: 'an array' },
    });
    await flushPromises();

    expect(ping).not.toHaveBeenCalled();
    expect(worker.send).not.toHaveBeenCalled();
    expect(renderer.send).toHaveBeenCalledTimes(3);
    expect(renderer.send).toHaveBeenCalledWith(
      'ipc',
      expect.objectContaining({
        id: 'renderer:malformed-request',
        error: expect.objectContaining({ name: 'IPCMalformedMessageError' }),
      }),
    );
    expect(renderer.send).toHaveBeenCalledWith(
      'ipc',
      expect.objectContaining({
        id: 'renderer:malformed-worker-request',
        error: expect.objectContaining({ name: 'IPCMalformedMessageError' }),
      }),
    );
    expect(renderer.send).toHaveBeenCalledWith(
      'ipc',
      expect.objectContaining({
        id: 'renderer:malformed-control',
        error: expect.objectContaining({ name: 'IPCMalformedMessageError' }),
      }),
    );
    unregisterWorker(child);
  });

  it('drops unidentified malformed data without throwing', async () => {
    const renderer = new FakeWebContents();
    const listener = await bindRenderer(renderer);

    expect(() => listener(rendererEvent(renderer), null)).not.toThrow();
    expect(() => listener(rendererEvent(renderer), [])).not.toThrow();
    expect(() => listener(rendererEvent(renderer), 'invalid')).not.toThrow();
    await flushPromises();

    expect(renderer.send).not.toHaveBeenCalled();
  });

  it('accepts a well-formed response from the current top frame', async () => {
    const renderer = new FakeWebContents();
    const listener = await bindRenderer(renderer);
    const api = consumeAPI<{ ping(): Promise<string> }>('TrustedResponseAPI');
    const pending = api.ping();
    const request = renderer.send.mock.calls.at(-1)?.[1] as IPCMessage;

    listener(rendererEvent(renderer), { id: request.id, result: 'pong' });

    await expect(pending).resolves.toBe('pong');
  });
});
