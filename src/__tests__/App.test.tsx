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
  importPluginSources: jest.fn(),
  installD2RLoader: jest.fn(),
  installMods: jest.fn(),
  installModFromZip: jest.fn(),
  openExternal: jest.fn(),
  readD2RLoaderConfig: jest.fn(),
  readModConfig: jest.fn(),
  readModDirectory: jest.fn(),
  readModInfo: jest.fn(),
  readPluginInventory: jest.fn(),
  selectDirectory: jest.fn(),
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
            if (api === 'installD2RLoader') {
              return mockState.installD2RLoader(...args);
            }
            if (api === 'installModFromZip') {
              return mockState.installModFromZip(...args);
            }
            if (api === 'importSources') {
              return mockState.importPluginSources(...args);
            }
            if (api === 'openExternal') {
              return mockState.openExternal(...args);
            }
            if (api === 'readModDirectory') {
              return mockState.readModDirectory(...args);
            }
            if (api === 'readModInfo') {
              return mockState.readModInfo(...args);
            }
            if (api === 'readModConfig') {
              return mockState.readModConfig(...args);
            }
            if (api === 'readD2RLoaderConfig') {
              return mockState.readD2RLoaderConfig(...args);
            }
            if (api === 'selectDirectory') {
              return mockState.selectDirectory(...args);
            }
            if (api === 'readInventory') {
              return mockState.readPluginInventory(...args);
            }
            return [];
          },
      },
    ),
}));

jest.mock('renderer/ElectronUtilsAPI', () => ({
  __esModule: true,
  default: {
    getPathForFile: (file: File) => `C:\\Dropped\\${file.name}`,
  },
}));

