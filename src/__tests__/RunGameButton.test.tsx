import RunGameButton from '../renderer/react/modlist/RunGameButton';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockExecute = jest.fn();
const mockPrepareD2RLoaderLaunch = jest.fn();
const mockInstallMods = jest.fn();
const mockShowToast = jest.fn();
let mockInstallBeforeRun = false;
let mockHasUnsavedEdits = false;
let mockIsDeploymentChanged = false;
let mockIsInventoryCurrent = true;
let mockIsInstalling = false;
let mockIsLoadingMods = false;
let mockIsLoadingPlugins = false;
let mockIsMutatingPlugins = false;
let mockIsOutputModeChanged = false;
let mockUseD2RLoader = false;

jest.mock('renderer/BridgeAPI', () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
  prepareD2RLoaderLaunch: (...args: unknown[]) =>
    mockPrepareD2RLoaderLaunch(...args),
}));

jest.mock('renderer/react/context/D2RLoaderSettingsContext', () => ({
  useD2RLoaderSettings: () => [
    { useD2RLoader: mockUseD2RLoader, tomlSettings: {} },
  ],
}));

jest.mock('renderer/react/context/D2RLoaderPluginContext', () => ({
  useD2RLoaderPluginManager: () => ({
    hasUnsavedEdits: mockHasUnsavedEdits,
    isDeploymentChanged: mockIsDeploymentChanged,
    isInventoryCurrent: mockIsInventoryCurrent,
    isLoading: mockIsLoadingPlugins,
    isMutating: mockIsMutatingPlugins,
    isOutputModeChanged: mockIsOutputModeChanged,
  }),
}));

jest.mock('renderer/react/context/GamePathContext', () => ({
  useSanitizedGamePath: () => 'C:\\Fake Game',
}));

jest.mock('renderer/react/context/InstallBeforeRunContext', () => ({
  useInstallBeforeRun: () => [mockInstallBeforeRun],
}));

jest.mock('renderer/react/context/InstallContext', () => ({
  useIsInstalling: () => [mockIsInstalling, jest.fn()],
  useInstallationOperation: () => ({
    operation: {
      active: mockIsInstalling,
      label: mockIsInstalling ? 'Installing mods…' : '',
      progress: mockIsInstalling ? 50 : null,
    },
  }),
}));

jest.mock('renderer/react/context/ModsContext', () => ({
  useIsInstallConfigChanged: () => false,
  useIsLoadingMods: () => mockIsLoadingMods,
}));

jest.mock('renderer/react/context/OutputModNameContext', () => ({
  useOutputModName: () => ['D2RMM'],
}));

jest.mock('renderer/react/hooks/useGameLaunchArgs', () => () => []);
jest.mock('renderer/react/hooks/useToast', () => () => mockShowToast);
jest.mock(
  'renderer/react/modlist/hooks/useInstallMods',
  () => () => mockInstallMods,
);

describe('RunGameButton launch failures', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInstallBeforeRun = false;
    mockHasUnsavedEdits = false;
    mockIsDeploymentChanged = false;
    mockIsInventoryCurrent = true;
    mockIsInstalling = false;
    mockIsLoadingMods = false;
    mockIsLoadingPlugins = false;
    mockIsMutatingPlugins = false;
    mockIsOutputModeChanged = false;
    mockUseD2RLoader = false;
    mockExecute.mockResolvedValue(0);
    mockPrepareD2RLoaderLaunch.mockResolvedValue(undefined);
    mockInstallMods.mockResolvedValue(true);
  });

  it('catches execute rejection and shows exactly one error toast', async () => {
    mockExecute.mockRejectedValueOnce(new Error('launch failed'));
    render(<RunGameButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Run D2R' }));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));
    expect(mockShowToast).toHaveBeenCalledWith({
      severity: 'error',
      title: 'Failed to launch Diablo II: Resurrected',
      description: 'launch failed',
    });
    expect(mockInstallMods).not.toHaveBeenCalled();
  });

  it('catches loader preparation rejection without executing the loader', async () => {
    mockUseD2RLoader = true;
    mockPrepareD2RLoaderLaunch.mockRejectedValueOnce(
      new Error('loader preparation failed'),
    );
    render(<RunGameButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Run D2R' }));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));
    expect(mockShowToast).toHaveBeenCalledWith({
      severity: 'error',
      title: 'Failed to launch Diablo II: Resurrected',
      description: 'loader preparation failed',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('does not execute when install-before-run reports failure', async () => {
    mockInstallBeforeRun = true;
    mockInstallMods.mockResolvedValueOnce(false);
    render(<RunGameButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Run D2R' }));

    await waitFor(() => expect(mockInstallMods).toHaveBeenCalledTimes(1));
    expect(mockPrepareD2RLoaderLaunch).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('is disabled and does not launch while an install is active', () => {
    mockIsInstalling = true;
    render(<RunGameButton />);

    const button = screen.getByRole('button', { name: 'Run D2R' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);

    expect(mockInstallMods).not.toHaveBeenCalled();
    expect(mockPrepareD2RLoaderLaunch).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('waits for managed package inventory before a loader launch', () => {
    mockUseD2RLoader = true;
    mockIsLoadingPlugins = true;
    render(<RunGameButton />);

    const button = screen.getByRole('button', { name: 'Run D2R' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);

    expect(mockPrepareD2RLoaderLaunch).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('explains why a disabled launch action is unavailable', async () => {
    mockIsLoadingMods = true;
    render(<RunGameButton />);

    const button = screen.getByRole('button', { name: 'Run D2R' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.mouseOver(button.parentElement!);

    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'Loading the mod list…',
    );
  });

  it('does not launch with an unsaved loader JSON draft', () => {
    mockUseD2RLoader = true;
    mockHasUnsavedEdits = true;
    render(<RunGameButton />);

    const button = screen.getByRole('button', { name: 'Run D2R' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(mockPrepareD2RLoaderLaunch).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
