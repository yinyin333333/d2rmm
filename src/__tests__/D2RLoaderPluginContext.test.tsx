import type { D2RLoaderPluginImportResult } from 'bridge/D2RLoaderPluginAPI';
import {
  D2RLoaderPluginContextProvider,
  useD2RLoaderPluginManager,
} from 'renderer/react/context/D2RLoaderPluginContext';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

const mockImportSources = jest.fn();
const mockDeletePackage = jest.fn();
const mockReadEditableJSON = jest.fn();
const mockReadInventory = jest.fn();
const mockSaveEditableJSON = jest.fn();
let mockOutputPath = 'C:\\FakeGame\\mods\\First\\First.mpq\\data';
let mockUseD2RLoader = false;
let pluginManager: ReturnType<typeof useD2RLoaderPluginManager> | null = null;

jest.mock('renderer/D2RLoaderPluginAPI', () => ({
  __esModule: true,
  default: {
    deletePackage: (...args: unknown[]) => mockDeletePackage(...args),
    importSources: (...args: unknown[]) => mockImportSources(...args),
    readEditableJSON: (...args: unknown[]) => mockReadEditableJSON(...args),
    readInventory: (...args: unknown[]) => mockReadInventory(...args),
    saveEditableJSON: (...args: unknown[]) => mockSaveEditableJSON(...args),
  },
}));

jest.mock('renderer/react/context/ModsContext', () => ({
  useMods: () => [[], jest.fn()],
  useModsRevision: () => 1,
}));

jest.mock('renderer/react/context/D2RLoaderSettingsContext', () => ({
  useD2RLoaderSettings: () => [
    { useD2RLoader: mockUseD2RLoader, tomlSettings: {} },
  ],
}));

jest.mock('renderer/react/context/OutputPathContext', () => ({
  useOutputPath: () => mockOutputPath,
}));

function Probe(): JSX.Element {
  pluginManager = useD2RLoaderPluginManager();
  const {
    hasUnsavedEdits,
    isDeploymentChanged,
    isInventoryCurrent,
    isMutating,
    isOutputModeChanged,
    markDeploymentInstalled,
    markOutputModeInstalled,
  } = pluginManager;
  return (
    <>
      <span>{isDeploymentChanged ? 'dirty' : 'clean'}</span>
      <span>{hasUnsavedEdits ? 'draft-dirty' : 'draft-clean'}</span>
      <span>
        {isInventoryCurrent ? 'inventory-current' : 'inventory-stale'}
      </span>
      <span>{isMutating ? 'mutating' : 'idle'}</span>
      <span>{isOutputModeChanged ? 'mode-dirty' : 'mode-clean'}</span>
      <button onClick={markDeploymentInstalled} type="button">
        Mark installed
      </button>
      <button onClick={markOutputModeInstalled} type="button">
        Mark output mode installed
      </button>
    </>
  );
}

