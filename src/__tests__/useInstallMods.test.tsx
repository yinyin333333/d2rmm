import type { Mod } from 'bridge/BridgeAPI';
import useInstallMods from 'renderer/react/modlist/hooks/useInstallMods';
import { act, render } from '@testing-library/react';

const mockInstallMods = jest.fn();
const mockLoggerClear = jest.fn();
const mockMarkDeploymentInstalled = jest.fn();
const mockMarkDeploymentOutdated = jest.fn();
const mockMarkOutputModeInstalled = jest.fn();
const mockSetInstalledMods = jest.fn();
const mockSetIsInstalling = jest.fn();
const mockSetTab = jest.fn();
const mockShowToast = jest.fn();
let mockModsToInstall: Mod[] = [];
let mockHasUnsavedEdits = false;
let mockIsDeploymentChanged = false;
let mockIsInventoryCurrent = true;
let mockIsOutputModeChanged = false;
let mockManagedSignature = '';
let mockUseD2RLoader = false;

jest.mock('renderer/BridgeAPI', () => ({
  __esModule: true,
  default: { installMods: (...args: unknown[]) => mockInstallMods(...args) },
}));

jest.mock('renderer/react/context/D2RLoaderPluginContext', () => ({
  useD2RLoaderPluginManager: () => ({
    hasUnsavedEdits: mockHasUnsavedEdits,
    inventory: { managedSignature: mockManagedSignature },
    isDeploymentChanged: mockIsDeploymentChanged,
    isInventoryCurrent: mockIsInventoryCurrent,
    isOutputModeChanged: mockIsOutputModeChanged,
    markDeploymentInstalled: mockMarkDeploymentInstalled,
    markDeploymentOutdated: mockMarkDeploymentOutdated,
    markOutputModeInstalled: mockMarkOutputModeInstalled,
  }),
}));

jest.mock('renderer/react/context/D2RLoaderSettingsContext', () => ({
  useD2RLoaderSettings: () => [
    { useD2RLoader: mockUseD2RLoader, tomlSettings: {} },
  ],
}));

jest.mock('renderer/react/context/GamePathContext', () => ({
  useSanitizedGamePath: () => 'fake-game',
}));

jest.mock('renderer/react/context/InstallContext', () => ({
  useIsInstalling: () => [false, mockSetIsInstalling],
}));

jest.mock('renderer/react/context/IsPreExtractedDataContext', () => ({
  useIsPreExtractedData: () => [false],
}));

jest.mock('renderer/react/context/LogContext', () => ({
  useLogger: () => ({ clear: mockLoggerClear }),
}));

jest.mock('renderer/react/context/ModsContext', () => ({
  useInstalledMods: () => [[], mockSetInstalledMods],
  useModsToInstall: () => mockModsToInstall,
}));

jest.mock('renderer/react/context/NormalizeCRLFOnInstallContext', () => ({
  useNormalizeCRLFOnInstall: () => [false],
}));

jest.mock('renderer/react/context/OutputModNameContext', () => ({
  useOutputModName: () => ['D2RMM'],
}));

jest.mock('renderer/react/context/OutputPathContext', () => ({
  useOutputPath: () => 'fake-output',
}));

jest.mock('renderer/react/context/PreExtractedDataPathContext', () => ({
  usePreExtractedDataPath: () => ['fake-pre-extracted'],
}));

jest.mock('renderer/react/context/SavesPathContext', () => ({
  useFinalSavesPath: () => 'fake-saves',
}));

jest.mock('renderer/react/context/TabContext', () => ({
  useTabState: () => ['mods', mockSetTab],
}));

jest.mock('renderer/react/hooks/useToast', () => ({
  __esModule: true,
  default: () => mockShowToast,
}));

function makeMod(id: string): Mod {
  return {
    id,
    info: { type: 'd2rmm', name: id },
    config: { value: `${id}-config` },
  };
}

function renderUseInstallMods(): () => Promise<boolean> {
  let installMods: (() => Promise<boolean>) | undefined;

  function Probe(): null {
    installMods = useInstallMods();
    return null;
  }

  render(<Probe />);
  if (installMods == null) {
    throw new Error('useInstallMods did not initialize.');
  }
  return installMods;
}

async function invokeInstallMods(
  installMods: () => Promise<boolean>,
): Promise<boolean> {
  let result = false;
  await act(async () => {
    result = await installMods();
  });
  return result;
}

function expectInstallingRestored(): void {
  expect(mockSetIsInstalling.mock.calls).toEqual([[true], [false]]);
}

