type StartupProcess = 'main' | 'renderer' | 'worker';

const isStartupProfilingEnabled =
  (typeof process !== 'undefined' &&
    process.env.D2RMM_PROFILE_STARTUP === '1') ||
  (typeof window !== 'undefined' && window.env?.profileStartup === true);

const startTime = performance.now();

function getElapsed(): string {
  return (performance.now() - startTime).toFixed(1);
}

export function startupMark(
  processName: StartupProcess,
  message: string,
): void {
  if (!isStartupProfilingEnabled) {
    return;
  }
  console.log(`[startup:${processName}] +${getElapsed()}ms ${message}`);
}

export async function startupMeasure<T>(
  processName: StartupProcess,
  message: string,
  action: () => Promise<T>,
): Promise<T> {
  startupMark(processName, `${message} start`);
  try {
    const result = await action();
    startupMark(processName, `${message} completed`);
    return result;
  } catch (error) {
    startupMark(processName, `${message} failed`);
    throw error;
  }
}
