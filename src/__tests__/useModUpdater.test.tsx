import type { Mod } from 'bridge/BridgeAPI';
import type { ModUpdaterDownload } from 'bridge/ModUpdaterAPI';
import type { IUpdateState } from 'renderer/react/context/UpdatesContext';
import useModUpdater from 'renderer/react/modlist/hooks/useModUpdater';
import { render } from '@testing-library/react';

type SourceAwareUpdateState = IUpdateState & {
  checkedVersion: string | null;
  sourceNexusModID: string | null;
};

const mockCheckModForUpdates = jest.fn();
const mockInstallMod = jest.fn();
const mockSetModUpdate = jest.fn();
let mockUpdateState: SourceAwareUpdateState;

jest.mock('renderer/react/context/hooks/useModInstaller', () => ({
  __esModule: true,
  default: () => mockInstallMod,
}));

jest.mock('renderer/react/context/hooks/useModUpdate', () => ({
  __esModule: true,
  default: () => [mockUpdateState, mockSetModUpdate],
}));

jest.mock('renderer/react/context/hooks/useNexusAuthState', () => ({
  __esModule: true,
  default: () => ({
    nexusAuthState: { apiKey: 'fake-api-key', isPremium: true },
  }),
}));

jest.mock(
  'renderer/react/context/utils/useCheckModForUpdates',
  () => ({
    __esModule: true,
    default: () => mockCheckModForUpdates,
  }),
);

jest.mock('renderer/react/hooks/useAsyncCallback', () => ({
  __esModule: true,
  default: (callback: (...args: unknown[]) => unknown) => callback,
}));

const DOWNLOAD_A: ModUpdaterDownload = {
  type: 'nexus',
  modID: '100',
  fileID: 1001,
  version: '2.0.0',
};

function makeMod(nexusModID: string, version = '1.0.0'): Mod {
  return {
    id: 'local-mod',
    info: {
      type: 'd2rmm',
      name: 'Local Mod',
      version,
      website: `https://www.nexusmods.com/diablo2resurrected/mods/${nexusModID}`,
    },
    config: {},
  };
}

function makeUpdateState(
  sourceNexusModID: string,
  checkedVersion = '1.0.0',
): SourceAwareUpdateState {
  return {
    checkedVersion,
    sourceNexusModID,
    isUpdateChecked: true,
    isUpdateAvailable: true,
    nexusUpdates: [DOWNLOAD_A],
    nexusDownloads: [DOWNLOAD_A],
  };
}

function renderUseModUpdater(mod: Mod): ReturnType<typeof useModUpdater> {
  let result: ReturnType<typeof useModUpdater> | undefined;

  function Probe(): null {
    result = useModUpdater(mod);
    return null;
  }

  render(<Probe />);
  if (result == null) {
    throw new Error('useModUpdater did not initialize.');
  }
  return result;
}

describe('useModUpdater cache source identity', () => {
  beforeEach(() => {
    mockCheckModForUpdates.mockReset();
    mockInstallMod.mockReset();
    mockSetModUpdate.mockReset();
    mockUpdateState = makeUpdateState('100');
  });

  it('does not expose or install source A downloads after the mod changes to B', async () => {
    const updater = renderUseModUpdater(makeMod('200'));

    expect(updater.isUpdateChecked).toBe(false);
    expect(updater.isUpdateAvailable).toBe(false);
    expect(updater.latestUpdate).toBeNull();
    expect(updater.downloads).toEqual([]);

    await updater.onDownloadVersion(DOWNLOAD_A);
    expect(mockInstallMod).not.toHaveBeenCalled();
  });

  it('does not expose cache checked against an older local version', async () => {
    const updater = renderUseModUpdater(makeMod('100', '1.5.0'));

    expect(updater.isUpdateChecked).toBe(false);
    expect(updater.downloads).toEqual([]);

    await updater.onDownloadVersion(DOWNLOAD_A);
    expect(mockInstallMod).not.toHaveBeenCalled();
  });

  it('preserves and installs a cache entry for the same source and version', async () => {
    const updater = renderUseModUpdater(makeMod('100'));

    expect(updater.isUpdateChecked).toBe(true);
    expect(updater.latestUpdate).toEqual(DOWNLOAD_A);
    expect(updater.downloads).toEqual([DOWNLOAD_A]);

    await updater.onDownloadVersion(DOWNLOAD_A);
    expect(mockInstallMod).toHaveBeenCalledWith({
      modID: 'local-mod',
      nexusModID: '100',
      nexusFileID: DOWNLOAD_A.fileID,
      version: DOWNLOAD_A.version,
    });
  });
});
