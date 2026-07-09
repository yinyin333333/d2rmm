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
  readD2RLoaderConfig: jest.fn(),
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
            if (api === 'readD2RLoaderConfig') {
              return mockState.readD2RLoaderConfig(...args);
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
    localStorage.clear();
    mockState.installMods.mockResolvedValue(undefined);
    mockState.readD2RLoaderConfig.mockResolvedValue(null);
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

  it('should render dynamic D2RLoader TOML settings', async () => {
    localStorage.setItem(
      'd2r-loader-settings',
      JSON.stringify({ useD2RLoader: true }),
    );
    mockState.readD2RLoaderConfig.mockResolvedValue({
      fileName: 'd2rloader.toml',
      format: 'toml',
      settings: [
        {
          id: 'd2rcore.items.show_ground_sockets',
          section: 'd2rcore.items',
          key: 'show_ground_sockets',
          value: false,
          valueType: 'boolean',
          description: 'Show socket counts on normal/superior ground items.',
        },
        {
          id: 'd2rloader.default_mod',
          section: 'd2rloader',
          key: 'default_mod',
          value: '',
          valueType: 'string',
          description: 'Automatically pass -mod and -txt with this value.',
        },
      ],
    });

    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(await screen.findByText('d2rcore.items')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Show socket counts on normal/superior ground items.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Default mod')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Show ground sockets'));
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem('d2r-loader-settings') ?? '{}')
          .tomlSettings,
      ).toMatchObject({
        'd2rcore.items.show_ground_sockets': true,
      }),
    );
  });

  it('should show a missing TOML warning instead of old D2RLoader controls', async () => {
    localStorage.setItem(
      'd2r-loader-settings',
      JSON.stringify({ useD2RLoader: true }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(
      await screen.findByText(
        'd2rloader\\config\\d2rloader.toml was not found in the selected game directory.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Skip title screen')).not.toBeInTheDocument();
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

  it('should clear the refresh loading state when refreshing the mod list fails', async () => {
    const error = new Error('Could not refresh mod list');
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    render(<App />);

    const refreshButton = await screen.findByRole('button', {
      name: 'Refresh Mod List',
    });
    mockState.readModDirectory.mockRejectedValueOnce(error);

    fireEvent.click(refreshButton);

    await waitFor(() => expect(consoleError).toHaveBeenCalledWith(error));
    await waitFor(() => expect(refreshButton).not.toBeDisabled());

    consoleError.mockRestore();
  });

  it('should disable game launch while mod installation is running', async () => {
    let resolveInstall: () => void = () => {};
    mockState.installMods.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveInstall = resolve;
        }),
    );
    render(<App />);
    await screen.findByText('No Mods Found');
    const runButton = screen.getByRole('button', { name: 'Run D2R' });
    const installButton = screen.getByRole('button', { name: 'Install Mods' });

    fireEvent.click(installButton);
    await waitFor(() => expect(mockState.installMods).toHaveBeenCalled());
    expect(runButton).toBeDisabled();

    await act(async () => resolveInstall());
    await waitFor(() => expect(runButton).not.toBeDisabled());
  });

  it('should not mark an empty fresh installation as changed', async () => {
    render(<App />);
    await screen.findByText('No Mods Found');

    expect(screen.getByRole('button', { name: 'Run D2R' })).toHaveClass(
      'MuiButton-contained',
    );
  });
});
