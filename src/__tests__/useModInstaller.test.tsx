import type { Mod } from 'bridge/BridgeAPI';
import type { INexusAuthState } from 'renderer/react/context/NexusModsContext';
import useModInstaller from 'renderer/react/context/hooks/useModInstaller';
import { render } from '@testing-library/react';

const mockCheckModForUpdates = jest.fn();
const mockInstallModViaNexus = jest.fn();
const mockRefreshMods = jest.fn();
const mockSetModConfigOverrides = jest.fn();
const mockShowToast = jest.fn();
const mockUpdateModVersion = jest.fn();

jest.mock('renderer/ModUpdaterAPI', () => ({
  __esModule: true,
  default: {
    installModViaNexus: (...args: unknown[]) => mockInstallModViaNexus(...args),
  },
}));

jest.mock('renderer/react/context/ModsContext', () => ({
  useMods: () => [[], mockRefreshMods],
}));

jest.mock('renderer/react/context/hooks/useModConfigOverrides', () => ({
  __esModule: true,
  default: () => [{}, mockSetModConfigOverrides],
}));

jest.mock('renderer/react/context/hooks/useUpdateModVersion', () => ({
  useUpdateModVersion: () => mockUpdateModVersion,
}));

jest.mock('renderer/react/context/utils/useCheckModForUpdates', () => ({
  __esModule: true,
  default: () => mockCheckModForUpdates,
}));

jest.mock('renderer/react/hooks/useToast', () => ({
  __esModule: true,
  default: () => mockShowToast,
}));

const AUTH_STATE: INexusAuthState = { apiKey: 'fake-api-key' };

const INSTALLED_MOD: Mod = {
  id: 'installed-mod',
  info: {
    type: 'd2rmm',
    name: 'Installed Mod',
    version: '1.2.3',
    website: 'https://www.nexusmods.com/diablo2resurrected/mods/123',
  },
  config: {},
};

const INSTALL_ARGS = {
  nexusFileID: 456,
  nexusModID: '123',
};

function renderUseModInstaller(
  authState: INexusAuthState = AUTH_STATE,
): ReturnType<typeof useModInstaller> {
  let installMod: ReturnType<typeof useModInstaller> | undefined;

  function Probe(): null {
    installMod = useModInstaller(authState);
    return null;
  }

  render(<Probe />);
  if (installMod == null) {
    throw new Error('useModInstaller did not initialize.');
  }
  return installMod;
}

describe('useModInstaller post-install metadata boundary', () => {
  beforeEach(() => {
    mockCheckModForUpdates.mockReset();
    mockInstallModViaNexus.mockReset();
    mockRefreshMods.mockReset();
    mockSetModConfigOverrides.mockReset();
    mockShowToast.mockReset();
    mockUpdateModVersion.mockReset();

    mockInstallModViaNexus.mockResolvedValue(INSTALLED_MOD.id);
    mockRefreshMods.mockResolvedValue([INSTALLED_MOD]);
    mockUpdateModVersion.mockResolvedValue(false);
    mockSetModConfigOverrides.mockImplementation((update) => update({}));

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['404 response', new Error('404 Not Found')],
    ['429 response', new Error('429 Too Many Requests')],
    ['invalid JSON', new SyntaxError('Unexpected token in JSON')],
  ])(
    'returns the committed mod ID when update metadata has a %s failure',
    async (_label, metadataError) => {
      mockCheckModForUpdates.mockRejectedValue(metadataError);

      await expect(renderUseModInstaller()(INSTALL_ARGS)).resolves.toBe(
        INSTALLED_MOD.id,
      );

      expect(mockSetModConfigOverrides).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Installed Mod'),
        metadataError,
      );
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'warning' }),
      );
      expect(mockShowToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error' }),
      );
    },
  );

  it('still rejects when the disk install itself fails', async () => {
    const installError = new Error('install failed');
    mockInstallModViaNexus.mockRejectedValue(installError);

    await expect(renderUseModInstaller()(INSTALL_ARGS)).rejects.toBe(
      installError,
    );

    expect(mockRefreshMods).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('still rejects when the committed mod cannot be refreshed', async () => {
    mockRefreshMods.mockResolvedValue([]);

    await expect(renderUseModInstaller()(INSTALL_ARGS)).rejects.toThrow(
      'Failed to install mod',
    );

    expect(mockCheckModForUpdates).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
