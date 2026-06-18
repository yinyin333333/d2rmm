export type DeferredTaskCancel = () => void;

export default function deferUntilAfterFirstPaint(
  callback: () => void,
): DeferredTaskCancel {
  let isCancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let frameId: number | null = null;
  let idleId: number | null = null;

  const run = (): void => {
    if (!isCancelled) {
      callback();
    }
  };

  const scheduleIdle = (): void => {
    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(run, { timeout: 1000 });
    } else {
      timeoutId = setTimeout(run, 0);
    }
  };

  if ('requestAnimationFrame' in window) {
    frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(scheduleIdle);
    });
  } else {
    timeoutId = setTimeout(scheduleIdle, 0);
  }

  return () => {
    isCancelled = true;
    if (frameId != null) {
      window.cancelAnimationFrame(frameId);
    }
    if (idleId != null && 'cancelIdleCallback' in window) {
      window.cancelIdleCallback(idleId);
    }
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
  };
}
