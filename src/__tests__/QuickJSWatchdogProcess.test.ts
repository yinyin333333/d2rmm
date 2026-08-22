import type { ChildProcess } from 'child_process';
import { fork } from 'child_process';
import path from 'path';
import {
  getQuickJSProxyAPI,
  installQuickJSExecutionWatchdog,
} from '../main/worker/quickjs';

type WatchdogChildResult =
  | { elapsedMs: number; status: 'interrupted' }
  | { error: string; status: 'failed' };

const CHILD_SAFETY_TIMEOUT_MS = 5_000;

function runWatchdogChild(): Promise<WatchdogChildResult> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = fork(
      path.join(__dirname, '..', 'testFixtures', 'QuickJSWatchdog.child.ts'),
      [],
      {
        execArgv: ['-r', require.resolve('ts-node/register/transpile-only')],
        silent: true,
      },
    );
    let stderr = '';
    let result: WatchdogChildResult | undefined;
    const killTimer = setTimeout(() => {
      child.kill();
      reject(new Error('QuickJS watchdog child exceeded its safety timeout'));
    }, CHILD_SAFETY_TIMEOUT_MS);

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('message', (message: WatchdogChildResult) => {
      result = message;
    });
    child.once('error', (error) => {
      clearTimeout(killTimer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(killTimer);
      if (code !== 0 || result == null) {
        reject(
          new Error(
            `QuickJS watchdog child exited with code ${code}: ${stderr}`,
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}

describe('QuickJS production execution watchdog', () => {
  jest.setTimeout(CHILD_SAFETY_TIMEOUT_MS * 2);

  it('interrupts a real QuickJS infinite loop in a child process', async () => {
    const result = await runWatchdogChild();

    expect(result).toMatchObject({ status: 'interrupted' });
    if (result.status === 'interrupted') {
      expect(result.elapsedMs).toBeLessThan(CHILD_SAFETY_TIMEOUT_MS);
    }
  });

  it('interrupts execution with an injected clock and no wall-clock wait', () => {
    let interruptHandler: (() => boolean) | undefined;
    const runtime = {
      removeInterruptHandler: jest.fn(),
      setInterruptHandler: jest.fn((handler: () => boolean) => {
        interruptHandler = handler;
      }),
    };
    let now = 0;
    const watchdog = installQuickJSExecutionWatchdog(runtime as never, {
      budgetMs: 10,
      now: () => now,
    });

    expect(interruptHandler?.()).toBe(false);
    now = 10;
    expect(interruptHandler?.()).toBe(true);
    watchdog.dispose();
  });

  it('refreshes the continuous-execution deadline after a host call', () => {
    let interruptHandler: (() => boolean) | undefined;
    const runtime = {
      removeInterruptHandler: jest.fn(),
      setInterruptHandler: jest.fn((handler: () => boolean) => {
        interruptHandler = handler;
      }),
    };
    let now = 100;
    const watchdog = installQuickJSExecutionWatchdog(runtime as never, {
      budgetMs: 30,
      now: () => now,
    });

    expect(interruptHandler?.()).toBe(false);
    now = 131;
    expect(interruptHandler?.()).toBe(true);
    watchdog.refresh();
    expect(interruptHandler?.()).toBe(false);
    now = 161;
    expect(interruptHandler?.()).toBe(true);

    watchdog.dispose();
    watchdog.dispose();
    expect(runtime.removeInterruptHandler).toHaveBeenCalledTimes(1);
  });

  it('refreshes after an async proxy host call settles', async () => {
    let hostFunction: ((...args: unknown[]) => Promise<unknown>) | undefined;
    const vm = {
      dump: jest.fn(),
      newAsyncifiedFunction: jest.fn(
        (_name: string, callback: (...args: unknown[]) => Promise<unknown>) => {
          hostFunction = callback;
          return {};
        },
      ),
      newObject: jest.fn(() => ({})),
      setProp: jest.fn(),
      undefined: {},
    };
    const scope = { manage: jest.fn((value: unknown) => value) };
    const watchdog = { refresh: jest.fn() };

    getQuickJSProxyAPI(
      vm as never,
      scope as never,
      { waitForHost: async () => undefined } as never,
      watchdog,
    );
    await hostFunction?.();

    expect(watchdog.refresh).toHaveBeenCalledTimes(1);
  });
});