describe('useInstallMods installation results', () => {
  beforeEach(() => {
    localStorage.clear();
    mockModsToInstall = [];
    mockHasUnsavedEdits = false;
    mockIsDeploymentChanged = false;
    mockIsInventoryCurrent = true;
    mockIsOutputModeChanged = false;
    mockManagedSignature = '';
    mockUseD2RLoader = false;
    mockInstallMods.mockReset();
    mockLoggerClear.mockReset();
    mockMarkDeploymentInstalled.mockReset();
    mockMarkDeploymentOutdated.mockReset();
    mockMarkOutputModeInstalled.mockReset();
    mockSetInstalledMods.mockReset();
    mockSetIsInstalling.mockReset();
    mockSetTab.mockReset();
    mockShowToast.mockReset();
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('snapshots only successful mods and leaves a partial install dirty', async () => {
    const modA = makeMod('A');
    const modB = makeMod('B');
    mockModsToInstall = [modA, modB];
    mockInstallMods.mockResolvedValue(['A', 'not-selected']);

    const result = await invokeInstallMods(renderUseInstallMods());

    expect(result).toBe(true);
    expect(mockSetInstalledMods).toHaveBeenCalledTimes(1);
    const snapshot = mockSetInstalledMods.mock.calls[0][0];
    expect(snapshot).toEqual([{ id: 'A', config: modA.config }]);
    expect(snapshot).not.toEqual(
      mockModsToInstall.map(({ id, config }) => ({ id, config })),
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning' }),
    );
    expect(mockSetTab).not.toHaveBeenCalled();
    expectInstallingRestored();
  });

  it('preserves the previous snapshot and reports failure when all mods fail', async () => {
    mockModsToInstall = [makeMod('A'), makeMod('B')];
    mockInstallMods.mockResolvedValue([]);

    const result = await invokeInstallMods(renderUseInstallMods());

    expect(result).toBe(false);
    expect(mockSetInstalledMods).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(mockSetTab).toHaveBeenCalledWith('logs');
    expectInstallingRestored();
  });

  it('snapshots every selected mod and reports success when all succeed', async () => {
    const modA = makeMod('A');
    const modB = makeMod('B');
    mockModsToInstall = [modA, modB];
    mockInstallMods.mockResolvedValue(['B', 'A']);

    const result = await invokeInstallMods(renderUseInstallMods());

    expect(result).toBe(true);
    expect(mockSetInstalledMods).toHaveBeenCalledWith([
      { id: 'A', config: modA.config },
      { id: 'B', config: modB.config },
    ]);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success' }),
    );
    expect(mockSetTab).not.toHaveBeenCalled();
    expectInstallingRestored();
  });

  it('treats zero selected mods as a no-op success without clearing the snapshot', async () => {
    mockModsToInstall = [];
    mockInstallMods.mockResolvedValue([]);

    const result = await invokeInstallMods(renderUseInstallMods());

    expect(result).toBe(true);
    expect(mockInstallMods).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ isDryRun: false }),
    );
    expect(mockSetInstalledMods).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success' }),
    );
    expect(mockSetTab).not.toHaveBeenCalled();
    expectInstallingRestored();
  });

  it('passes the selected D2RLoader mode to the worker install options', async () => {
    mockUseD2RLoader = true;
    mockModsToInstall = [makeMod('A')];
    mockInstallMods.mockResolvedValue(['A']);

    await invokeInstallMods(renderUseInstallMods());

    expect(mockInstallMods).toHaveBeenCalledWith(
      mockModsToInstall,
      expect.objectContaining({ useD2RLoader: true }),
    );
  });

  it.each([
    ['an unsaved JSON draft', true, true],
    ['a stale plugin inventory', false, false],
  ])('blocks loader installation with %s', async (_label, dirty, current) => {
    mockUseD2RLoader = true;
    mockHasUnsavedEdits = dirty;
    mockIsInventoryCurrent = current;

    const result = await invokeInstallMods(renderUseInstallMods());

    expect(result).toBe(false);
    expect(mockInstallMods).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning' }),
    );
    expect(mockSetTab).toHaveBeenCalledWith('plugins');
    expect(mockSetIsInstalling).not.toHaveBeenCalled();
  });

  it('ignores a legacy saved Direct Mode value and emits only mod output options', async () => {
    localStorage.setItem('direct-mod', 'true');
    mockModsToInstall = [makeMod('A')];
    mockInstallMods.mockResolvedValue(['A']);

    await invokeInstallMods(renderUseInstallMods());

    const passedOptions = mockInstallMods.mock.calls[0][1];
    expect(passedOptions).not.toHaveProperty('isDirectMode');
    expect(passedOptions).not.toHaveProperty('dataPath');
    expect(passedOptions).toEqual(
      expect.objectContaining({
        isDryRun: false,
        mergedPath: 'fake-output',
      }),
    );
  });

  it('explicitly syncs a changed D2RLoader package set with no selected mods', async () => {
    mockUseD2RLoader = true;
    mockIsDeploymentChanged = true;
    mockInstallMods.mockResolvedValue([]);

    const result = await invokeInstallMods(renderUseInstallMods());

    expect(result).toBe(true);
    expect(mockInstallMods).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ syncD2RLoaderOutput: true }),
    );
    expect(mockMarkDeploymentInstalled).toHaveBeenCalledTimes(1);
    expect(mockMarkOutputModeInstalled).toHaveBeenCalledTimes(1);
    expect(mockSetInstalledMods).toHaveBeenCalledWith([]);
  });

  it('invalidates an old deployment after a loader-off rebuild even when the current package set is empty', async () => {
    mockManagedSignature = '';
    mockModsToInstall = [makeMod('A')];
    mockInstallMods.mockResolvedValue(['A']);

    await invokeInstallMods(renderUseInstallMods());

    expect(mockMarkDeploymentOutdated).toHaveBeenCalledTimes(1);
    expect(mockMarkDeploymentInstalled).not.toHaveBeenCalled();
  });

  it('syncs a loader-off output mode change and clears stale deployment state with no mods', async () => {
    mockIsOutputModeChanged = true;
    mockInstallMods.mockResolvedValue([]);

    await invokeInstallMods(renderUseInstallMods());

    expect(mockInstallMods).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ syncD2RLoaderOutput: true }),
    );
    expect(mockMarkOutputModeInstalled).toHaveBeenCalledTimes(1);
    expect(mockMarkDeploymentOutdated).toHaveBeenCalledTimes(1);
    expect(mockSetInstalledMods).toHaveBeenCalledWith([]);
  });
});
