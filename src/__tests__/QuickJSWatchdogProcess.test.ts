import { ChildProcess, spawn } from 'child_process';

const CHILD_SOURCE = String.raw`
const { getQuickJS } = require('quickjs-emscripten');

getQuickJS().then((QuickJS) => {
  if (process.send) process.send({ type: 'ready' });
  process.on('message', ({ mode }) => {
    const context = QuickJS.newContext();
    let checks = 0;
    if (mode === 'bounded') {
      context.runtime.setInterruptHandler(() => ++checks > 100);
    }
    const result = context.evalCode('while (true) {}');
    let message = '';
    if (result.error) {
      const dumped = context.dump(result.error);
      message = dumped && dumped.message
        ? String(dumped.message)
        : JSON.stringify(dumped);
      result.error.dispose();
    } else {
      result.value.dispose();
    }
    context.dispose();
    if (process.send) process.send({ type: 'done', checks, message });
  });
});
`;

type ChildResult = {
  checks: number;
  elapsedMs: number;
  message: string;
  outcome: 'completed' | 'watchdog-killed';
};

function stopChild(child: ChildProcess): void {
  if (child.exitCode == null && child.signalCode == null) {
    child.kill();
  }
}

function runChild(
  mode: 'bounded' | 'unbounded',
  watchdogMs: number,
): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, ['-e', CHILD_SOURCE], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let ready = false;
    let settled = false;
    let stderr = '';
    const readyTimeout = setTimeout(() => {
      finish(new Error(`QuickJS child was not ready: ${stderr}`));
    }, 10000);
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const finish = (error: Error | null, result?: ChildResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimeout);
      if (watchdog != null) clearTimeout(watchdog);
      stopChild(child);
      if (error != null) reject(error);
      else resolve(result!);
    };

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => finish(error));
    child.on('exit', (code, signal) => {
      if (!settled && (!ready || signal == null)) {
        finish(
          new Error(
            `QuickJS child exited unexpectedly (code ${code}, signal ${signal}): ${stderr}`,
          ),
        );
      }
    });
    child.on('message', (message: unknown) => {
      const value = message as {
        checks?: number;
        message?: string;
        type?: string;
      };
      if (value.type === 'ready') {
        ready = true;
        child.send({ mode });
        watchdog = setTimeout(() => {
          finish(null, {
            checks: 0,
            elapsedMs: Date.now() - startedAt,
            message: '',
            outcome: 'watchdog-killed',
          });
        }, watchdogMs);
      } else if (value.type === 'done') {
        finish(null, {
          checks: value.checks ?? 0,
          elapsedMs: Date.now() - startedAt,
          message: value.message ?? '',
          outcome: 'completed',
        });
      }
    });
  });
}

describe('QuickJS disposable-process watchdog evidence', () => {
  jest.setTimeout(15000);

  it('shows that current unbounded evaluation must be killed externally', async () => {
    const result = await runChild('unbounded', 400);

    expect(result.outcome).toBe('watchdog-killed');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(350);
    expect(result.elapsedMs).toBeLessThan(10000);
  });

  it('shows that the supported interrupt handler stops the same loop deterministically', async () => {
    const result = await runChild('bounded', 5000);

    expect(result.outcome).toBe('completed');
    expect(result.checks).toBe(101);
    expect(result.message).toMatch(/interrupted/i);
    expect(result.elapsedMs).toBeLessThan(5000);
  });
});