jest.mock('renderer/AppInfoAPI', () => ({
  getAppPath: () => 'C:\\D2RMM',
  getBaseSavesPath: () => 'C:\\Users\\test\\Saved Games\\Diablo II Resurrected',
}));

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockState.installD2RLoader.mockResolvedValue({
      status: 'installed',
      version: '1.0.1.0',
    });
    mockState.installMods.mockResolvedValue(undefined);
    mockState.installModFromZip.mockResolvedValue(undefined);
    mockState.importPluginSources.mockResolvedValue({
      importedFiles: 1,
      packages: ['Example'],
      warnings: [],
    });
    mockState.openExternal.mockResolvedValue(undefined);
    mockState.readD2RLoaderConfig.mockResolvedValue(null);
    mockState.selectDirectory.mockResolvedValue(null);
    mockState.readModConfig.mockResolvedValue({});
    mockState.readModDirectory.mockResolvedValue([]);
    mockState.readModInfo.mockResolvedValue({
      name: 'Example Mod',
      type: 'd2rmm',
    });
    mockState.readPluginInventory.mockResolvedValue({
      configs: [],
      conflicts: [],
      managedSignature: '',
      managedRoot: 'C:\\D2RMM\\d2rloader',
      packages: [],
      patches: [],
      plugins: [],
    });
  });

  it('should render', () => {
    expect(render(<App />)).toBeTruthy();
  });

  it('should open lazy settings and logs tabs', async () => {
    localStorage.setItem('direct-mod', 'true');
    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect((await screen.findAllByText('D2RLoader')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Direct Mode')).not.toBeInTheDocument();
    expect(
      screen.queryByText('settings.directMode.title'),
    ).not.toBeInTheDocument();

    const logsTab = screen.getByRole('tab', { name: 'Logs' });
    fireEvent.click(logsTab);
    expect(logsTab).toHaveAttribute('aria-selected', 'true');
  });

  it('should browse for directories from settings', async () => {
    mockState.selectDirectory.mockResolvedValue(
      'D:\\Games\\Diablo II Resurrected',
    );
    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Browse: Game Directory',
      }),
    );

    await waitFor(() =>
      expect(mockState.selectDirectory).toHaveBeenCalledWith(
        'C:\\Diablo II Resurrected',
      ),
    );
    expect(screen.getByLabelText('Game Directory')).toHaveValue(
      'D:\\Games\\Diablo II Resurrected',
    );
  });

  it('should compare Windows save paths by directory boundary and casing', async () => {
    localStorage.setItem(
      'saves-path',
      'c:\\users\\TEST\\saved games\\diablo ii resurrected\\mods\\D2RMM',
    );
    const firstView = render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    await screen.findByLabelText('Save Data Path');
    expect(
      screen.queryByText(/Your save path is not within/i),
    ).not.toBeInTheDocument();

    firstView.unmount();
    localStorage.setItem(
      'saves-path',
      'C:\\Users\\test\\Saved Games\\Diablo II Resurrected2',
    );
    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(
      await screen.findByText(/Your save path is not within/i),
    ).toBeInTheDocument();
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

  it.each(['resolve', 'reject'] as const)(
    'shows exclusive drop-install feedback and restores actions after %s',
    async (outcome) => {
      let settleInstall: () => void = () => {};
      mockState.installModFromZip.mockImplementationOnce(
        () =>
          new Promise<void>((resolve, reject) => {
            settleInstall = () =>
              outcome === 'resolve'
                ? resolve()
                : reject(new Error('broken archive'));
          }),
      );
      render(<App />);
      const runButton = screen.getByRole('button', { name: 'Run D2R' });
      const installButton = screen.getByRole('button', {
        name: 'Install Mods',
      });
      await waitFor(() => expect(installButton).not.toBeDisabled());
      const zip = new File(['large zip'], 'Large.zip', {
        type: 'application/zip',
      });
      const drop = () =>
        fireEvent.drop(screen.getByRole('tab', { name: 'Mods' }), {
          dataTransfer: {
            files: [zip],
            items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
          },
        });

      drop();
      if (outcome === 'resolve') drop();

      expect(mockState.installModFromZip).toHaveBeenCalledTimes(1);
      const progressLabel = screen.getByText('Installing Large.zip (1/1)');
      expect(progressLabel).toBeInTheDocument();
      expect(progressLabel).toHaveAttribute(
        'title',
        'Installing Large.zip (1/1)',
      );
      expect(progressLabel).toHaveStyle({ maxWidth: '240px' });
      expect(installButton).toBeDisabled();
      expect(runButton).toBeDisabled();

      await act(async () => settleInstall());

      await waitFor(() =>
        expect(
          screen.queryByText('Installing Large.zip (1/1)'),
        ).not.toBeInTheDocument(),
      );
      expect(installButton).not.toBeDisabled();
      expect(runButton).not.toBeDisabled();
      if (outcome === 'reject') {
        expect(
          await screen.findByText('Failed to install Large'),
        ).toBeInTheDocument();
      }
    },
  );

  it('renders direct mod actions in the requested order', async () => {
    render(<App />);

    const actions = [
      screen.getByRole('button', { name: 'Add Section' }),
      screen.getByRole('button', { name: 'Refresh List' }),
      screen.getByRole('button', { name: 'Install Mods' }),
      screen.getByRole('button', { name: 'Run D2R' }),
    ];

    for (let index = 0; index < actions.length - 1; index += 1) {
      expect(
        actions[index].compareDocumentPosition(actions[index + 1]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(actions[0]).toHaveClass('MuiButton-outlined');
    expect(actions[1]).toHaveClass('MuiButton-outlined');
    expect(actions[0]).toHaveClass('MuiButton-sizeMedium');
    expect(actions[1]).toHaveClass('MuiButton-sizeMedium');
    expect(document.querySelector('.MuiButtonGroup-root')).toBeNull();
    expect(document.getElementById('overflow-actions-button')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Check for Mod Updates' }),
    ).not.toBeInTheDocument();

    fireEvent.click(actions[0]);
    expect(await screen.findByText('New Section Header')).toBeInTheDocument();
  });

  it('lazy-mounts Plugins on first visit and keeps it mounted across tab changes', async () => {
    render(<App />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Mods',
      'Plugins',
      'Settings',
      'Logs',
    ]);
    const pluginTab = screen.getByRole('tab', { name: 'Plugins' });
    const pluginPanel = document.getElementById(
      pluginTab.getAttribute('aria-controls')!,
    );
    expect(pluginPanel).not.toBeNull();
    expect(pluginPanel).toHaveAttribute('hidden');
    expect(screen.queryByText('D2RLoader Plugins')).not.toBeInTheDocument();

    fireEvent.click(pluginTab);

    expect(pluginPanel).not.toHaveAttribute('hidden');
    expect(await screen.findByText('D2RLoader Plugins')).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /^Plugins . 0$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /^Patches . 0$/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Mods' }));
    expect(pluginPanel).toHaveAttribute('hidden');
    expect(screen.getByText('D2RLoader Plugins')).toBeInTheDocument();
  });

  it('routes ZIP drops on Plugins only to the plugin importer', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Plugins' }));
    const pluginHeading = await screen.findByText('D2RLoader Plugins');
    const zip = new File(['zip'], 'Example.zip', {
      type: 'application/zip',
    });

    fireEvent.drop(pluginHeading, {
      dataTransfer: {
        files: [zip],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
      },
    });

    await waitFor(() =>
      expect(mockState.importPluginSources).toHaveBeenCalledWith([
        'C:\\Dropped\\Example.zip',
      ]),
    );
    expect(mockState.installModFromZip).not.toHaveBeenCalled();
  });

  it('preserves loose companion files dropped with a plugin DLL', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Plugins' }));
    const pluginHeading = await screen.findByText('D2RLoader Plugins');
    const dll = new File(['dll'], 'Example.dll');
    const ini = new File(['config'], 'Example.ini');

    fireEvent.drop(pluginHeading, {
      dataTransfer: {
        files: [dll, ini],
        items: [
          { webkitGetAsEntry: () => ({ isDirectory: false }) },
          { webkitGetAsEntry: () => ({ isDirectory: false }) },
        ],
      },
    });

    await waitFor(() =>
      expect(mockState.importPluginSources).toHaveBeenCalledWith([
        'C:\\Dropped\\Example.dll',
        'C:\\Dropped\\Example.ini',
      ]),
    );
  });

  it('rescans plugin origins after Refresh List removes a mod', async () => {
    mockState.readModDirectory.mockResolvedValueOnce(['With Loader']);
    render(<App />);

    await waitFor(() =>
      expect(mockState.readPluginInventory).toHaveBeenCalledWith([
        'With Loader',
      ]),
    );
    mockState.readModDirectory.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh List' }));

    await waitFor(() =>
      expect(mockState.readPluginInventory).toHaveBeenLastCalledWith([]),
    );
  });

  it('rescans loader files when Refresh List keeps the same mod IDs', async () => {
    mockState.readModDirectory.mockResolvedValue(['With Loader']);
    render(<App />);

    await waitFor(() =>
      expect(mockState.readPluginInventory).toHaveBeenCalledWith([
        'With Loader',
      ]),
    );
    const previousScanCount = mockState.readPluginInventory.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh List' }));

    await waitFor(() =>
      expect(mockState.readPluginInventory.mock.calls.length).toBeGreaterThan(
        previousScanCount,
      ),
    );
    expect(mockState.readPluginInventory).toHaveBeenLastCalledWith([
      'With Loader',
    ]);
  });

  it('should open the Discord invite from the button next to Logs', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Discord' }));

    expect(mockState.openExternal).toHaveBeenCalledWith(
      'https://discord.gg/eEHT2kcBMf',
    );
  });

  it('should install and enable D2RLoader from the top download button', async () => {
    render(<App />);

    const downloadButton = screen.getByRole('button', {
      name: 'Download D2RLoader',
    });
    fireEvent.mouseOver(downloadButton);
    expect(
      await screen.findByText(
        'Existing plugins may be incompatible after a D2RLoader update. Please contact their authors.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(downloadButton);

    await waitFor(() =>
      expect(mockState.installD2RLoader).toHaveBeenCalledWith(
        'C:\\Diablo II Resurrected',
      ),
    );
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem('d2r-loader-settings') ?? '{}'),
      ).toMatchObject({ useD2RLoader: true }),
    );
    expect(await screen.findByText('D2RLoader installed')).toBeInTheDocument();
  });

  it.each(['resolve', 'reject'] as const)(
    'holds the shared operation lock while D2RLoader installation is pending, then restores actions after %s',
    async (outcome) => {
      let settleInstall: () => void = () => {};
      mockState.installD2RLoader.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            settleInstall = () =>
              outcome === 'resolve'
                ? resolve({ status: 'installed', version: '1.0.1.0' })
                : reject(new Error('Download failed.'));
          }),
      );
      render(<App />);
      const installButton = screen.getByRole('button', {
        name: 'Install Mods',
      });
      await waitFor(() => expect(installButton).not.toBeDisabled());

      fireEvent.click(
        screen.getByRole('button', { name: 'Download D2RLoader' }),
      );

      expect(mockState.installD2RLoader).toHaveBeenCalledTimes(1);
      const runButton = screen.getByRole('button', { name: 'Run D2R' });
      expect(screen.getByText('Installing D2RLoader…')).toBeInTheDocument();
      expect(installButton).toBeDisabled();
      expect(runButton).toBeDisabled();

      await act(async () => settleInstall());

      await waitFor(() => expect(installButton).not.toBeDisabled());
      expect(runButton).not.toBeDisabled();
      expect(
        screen.queryByText('Installing D2RLoader…'),
      ).not.toBeInTheDocument();
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'holds the shared operation lock while a plugin import is pending, then restores actions after %s',
    async (outcome) => {
      let settleImport: () => void = () => {};
      mockState.importPluginSources.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            settleImport = () =>
              outcome === 'resolve'
                ? resolve({
                    importedFiles: 1,
                    packages: ['Example'],
                    warnings: [],
                  })
                : reject(new Error('Import failed.'));
          }),
      );
      render(<App />);
      const installButton = screen.getByRole('button', {
        name: 'Install Mods',
      });
      await waitFor(() => expect(installButton).not.toBeDisabled());
      fireEvent.click(screen.getByRole('tab', { name: 'Plugins' }));
      const pluginHeading = await screen.findByText('D2RLoader Plugins');

      fireEvent.drop(pluginHeading, {
        dataTransfer: {
          files: [new File(['zip'], 'Example.zip')],
          items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
        },
      });

      expect(mockState.importPluginSources).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText('Importing D2RLoader packages…'),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('tab', { name: 'Mods' }));
      const activeInstallButton = screen.getByRole('button', {
        name: 'Install Mods',
      });
      const activeRunButton = screen.getByRole('button', { name: 'Run D2R' });
      expect(activeInstallButton).toBeDisabled();
      expect(activeRunButton).toBeDisabled();

      await act(async () => settleImport());

      await waitFor(() => expect(activeInstallButton).not.toBeDisabled());
      expect(activeRunButton).not.toBeDisabled();
      expect(
        screen.queryByText('Importing D2RLoader packages…'),
      ).not.toBeInTheDocument();
    },
  );

  it('blocks loader actions in the opposite direction while another operation owns the lock', async () => {
    let resolveDropInstall: () => void = () => {};
    mockState.installModFromZip.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDropInstall = resolve;
        }),
    );
    render(<App />);
    const installButton = screen.getByRole('button', { name: 'Install Mods' });
    await waitFor(() => expect(installButton).not.toBeDisabled());
    fireEvent.drop(screen.getByRole('tab', { name: 'Mods' }), {
      dataTransfer: {
        files: [new File(['zip'], 'Pending.zip')],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
      },
    });

    const downloadButton = screen.getByRole('button', {
      name: 'Download D2RLoader',
    });
    expect(downloadButton).toBeDisabled();
    fireEvent.click(downloadButton);
    expect(mockState.installD2RLoader).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Plugins' }));
    const pluginHeading = await screen.findByText('D2RLoader Plugins');
    fireEvent.drop(pluginHeading, {
      dataTransfer: {
        files: [new File(['zip'], 'Plugin.zip')],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
      },
    });
    expect(mockState.importPluginSources).not.toHaveBeenCalled();
    expect(
      await screen.findByText('Another install or import is in progress.'),
    ).toBeInTheDocument();

    await act(async () => resolveDropInstall());
    await waitFor(() => expect(downloadButton).not.toBeDisabled());
  });

  it('should leave D2RLoader disabled when installation fails', async () => {
    mockState.installD2RLoader.mockRejectedValueOnce(
      new Error('Download failed.'),
    );
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Download D2RLoader' }));

    expect(
      await screen.findByText('Failed to install D2RLoader'),
    ).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem('d2r-loader-settings') ?? '{}'),
    ).not.toMatchObject({ useD2RLoader: true });
  });

  it('should report an already-current D2RLoader and still enable it', async () => {
    mockState.installD2RLoader.mockResolvedValueOnce({
      status: 'already-current',
      version: '1.0.1.0',
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Download D2RLoader' }));

    expect(
      await screen.findByText('D2RLoader is already up to date'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Installed version: 1.0.1.0'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem('d2r-loader-settings') ?? '{}'),
      ).toMatchObject({ useD2RLoader: true }),
    );
  });
});
