import '@testing-library/jest-dom';
import App from '../renderer/react/App';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

const mockState = {
  installMods: jest.fn(),
  readModDirectory: jest.fn(),
};

jest.mock('renderer/IPC', () => ({
  consumeAPI: () =>
    new Proxy(
      {},
      {
        get:
          (_target, api) =>
          async (...args: unknown[]) => {
            if (api === 'getGamePath') {
              return 'C:\\Diablo II Resurrected';
            }
            if (api === 'getIsRegistered') {
              return true;
            }
            if (api === 'installMods') {
              return mockState.installMods(...args);
            }
            if (api === 'readModDirectory') {
              return mockState.readModDirectory(...args);
            }
            return [];
          },
      },
    ),
}));

jest.mock('renderer/AppInfoAPI', () => ({
  getAppPath: () => 'C:\\D2RMM',
  getBaseSavesPath: () => 'C:\\Users\\test\\Saved Games\\Diablo II Resurrected',
}));

describe('App', () => {
  beforeEach(() => {
    mockState.installMods.mockResolvedValue(undefined);
    mockState.readModDirectory.mockResolvedValue([]);
  });

  it('should render', () => {
    expect(render(<App />)).toBeTruthy();
  });

  it('should open lazy settings and logs tabs', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(await screen.findByText('D2RLoader')).toBeInTheDocument();

    const logsTab = screen.getByRole('tab', { name: 'Logs' });
    fireEvent.click(logsTab);
    expect(logsTab).toHaveAttribute('aria-selected', 'true');
  });

  it('should disable install and run while the initial mod list is loading', async () => {
    let resolveReadModDirectory: (value: string[]) => void = () => {};
    mockState.readModDirectory.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveReadModDirectory = resolve;
        }),
    );

    render(<App />);

    const runButton = screen.getByRole('button', { name: 'Run D2R' });
    const installButton = screen.getByRole('button', { name: 'Install Mods' });

    expect(runButton).toBeDisabled();
    expect(installButton).toBeDisabled();

    fireEvent.click(installButton);
    expect(mockState.installMods).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(mockState.readModDirectory).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      resolveReadModDirectory([]);
    });

    await waitFor(() => expect(runButton).not.toBeDisabled());
    expect(installButton).not.toBeDisabled();
  });
});
