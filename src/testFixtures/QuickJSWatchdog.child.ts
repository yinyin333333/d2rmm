import releaseAsyncVariant from '@jitl/quickjs-wasmfile-release-asyncify';
import { newQuickJSAsyncWASMModuleFromVariant } from 'quickjs-emscripten-core';
import { installQuickJSExecutionWatchdog } from '../main/worker/quickjs';

type WatchdogChildResult =
  | { elapsedMs: number; status: 'interrupted' }
  | { error: string; status: 'failed' };

function finish(result: WatchdogChildResult, exitCode: number): void {
  process.exitCode = exitCode;
  if (process.send == null) {
    return;
  }
  process.send(result, (error: Error | null) => {
    if (error != null) process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
}

void (async () => {
  const quickJS =
    await newQuickJSAsyncWASMModuleFromVariant(releaseAsyncVariant);
  const vm = quickJS.newContext();
  const watchdog = installQuickJSExecutionWatchdog(vm.runtime, {
    budgetMs: 50,
  });
  const startedAt = Date.now();

  try {
    const result = await vm.evalCodeAsync('while (true) {}');
    try {
      vm.unwrapResult(result).dispose();
      finish(
        {
          error: 'Infinite loop completed without interruption',
          status: 'failed',
        },
        1,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/interrupt/i.test(message)) {
        finish({ error: message, status: 'failed' }, 1);
        return;
      }
      finish({ elapsedMs: Date.now() - startedAt, status: 'interrupted' }, 0);
    }
  } catch (error) {
    finish(
      {
        error: error instanceof Error ? error.message : String(error),
        status: 'failed',
      },
      1,
    );
  } finally {
    watchdog.dispose();
    vm.dispose();
  }
})();