describe('D2RLoaderPluginContext deployment state', () => {
  beforeEach(() => {
    localStorage.clear();
    pluginManager = null;
    mockOutputPath = 'C:\\FakeGame\\mods\\First\\First.mpq\\data';
    mockUseD2RLoader = false;
    mockReadInventory.mockReset();
    mockDeletePackage.mockReset();
    mockImportSources.mockReset();
    mockReadEditableJSON.mockReset();
    mockSaveEditableJSON.mockReset();
    mockReadInventory.mockResolvedValue({
      configs: [],
      conflicts: [],
      managedRoot: 'C:\\FakeApp\\d2rloader',
      managedSignature: 'same-package-signature',
      packages: [],
      patches: [],
      plugins: [],
    });
  });

  it('marks the same package signature dirty when the output target changes', async () => {
    const view = render(
      <D2RLoaderPluginContextProvider>
        <Probe />
      </D2RLoaderPluginContextProvider>,
    );

    await waitFor(() => expect(screen.getByText('dirty')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Mark installed' }));
    expect(screen.getByText('clean')).toBeTruthy();

    mockOutputPath = 'C:\\FakeGame\\mods\\Second\\Second.mpq\\data';
    view.rerender(
      <D2RLoaderPluginContextProvider>
        <Probe />
      </D2RLoaderPluginContextProvider>,
    );

    expect(screen.getByText('dirty')).toBeTruthy();
  });

  it('rejects overlapping package mutations until the current import finishes', async () => {
    let finishImport: (value: {
      importedFiles: number;
      packages: string[];
      warnings: string[];
    }) => void = () => {};
    mockImportSources.mockReturnValueOnce(
      new Promise((resolve) => {
        finishImport = resolve;
      }),
    );
    render(
      <D2RLoaderPluginContextProvider>
        <Probe />
      </D2RLoaderPluginContextProvider>,
    );
    await waitFor(() => expect(pluginManager).not.toBeNull());

    let firstImport: Promise<unknown> = Promise.resolve();
    act(() => {
      firstImport = pluginManager!.importSources(['first.zip']);
    });
    expect(screen.getByText('mutating')).toBeTruthy();
    await expect(pluginManager!.importSources(['second.zip'])).rejects.toThrow(
      'still running',
    );
    await expect(
      pluginManager!.saveEditableJSON(
        {
          packageName: 'Package',
          sourcePath: 'settings.json',
          sourceType: 'managed',
        },
        'a'.repeat(64),
        '{}',
      ),
    ).rejects.toThrow('still running');

    await act(async () => {
      finishImport({ importedFiles: 1, packages: ['First'], warnings: [] });
      await firstImport;
    });
    expect(screen.getByText('idle')).toBeTruthy();
    expect(mockImportSources).toHaveBeenCalledTimes(1);
    expect(mockSaveEditableJSON).not.toHaveBeenCalled();
  });

  it('tracks D2RLoader changes as pending output changes', () => {
    const view = render(
      <D2RLoaderPluginContextProvider>
        <Probe />
      </D2RLoaderPluginContextProvider>,
    );
    expect(screen.getByText('mode-clean')).toBeTruthy();

    mockUseD2RLoader = true;
    view.rerender(
      <D2RLoaderPluginContextProvider>
        <Probe />
      </D2RLoaderPluginContextProvider>,
    );
    expect(screen.getByText('mode-dirty')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark output mode installed' }),
    );
    expect(screen.getByText('mode-clean')).toBeTruthy();
  });

  it('loads and saves editable JSON through the shared package mutation boundary', async () => {
    const document = {
      contents: '{"enabled":true}',
      format: 'json' as const,
      packageName: 'Editable',
      role: 'plugin' as const,
      sha256: 'a'.repeat(64),
      sourcePath: 'settings.json',
      targetPath: 'plugins\\settings.json',
    };
    mockReadEditableJSON.mockResolvedValue(document);
    mockSaveEditableJSON.mockResolvedValue({
      sha256: 'b'.repeat(64),
      warnings: [],
    });
    render(
      <D2RLoaderPluginContextProvider>
        <Probe />
      </D2RLoaderPluginContextProvider>,
    );
    await waitFor(() => expect(pluginManager?.isLoading).toBe(false));

    await expect(
      pluginManager!.readEditableJSON({
        packageName: 'Editable',
        sourcePath: 'settings.json',
        sourceType: 'managed',
      }),
    ).resolves.toEqual(document);
    await act(async () => {
      await pluginManager!.saveEditableJSON(
        {
          packageName: 'Editable',
          sourcePath: 'settings.json',
          sourceType: 'managed',
        },
        document.sha256,
        '{"enabled":false}',
      );
    });

    expect(mockReadEditableJSON).toHaveBeenCalledWith(
      {
        packageName: 'Editable',
        sourcePath: 'settings.json',
        sourceType: 'managed',
      },
    );
    expect(mockSaveEditableJSON).toHaveBeenCalledWith(
      {
        packageName: 'Editable',
        sourcePath: 'settings.json',
        sourceType: 'managed',
      },
      document.sha256,
      '{"enabled":false}',
    );
    expect(mockReadInventory).toHaveBeenCalledTimes(2);
    expect(screen.getByText('idle')).toBeTruthy();
  });

  it('blocks package replacement and deletion while an editor draft is dirty', async () => {
    render(
      <D2RLoaderPluginContextProvider>
        <Probe />
      </D2RLoaderPluginContextProvider>,
    );
    await waitFor(() => expect(pluginManager?.isLoading).toBe(false));

    act(() =>
      pluginManager!.setEditableJSONDirty('Package/settings.json', true),
    );
    expect(screen.getByText('draft-dirty')).toBeTruthy();
    await expect(
      pluginManager!.importSources(['replacement.zip']),
    ).rejects.toThrow(/save or cancel/i);
    await expect(pluginManager!.deletePackage('Package')).rejects.toThrow(
      /save or cancel/i,
    );
    expect(mockImportSources).not.toHaveBeenCalled();
    expect(mockDeletePackage).not.toHaveBeenCalled();

    act(() =>
      pluginManager!.setEditableJSONDirty('Package/settings.json', false),
    );
    expect(screen.getByText('draft-clean')).toBeTruthy();
  });

  it('treats a legacy Direct Mode output token as dirty and migrates it', async () => {
    localStorage.setItem('installed-output-mode', 'direct:loader');
    mockUseD2RLoader = true;
    render(
      <D2RLoaderPluginContextProvider>
        <Probe />
      </D2RLoaderPluginContextProvider>,
    );
    expect(screen.getByText('mode-dirty')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark output mode installed' }),
    );
    expect(screen.getByText('mode-clean')).toBeTruthy();
    await waitFor(() =>
      expect(localStorage.getItem('installed-output-mode')).toBe('mod:loader'),
    );
  });

  it('reports a refresh error without misreporting a completed import as failed', async () => {
    const imported: D2RLoaderPluginImportResult = {
      importedFiles: 1,
      packages: ['Imported'],
      warnings: [],
    };
    mockImportSources.mockResolvedValueOnce(imported);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <D2RLoaderPluginContextProvider>
        <Probe />
      </D2RLoaderPluginContextProvider>,
    );
    await waitFor(() => expect(pluginManager?.isLoading).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Mark installed' }));
    expect(screen.getByText('clean')).toBeTruthy();
    mockReadInventory.mockRejectedValueOnce(
      new Error('synthetic inventory refresh failure'),
    );

    let result: typeof imported | null = null;
    await act(async () => {
      result = await pluginManager!.importSources(['imported.zip']);
    });
    expect(result).toEqual(imported);
    expect(pluginManager?.error?.message).toBe(
      'synthetic inventory refresh failure',
    );
    expect(screen.getByText('dirty')).toBeTruthy();
    expect(screen.getByText('inventory-stale')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark installed' }));
    expect(screen.getByText('dirty')).toBeTruthy();
    expect(screen.getByText('inventory-stale')).toBeTruthy();
  });
});
