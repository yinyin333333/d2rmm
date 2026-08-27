import BridgeAPI from 'renderer/BridgeAPI';
import ShellAPI from 'renderer/ShellAPI';
import ModManagerPlugins from 'renderer/react/ModManagerPlugins';
import {
  DialogManagerContextProvider,
  DialogRenderer,
} from 'renderer/react/context/DialogContext';
import '@testing-library/jest-dom';
import { createD2RLoaderPluginEditConflictError } from 'shared/D2RLoaderPluginEditError';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockDeleteSource = jest.fn();
const mockReadEditableJSON = jest.fn();
const mockRefresh = jest.fn();
const mockSaveEditableJSON = jest.fn();
const mockSetEditableJSONDirty = jest.fn();
const mockShowToast = jest.fn();
const mockCreateDirectory = jest.fn();
const mockOpenPath = jest.fn();
const mockShowItemInFolder = jest.fn();

const mockInventory = {
  configs: [
    {
      deletionSource: {
        packageName: 'eezstreet-plugin-pack-2.0',
        sourcePath: 'settings.toml',
        sourceType: 'managed' as const,
      },
      editableSource: {
        packageName: 'eezstreet-plugin-pack-2.0',
        sourcePath: 'settings.toml',
        sourceType: 'managed' as const,
      },
      editableSourcePath: 'settings.toml',
      id: 'managed:eezstreet:settings.toml',
      name: 'settings.toml',
      packageName: 'eezstreet-plugin-pack-2.0',
      relativePath: 'settings.toml',
      sha256: 'f'.repeat(64),
      sourceName: 'eezstreet-plugin-pack-2.0',
      sourceType: 'managed' as const,
    },
  ],
  conflicts: [],
  deploymentSignature: 'deployment-signature',
  managedRoot: 'C:\\D2RMM\\d2rloader',
  managedSignature: 'signature',
  packages: [
    {
      configFiles: ['config\\settings.toml'],
      dataFiles: [],
      name: 'eezstreet-plugin-pack-2.0',
      patchFiles: [],
      pluginFiles: ['plugins\\D2RPlugins.json', 'plugins\\plugin-items.dll'],
      unmappedFiles: [],
      warnings: [],
    },
    {
      configFiles: [],
      dataFiles: [],
      name: 'maxstashgold',
      patchFiles: ['patches\\maxstashgold.json'],
      pluginFiles: [],
      unmappedFiles: [],
      warnings: [],
    },
  ],
  patches: [
    {
      deletionSource: {
        packageName: 'maxstashgold',
        sourcePath: 'maxstashgold.json',
        sourceType: 'managed' as const,
      },
      editableSource: {
        packageName: 'maxstashgold',
        sourcePath: 'maxstashgold.json',
        sourceType: 'managed' as const,
      },
      editableSourcePath: 'maxstashgold.json',
      id: 'managed:maxstashgold:maxstashgold.json',
      name: 'maxstashgold.json',
      packageName: 'maxstashgold',
      relativePath: 'maxstashgold.json',
      sha256: 'c'.repeat(64),
      sourceName: 'maxstashgold',
      sourceType: 'managed' as const,
    },
  ],
  plugins: [
    {
      deletionSource: {
        packageName: 'eezstreet-plugin-pack-2.0',
        sourcePath: 'D2RPlugins.json',
        sourceType: 'managed' as const,
      },
      editableSource: {
        packageName: 'eezstreet-plugin-pack-2.0',
        sourcePath: 'D2RPlugins.json',
        sourceType: 'managed' as const,
      },
      editableSourcePath: 'D2RPlugins.json',
      id: 'managed:eezstreet:D2RPlugins.json',
      name: 'D2RPlugins.json',
      packageName: 'eezstreet-plugin-pack-2.0',
      relativePath: 'D2RPlugins.json',
      sha256: 'a'.repeat(64),
      sourceName: 'eezstreet-plugin-pack-2.0',
      sourceType: 'managed' as const,
    },
    {
      deletionSource: {
        packageName: 'eezstreet-plugin-pack-2.0',
        sourcePath: 'plugin-items.dll',
        sourceType: 'managed' as const,
      },
      editableSource: null,
      editableSourcePath: null,
      id: 'managed:eezstreet:plugin-items.dll',
      name: 'plugin-items.dll',
      packageName: 'eezstreet-plugin-pack-2.0',
      pluginInfo: {
        apiVersion: 3,
        author: 'Example Author',
        description: 'Example plugin',
        id: 'plugin-items',
        name: 'Items Plus',
        version: '2.0.0',
      },
      relativePath: 'plugin-items.dll',
      sha256: 'b'.repeat(64),
      sourceName: 'eezstreet-plugin-pack-2.0',
      sourceType: 'managed' as const,
    },
    {
      deletionSource: {
        category: 'plugins' as const,
        loaderRootPath: 'd2rloader',
        modID: 'Example Mod',
        sourcePath: 'mod-settings.json',
        sourceType: 'mod' as const,
      },
      editableSource: {
        category: 'plugins' as const,
        loaderRootPath: 'd2rloader',
        modID: 'Example Mod',
        sourcePath: 'mod-settings.json',
        sourceType: 'mod' as const,
      },
      editableSourcePath: 'mod-settings.json',
      id: 'mod:Example Mod:mod-settings.json',
      name: 'mod-settings.json',
      packageName: null,
      relativePath: 'mod-settings.json',
      sha256: 'd'.repeat(64),
      sourceName: 'Example Mod',
      sourceType: 'mod' as const,
    },
  ],
};

