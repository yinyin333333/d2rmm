import {
  ILogger,
  LogsProvider,
  useLogger,
  useLogs,
} from 'renderer/react/context/LogContext';
import { act, render } from '@testing-library/react';

jest.mock('renderer/react/hooks/useConsoleListener', () => ({
  __esModule: true,
  default: jest.fn(),
}));

let currentLogger: ILogger | undefined;
let currentLogCount = 0;
let firstLogID: number | undefined;
let lastLogID: number | undefined;

function Probe(): null {
  currentLogger = useLogger();
  const logs = useLogs();
  currentLogCount = logs.length;
  firstLogID = logs[0]?.id;
  lastLogID = logs.at(-1)?.id;
  return null;
}

describe('LogsProvider batching lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    currentLogger = undefined;
    currentLogCount = 0;
    firstLogID = undefined;
    lastLogID = undefined;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('uses one scheduled flush and retains only the latest 10k logs', () => {
    render(
      <LogsProvider>
        <Probe />
      </LogsProvider>,
    );

    act(() => {
      for (let id = 0; id < 50_000; id += 1) {
        currentLogger?.debug(id);
      }
    });
    expect(jest.getTimerCount()).toBe(1);

    act(() => jest.runOnlyPendingTimers());
    expect(currentLogCount).toBe(10_000);
    expect((lastLogID ?? 0) - (firstLogID ?? 0)).toBe(9_999);
  });

  it('clear cancels pending logs before they reach state', () => {
    render(
      <LogsProvider>
        <Probe />
      </LogsProvider>,
    );

    act(() => {
      currentLogger?.log('pending');
      currentLogger?.clear();
    });

    expect(jest.getTimerCount()).toBe(0);
    act(() => jest.runOnlyPendingTimers());
    expect(currentLogCount).toBe(0);
  });

  it('cancels the pending flush on unmount', () => {
    const view = render(
      <LogsProvider>
        <Probe />
      </LogsProvider>,
    );
    act(() => currentLogger?.warn('pending'));
    expect(jest.getTimerCount()).toBe(1);

    view.unmount();

    expect(jest.getTimerCount()).toBe(0);
  });
});
