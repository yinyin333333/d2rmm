import type { ILog } from '../renderer/react/context/LogContext';
import {
  MAX_RENDERER_LOGS,
  appendBoundedLogs,
} from '../renderer/react/context/LogBuffer';

function makeLog(id: number): ILog {
  return { data: [id], id, level: 'debug', timestamp: id };
}

describe('bounded renderer log buffer', () => {
  it('keeps the newest 10k entries across a 50k batched stream', () => {
    let logs: ILog[] = [];
    for (let offset = 0; offset < 50_000; offset += 100) {
      const batch = Array.from({ length: 100 }, (_, index) =>
        makeLog(offset + index),
      );
      logs = appendBoundedLogs(logs, batch);
    }

    expect(MAX_RENDERER_LOGS).toBe(10_000);
    expect(logs).toHaveLength(10_000);
    expect(logs[0].id).toBe(40_000);
    expect(logs[9_999].id).toBe(49_999);
  });

  it('preserves order while trimming only the oldest entries', () => {
    const current = Array.from({ length: 9_995 }, (_, id) => makeLog(id));
    const pending = Array.from({ length: 10 }, (_, index) =>
      makeLog(9_995 + index),
    );

    const logs = appendBoundedLogs(current, pending);

    expect(logs).toHaveLength(10_000);
    expect(logs.map(({ id }) => id).slice(0, 3)).toEqual([5, 6, 7]);
    expect(logs.at(-1)?.id).toBe(10_004);
  });

  it('handles one pending batch larger than the cap', () => {
    const pending = Array.from({ length: 12_000 }, (_, id) => makeLog(id));
    const logs = appendBoundedLogs([makeLog(-1)], pending);

    expect(logs).toHaveLength(10_000);
    expect(logs[0].id).toBe(2_000);
    expect(logs.at(-1)?.id).toBe(11_999);
  });
});