jest.mock('renderer/BridgeAPI', () => ({
  __esModule: true,
  default: {
    createDirectory: (...args: unknown[]) => mockCreateDirectory(...args),
  },
}));

jest.mock('renderer/ShellAPI', () => ({
  __esModule: true,
  default: {
    openPath: (...args: unknown[]) => mockOpenPath(...args),
    showItemInFolder: (...args: unknown[]) => mockShowItemInFolder(...args),
  },
}));

jest.mock('renderer/react/context/D2RLoaderPluginContext', () => ({
  useD2RLoaderPluginManager: () => ({
    deleteSource: mockDeleteSource,
    error: null,
    hasUnsavedEdits: false,
    inventory: mockInventory,
    isInventoryCurrent: true,
    isLoading: false,
    isMutating: false,
    readEditableJSON: mockReadEditableJSON,
    refresh: mockRefresh,
    saveEditableJSON: mockSaveEditableJSON,
    setEditableJSONDirty: mockSetEditableJSONDirty,
  }),
}));

jest.mock('renderer/react/context/InstallContext', () => ({
  useIsInstalling: () => [false, jest.fn()],
}));

jest.mock('renderer/react/hooks/useToast', () => ({
  __esModule: true,
  default: () => mockShowToast,
}));

function renderPlugins(): void {
  render(
    <DialogManagerContextProvider>
      <ModManagerPlugins />
      <DialogRenderer />
    </DialogManagerContextProvider>,
  );
}

