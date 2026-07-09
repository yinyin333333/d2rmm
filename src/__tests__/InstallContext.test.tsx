import {
  InstallContextProvider,
  useInstallationProgress,
} from 'renderer/react/context/InstallContext';
import { act, render, screen } from '@testing-library/react';

let progressListener:
  | ((installedModsCount: number, totalModsCount: number) => Promise<void>)
  | null = null;

jest.mock('renderer/EventAPI', () => ({
  EventAPI: {
    addListener: (
      _eventID: string,
      listener: (
        installedModsCount: number,
        totalModsCount: number,
      ) => Promise<void>,
    ) => {
      progressListener = listener;
      return listener;
    },
    removeListener: jest.fn(),
  },
}));

function Probe(): JSX.Element {
  const [progress] = useInstallationProgress();
  return <span>{String(progress)}</span>;
}

describe('InstallContext', () => {
  beforeEach(() => {
    progressListener = null;
  });

  it('reports completed progress when there are no mods to install', async () => {
    render(
      <InstallContextProvider>
        <Probe />
      </InstallContextProvider>,
    );

    await act(async () => progressListener?.(0, 0));

    expect(screen.queryByText('100')).not.toBeNull();
    expect(screen.queryByText('NaN')).toBeNull();
  });
});
