import type { CollectionRevision } from 'bridge/NexusModsAPI';
import type { INexusAuthState } from 'renderer/react/context/NexusModsContext';
import useModCollectionInstaller from 'renderer/react/context/hooks/useModCollectionInstaller';
import { render } from '@testing-library/react';

const mockGetCollectionModConfigs = jest.fn();
const mockGetCollectionRevision = jest.fn();
const mockInstallMod = jest.fn();
const mockSaveModConfig = jest.fn();
const mockSetItemsOrder = jest.fn();
const mockSetSectionHeaders = jest.fn();
const mockShowToast = jest.fn();

jest.mock('renderer/ModUpdaterAPI', () => ({
  __esModule: true,
  default: {
    getCollectionModConfigs: (...args: unknown[]) =>
      mockGetCollectionModConfigs(...args),
    getCollectionRevision: (...args: unknown[]) =>
      mockGetCollectionRevision(...args),
  },
}));

jest.mock('renderer/react/context/hooks/useModInstaller', () => ({
  __esModule: true,
  default: () => mockInstallMod,
}));

jest.mock('renderer/react/context/ModsContext', () => ({
  useSectionHeaders: () => [
    { nextIndex: 0, headers: [] },
    mockSetSectionHeaders,
  ],
  useSaveModConfig: () => mockSaveModConfig,
  useSetItemsOrder: () => mockSetItemsOrder,
}));

jest.mock('renderer/react/hooks/useToast', () => ({
  __esModule: true,
  default: () => mockShowToast,
}));

const AUTH_STATE: INexusAuthState = { apiKey: 'fake-api-key' };

const COLLECTION: CollectionRevision = {
  revisionNumber: 7,
  modFiles: [
    {
      fileId: 456,
      optional: false,
      file: {
        fileId: 456,
        modId: 123,
        mod: {
          modId: 123,
          modCategory: { name: 'Gameplay' },
          game: { domainName: 'diablo2resurrected' },
        },
      },
    },
  ],
};

const COLLECTION_ARGS = {
  collectionSlug: 'fake-collection',
  revisionNumber: 7,
};

function renderUseModCollectionInstaller(): ReturnType<
  typeof useModCollectionInstaller
> {
  let installCollection:
    | ReturnType<typeof useModCollectionInstaller>
    | undefined;

  function Probe(): null {
    installCollection = useModCollectionInstaller(AUTH_STATE);
    return null;
  }

  render(<Probe />);
  if (installCollection == null) {
    throw new Error('useModCollectionInstaller did not initialize.');
  }
  return installCollection;
}

describe('useModCollectionInstaller failure boundaries', () => {
  beforeEach(() => {
    mockGetCollectionModConfigs.mockReset();
    mockGetCollectionRevision.mockReset();
    mockInstallMod.mockReset();
    mockSaveModConfig.mockReset();
    mockSetItemsOrder.mockReset();
    mockSetSectionHeaders.mockReset();
    mockShowToast.mockReset();

    mockGetCollectionRevision.mockResolvedValue(COLLECTION);
    mockGetCollectionModConfigs.mockResolvedValue({});
    mockInstallMod.mockResolvedValue('installed-mod');
    mockSaveModConfig.mockResolvedValue(undefined);
    mockSetItemsOrder.mockImplementation((update) => update([]));
    mockSetSectionHeaders.mockImplementation((update) =>
      update({ nextIndex: 0, headers: [] }),
    );

    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('installs with defaults when optional collection config metadata fails', async () => {
    const configError = new SyntaxError('invalid collection config JSON');
    mockGetCollectionModConfigs.mockRejectedValue(configError);

    await expect(
      renderUseModCollectionInstaller()(COLLECTION_ARGS),
    ).resolves.toBeUndefined();

    expect(mockInstallMod).toHaveBeenCalledWith({
      nexusModID: '123',
      nexusFileID: 456,
    });
    expect(mockSaveModConfig).not.toHaveBeenCalled();
    expect(mockSetSectionHeaders).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('fake-collection'),
      configError,
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning' }),
    );
  });

  it('applies embedded config after the installed mod ID is returned', async () => {
    const embeddedConfig = { enabled: true };
    mockGetCollectionModConfigs.mockResolvedValue({ 123: embeddedConfig });

    await renderUseModCollectionInstaller()(COLLECTION_ARGS);

    expect(mockSaveModConfig).toHaveBeenCalledWith(
      'installed-mod',
      embeddedConfig,
    );
  });

  it('does not hide an actual mod install failure', async () => {
    const installError = new Error('disk install failed');
    mockInstallMod.mockRejectedValue(installError);

    await expect(
      renderUseModCollectionInstaller()(COLLECTION_ARGS),
    ).rejects.toBe(installError);

    expect(mockSaveModConfig).not.toHaveBeenCalled();
    expect(mockSetSectionHeaders).not.toHaveBeenCalled();
  });

  it('does not hide a required embedded config apply failure', async () => {
    const configError = new Error('config write failed');
    mockGetCollectionModConfigs.mockResolvedValue({
      123: { enabled: true },
    });
    mockSaveModConfig.mockRejectedValue(configError);

    await expect(
      renderUseModCollectionInstaller()(COLLECTION_ARGS),
    ).rejects.toBe(configError);

    expect(mockSetSectionHeaders).not.toHaveBeenCalled();
  });

  it('does not hide a required collection revision failure', async () => {
    const revisionError = new Error('collection revision unavailable');
    mockGetCollectionRevision.mockRejectedValue(revisionError);

    await expect(
      renderUseModCollectionInstaller()(COLLECTION_ARGS),
    ).rejects.toBe(revisionError);

    expect(mockInstallMod).not.toHaveBeenCalled();
  });
});
