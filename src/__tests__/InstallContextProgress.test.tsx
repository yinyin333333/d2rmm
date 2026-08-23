import { EventAPI } from 'renderer/EventAPI';
import {
  InstallContextProvider,
  useInstallationOperation,
  useInstallationProgress,
} from 'renderer/react/context/InstallContext';
import { act, fireEvent, render, screen } from '@testing-library/react';

jest.mock('renderer/EventAPI', () => ({
  EventAPI: {
    addListener: jest.fn((_eventID, listener) => listener),
    removeListener: jest.fn(),
  },
}));

function Probe(): JSX.Element {
  const [progress] = useInstallationProgress();
  const { finishOperation, operation, tryStartOperation } =
    useInstallationOperation();
  return (
    <>
      <button
        onClick={() => {
          const token = tryStartOperation('Installing test', null);
          if (token != null) {
            (window as Window & { operationToken?: number }).operationToken =
              token;
          }
        }}
      >
        start
      </button>
      <button
        onClick={() =>
          finishOperation(
            (window as Window & { operationToken?: number }).operationToken ??
              -1,
          )
        }
      >
        finish
      </button>
      <output>
        {String(progress)}|{operation.active ? operation.label : 'idle'}|
        {operation.progress == null ? 'indeterminate' : 'determinate'}
      </output>
    </>
  );
}

describe('installation progress policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('treats a zero-item no-op as complete and preserves normal ratios', async () => {
    render(
      <InstallContextProvider>
        <Probe />
      </InstallContextProvider>,
    );
    const progressListener = (
      EventAPI.addListener as jest.Mock
    ).mock.calls.find(
      ([eventID]) => eventID === 'installationProgress',
    )?.[1] as (installed: number, total: number) => Promise<void>;

    await act(async () => progressListener(0, 0));
    expect(screen.getByText('100|idle|indeterminate')).toBeTruthy();

    await act(async () => progressListener(2, 4));
    expect(screen.getByText('50|idle|indeterminate')).toBeTruthy();
  });

  it('resets stale progress and exposes an indeterminate finalizing phase', async () => {
    render(
      <InstallContextProvider>
        <Probe />
      </InstallContextProvider>,
    );
    const statusListener = (EventAPI.addListener as jest.Mock).mock.calls.find(
      ([eventID]) => eventID === 'installationStatus',
    )?.[1] as (status: { phase: string }) => Promise<void>;

    fireEvent.click(screen.getByRole('button', { name: 'start' }));
    expect(screen.getByText('0|Installing test|indeterminate')).toBeTruthy();

    await act(async () => statusListener({ phase: 'finalizing' }));
    expect(screen.getByText('0|Finalizing…|indeterminate')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'finish' }));
    expect(screen.getByText('0|idle|indeterminate')).toBeTruthy();
  });
});
