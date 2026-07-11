import type { ILog } from 'renderer/react/context/LogContext';

export const MAX_RENDERER_LOGS = 10_000;

export function appendBoundedLogs(
  current: ILog[],
  pending: ILog[],
  maxLogs: number = MAX_RENDERER_LOGS,
): ILog[] {
  if (pending.length >= maxLogs) {
    return pending.slice(-maxLogs);
  }
  const overflow = current.length + pending.length - maxLogs;
  return overflow > 0
    ? current.slice(overflow).concat(pending)
    : current.concat(pending);
}