describe('ModManagerPlugins', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateDirectory.mockResolvedValue(undefined);
    mockDeleteSource.mockResolvedValue(undefined);
    mockOpenPath.mockResolvedValue(undefined);
    mockShowItemInFolder.mockResolvedValue(undefined);
    mockReadEditableJSON.mockImplementation(
      async (source: { packageName?: string; sourcePath: string }) => {
        const { sourcePath } = source;
        const packageName = source.packageName ?? null;
        const isTOML = sourcePath === 'settings.toml';
        const isPatch = sourcePath === 'maxstashgold.json';
        const format: 'json' | 'toml' = isTOML ? 'toml' : 'json';
        const role: 'config' | 'patch' | 'plugin' = isTOML
          ? 'config'
          : isPatch
            ? 'patch'
            : 'plugin';
        return {
          contents: isTOML
            ? 'enabled = true\n'
            : isPatch
              ? '{"version":1,"patches":[{"op":"write-u32","rva":"0x10"}]}'
              : '{\n  // editable\n  "enabled": true,\n}\n',
          format,
          packageName,
          role,
          sha256: isTOML
            ? 'f'.repeat(64)
            : isPatch
              ? 'c'.repeat(64)
              : 'a'.repeat(64),
          sourcePath,
          targetPath: isTOML
            ? 'config\\settings.toml'
            : isPatch
              ? 'patches\\maxstashgold.json'
              : 'plugins\\D2RPlugins.json',
        };
      },
    );
    mockRefresh.mockResolvedValue(mockInventory);
    mockSaveEditableJSON.mockResolvedValue({
      sha256: 'e'.repeat(64),
      warnings: [],
    });
  });

  it('separates files by package or mod source and exposes supported editors by category', () => {
    renderPlugins();

    expect(
      screen.getAllByText('D2RMM package: eezstreet-plugin-pack-2.0'),
    ).toHaveLength(1);
    expect(screen.getByText('Mod: Example Mod')).toBeInTheDocument();
    expect(screen.getByText('Items Plus (2.0.0)')).toBeInTheDocument();
    expect(
      screen.getByText('plugin-items.dll · plugin-items · API 3'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Edit D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Edit mod-settings.json from mod Example Mod',
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Patches · 1' }));
    expect(screen.getByText('D2RMM package: maxstashgold')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Edit maxstashgold.json from D2RMM package maxstashgold',
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Plugin Configs · 1' }));
    expect(screen.getByText('Plugin Configs (1)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Edit settings.toml from D2RMM package eezstreet-plugin-pack-2.0',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Edit plugin-items\.dll/ }),
    ).not.toBeInTheDocument();
  });

  it('lazy-loads, expands, edits, and saves managed JSON', async () => {
    renderPlugins();
    const editButton = screen.getByRole('button', {
      name: 'Edit D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
    });

    expect(editButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(editButton);
    const editor = await screen.findByRole('textbox', {
      name: 'JSON editor for D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
    });
    expect(editButton).toHaveAttribute('aria-expanded', 'true');
    expect(mockReadEditableJSON).toHaveBeenCalledWith({
      packageName: 'eezstreet-plugin-pack-2.0',
      sourcePath: 'D2RPlugins.json',
      sourceType: 'managed',
    });

    const edited = '{\n  "enabled": false\n}\n';
    fireEvent.change(editor, { target: { value: edited } });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
      }),
    );

    await waitFor(() =>
      expect(mockSaveEditableJSON).toHaveBeenCalledWith(
        {
          packageName: 'eezstreet-plugin-pack-2.0',
          sourcePath: 'D2RPlugins.json',
          sourceType: 'managed',
        },
        'a'.repeat(64),
        edited,
      ),
    );
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'D2RPlugins.json saved' }),
      ),
    );
    expect(mockSetEditableJSONDirty).toHaveBeenCalledWith(
      'managed:eezstreet:D2RPlugins.json',
      true,
    );
  });

  it('lazy-loads, edits, and saves managed TOML', async () => {
    renderPlugins();
    fireEvent.click(screen.getByRole('tab', { name: 'Plugin Configs · 1' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit settings.toml from D2RMM package eezstreet-plugin-pack-2.0',
      }),
    );
    const editor = await screen.findByRole('textbox', {
      name: 'TOML editor for settings.toml from D2RMM package eezstreet-plugin-pack-2.0',
    });
    expect(mockReadEditableJSON).toHaveBeenCalledWith({
      packageName: 'eezstreet-plugin-pack-2.0',
      sourcePath: 'settings.toml',
      sourceType: 'managed',
    });

    const edited = 'enabled = false\n[feature]\nmode = "safe"\n';
    fireEvent.change(editor, { target: { value: edited } });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save settings.toml from D2RMM package eezstreet-plugin-pack-2.0',
      }),
    );

    await waitFor(() =>
      expect(mockSaveEditableJSON).toHaveBeenCalledWith(
        {
          packageName: 'eezstreet-plugin-pack-2.0',
          sourcePath: 'settings.toml',
          sourceType: 'managed',
        },
        'f'.repeat(64),
        edited,
      ),
    );
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'settings.toml saved' }),
      ),
    );
  });

  it('offers an explicit reload after a stale revision save error', async () => {
    mockSaveEditableJSON.mockRejectedValueOnce(
      createD2RLoaderPluginEditConflictError(
        'Managed package JSON changed since the editor was opened.',
      ),
    );
    mockReadEditableJSON
      .mockResolvedValueOnce({
        contents: '{"value":"old"}',
        format: 'json',
        packageName: 'eezstreet-plugin-pack-2.0',
        role: 'plugin',
        sha256: 'a'.repeat(64),
        sourcePath: 'D2RPlugins.json',
        targetPath: 'plugins\\D2RPlugins.json',
      })
      .mockResolvedValueOnce({
        contents: '{"value":"external"}',
        format: 'json',
        packageName: 'eezstreet-plugin-pack-2.0',
        role: 'plugin',
        sha256: 'f'.repeat(64),
        sourcePath: 'D2RPlugins.json',
        targetPath: 'plugins\\D2RPlugins.json',
      });
    renderPlugins();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
      }),
    );
    const editor = await screen.findByRole('textbox', {
      name: 'JSON editor for D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
    });
    fireEvent.change(editor, { target: { value: '{"value":"draft"}' } });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
      }),
    );

    const reload = await screen.findByRole('button', {
      name: 'Reload D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
    });
    fireEvent.click(reload);
    await waitFor(() => expect(mockReadEditableJSON).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole('textbox', {
        name: 'JSON editor for D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
      }),
    ).toHaveValue('{"value":"external"}');
  });

  it('offers reload when a mod edit detects a last-moment external change', async () => {
    mockSaveEditableJSON.mockRejectedValueOnce(
      createD2RLoaderPluginEditConflictError(
        'The mod file changed immediately before the edit was committed. Refresh and reopen it.',
      ),
    );
    mockReadEditableJSON
      .mockResolvedValueOnce({
        contents: '{"value":"old"}',
        format: 'json',
        packageName: null,
        role: 'plugin',
        sha256: 'd'.repeat(64),
        sourcePath: 'mod-settings.json',
        targetPath: 'plugins\\mod-settings.json',
      })
      .mockResolvedValueOnce({
        contents: '{"value":"external"}',
        format: 'json',
        packageName: null,
        role: 'plugin',
        sha256: 'e'.repeat(64),
        sourcePath: 'mod-settings.json',
        targetPath: 'plugins\\mod-settings.json',
      });
    renderPlugins();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit mod-settings.json from mod Example Mod',
      }),
    );
    const editor = await screen.findByRole('textbox', {
      name: 'JSON editor for mod-settings.json from mod Example Mod',
    });
    fireEvent.change(editor, { target: { value: '{"value":"draft"}' } });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save mod-settings.json from mod Example Mod',
      }),
    );

    const reload = await screen.findByRole('button', {
      name: 'Reload mod-settings.json from mod Example Mod',
    });
    fireEvent.click(reload);
    await waitFor(() => expect(mockReadEditableJSON).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole('textbox', {
        name: 'JSON editor for mod-settings.json from mod Example Mod',
      }),
    ).toHaveValue('{"value":"external"}');
  });

  it('allows correcting a role validation error without discarding the draft', async () => {
    mockSaveEditableJSON.mockRejectedValueOnce(
      new Error(
        'Plugin companion JSON/JSONC cannot be changed into a patch: "D2RPlugins.json".',
      ),
    );
    renderPlugins();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
      }),
    );
    const editor = await screen.findByRole('textbox', {
      name: 'JSON editor for D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
    });
    const patchDraft =
      '{"version":1,"patches":[{"op":"write-u8","rva":"0x10"}]}';
    fireEvent.change(editor, { target: { value: patchDraft } });
    const saveButton = screen.getByRole('button', {
      name: 'Save D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
    });
    fireEvent.click(saveButton);

    expect(
      await screen.findByText(/cannot be changed into a patch/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Reload D2RPlugins.json from D2RMM package eezstreet-plugin-pack-2.0',
      }),
    ).not.toBeInTheDocument();
    expect(saveButton).not.toBeDisabled();

    const correctedDraft = '{"enabled":false}';
    fireEvent.change(editor, { target: { value: correctedDraft } });
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(mockSaveEditableJSON).toHaveBeenLastCalledWith(
        {
          packageName: 'eezstreet-plugin-pack-2.0',
          sourcePath: 'D2RPlugins.json',
          sourceType: 'managed',
        },
        'a'.repeat(64),
        correctedDraft,
      ),
    );
    expect(mockSaveEditableJSON).toHaveBeenCalledTimes(2);
  });

  it('opens package storage itself instead of selecting it in the parent folder', async () => {
    renderPlugins();

    fireEvent.click(
      screen.getByRole('button', { name: 'Open package storage' }),
    );

    await waitFor(() =>
      expect(mockCreateDirectory).toHaveBeenCalledWith('C:\\D2RMM\\d2rloader'),
    );
    expect(mockOpenPath).toHaveBeenCalledWith('C:\\D2RMM\\d2rloader');
    expect(mockShowItemInFolder).not.toHaveBeenCalled();
    expect(mockCreateDirectory.mock.invocationCallOrder[0]).toBeLessThan(
      mockOpenPath.mock.invocationCallOrder[0],
    );
    expect(BridgeAPI.createDirectory).toBeDefined();
    expect(ShellAPI.openPath).toBeDefined();
  });

  it('deletes a managed package from its file-library entry with a Material dialog', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm');
    renderPlugins();

    expect(
      screen.queryByRole('tab', { name: /Managed packages/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Delete managed package eezstreet-plugin-pack-2.0 (includes D2RPlugins.json)',
      }),
    );
    expect(
      await screen.findByText(
        'Are you sure you want to delete "eezstreet-plugin-pack-2.0"?',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('dialog', {
        name: 'Are you sure you want to delete "eezstreet-plugin-pack-2.0"?',
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockDeleteSource).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Delete managed package eezstreet-plugin-pack-2.0 (includes D2RPlugins.json)',
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mockDeleteSource).toHaveBeenCalledWith(
        {
          packageName: 'eezstreet-plugin-pack-2.0',
          sourcePath: 'D2RPlugins.json',
          sourceType: 'managed',
        },
        'a'.repeat(64),
      ),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('deletes a mod-supplied plugin file from the same file library', async () => {
    renderPlugins();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Delete mod-settings.json from mod Example Mod',
      }),
    );
    expect(
      await screen.findByText(
        'Are you sure you want to delete "mod-settings.json" from "Example Mod"?',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockDeleteSource).toHaveBeenCalledWith(
        {
          category: 'plugins',
          loaderRootPath: 'd2rloader',
          modID: 'Example Mod',
          sourcePath: 'mod-settings.json',
          sourceType: 'mod',
        },
        'd'.repeat(64),
      ),
    );
  });
});
