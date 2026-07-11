import { EventAPI } from 'renderer/EventAPI';
import {
  InstallContextProvider,
  useInstallationProgress,
} from 'renderer/react/context/InstallContext';
import { act, render, screen } from '@testing-library/react';

jest.mock('renderer/EventAPI', () => ({
  EventAPI: {
    addListener: jest.fn((_eventID, listener) => listener),
    removeListener: jest.fn(),
  },
}));

function Probe(): JSX.Element {
  const [progress] = useInstallationProgress();
  return <output>{String(progress)}</output>;
}

describe('installation progress policy', () => {
  it('treats a zero-item no-op as complete and preserves normal ratios', async () => {
    render(
      <InstallContextProvider>
        <Probe />
      </InstallContextProvider>,
    );
    const listener = (EventAPI.addListener as jest.Mock).mock.calls[0][1] as (
      installed: number,
      total: number,
    ) => Promise<void>;

    await act(async () => listener(0, 0));
    expect(screen.getByText('100')).toBeTruthy();

    await act(async () => listener(2, 4));
    expect(screen.getByText('50')).toBeTruthy();
  });
});
