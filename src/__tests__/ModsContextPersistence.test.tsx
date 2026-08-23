import type { Mod } from 'bridge/BridgeAPI';
import type { ModConfig } from 'bridge/ModConfig';
import {
  ModsContextProvider,
  useInstalledMods,
  useIsInstallConfigChanged,
  useMods,
  useSaveModConfig,
  useSetModConfig,
} from 'renderer/react/context/ModsContext';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

const mockReadModConfig = jest.fn();
const mockReadModDirectory = jest.fn();
const mockReadModInfo = jest.fn();
const mockWriteModConfig = jest.fn();
const mockLogger = { error: jest.fn() };
const mockShowToast = jest.fn();
const mockConfigOverrides = {};
const mockSetConfigOverrides = jest.fn();
let mockSavedValues: Record<string, unknown> = {};

jest.mock('renderer/BridgeAPI', () => ({
  __esModule: true,
  default: {
    readModConfig: (...args: unknown[]) => mockReadModConfig(...args),
    readModDirectory: (...args: unknown[]) => mockReadModDirectory(...args),
    readModInfo: (...args: unknown[]) => mockReadModInfo(...args),
    writeModConfig: (...args: unknown[]) => mockWriteModConfig(...args),
  },
}));
jest.mock('renderer/react/BindingsParser', () => ({
  parseBinding: jest.fn(),
}));
jest.mock('renderer/react/context/LogContext', () => ({
  useLogger: () => mockLogger,
}));
jest.mock('renderer/react/context/hooks/useModsContextConfigOverrides', () => ({
  __esModule: true,
  default: () => [mockConfigOverrides, mockSetConfigOverrides],
}));
jest.mock('renderer/react/hooks/useSavedState', () => ({
  __esModule: true,
  default: function useMockSavedState(key: string, initialValue: unknown) {
    const React = require('react') as typeof import('react');
    return React.useState(
      Object.prototype.hasOwnProperty.call(mockSavedValues, key)
        ? mockSavedValues[key]
        : initialValue,
    );
  },
}));
jest.mock('renderer/react/hooks/useToast', () => ({
  __esModule: true,
  default: () => mockShowToast,
}));
jest.mock('renderer/utils/deferUntilAfterFirstPaint', () => ({
  __esModule: true,
  default: (callback: () => void) => {
    callback();
    return jest.fn();
  },
}));
jest.mock('shared/startupProfiler', () => ({
  startupMark: jest.fn(),
  startupMeasure: (_scope: string, _name: string, callback: () => unknown) =>
    callback(),
}));

let latestMods: Mod[] = [];
let latestDirty = false;
let installedModsAreArray = false;
let setModConfig: ReturnType<typeof useSetModConfig> | null = null;
let saveModConfig: ReturnType<typeof useSaveModConfig> | null = null;
let refreshMods: ((ids?: string[]) => Promise<Mod[]>) | null = null;

function Probe(): JSX.Element {
  const [mods, refresh] = useMods();
  const [installedMods] = useInstalledMods();
  latestMods = mods;
  latestDirty = useIsInstallConfigChanged();
  installedModsAreArray = Array.isArray(installedMods);
  setModConfig = useSetModConfig();
  saveModConfig = useSaveModConfig();
  refreshMods = refresh;
  return (
    <button onClick={() => setModConfig?.('A', { value: 'new' })}>
      update config
    </button>
  );
}

function info(id: string): ModConfig {
  return { name: id, type: 'd2rmm', version: '1.0.0' };
}

function renderProvider(): void {
  render(
    <ModsContextProvider>
      <Probe />
    </ModsContextProvider>,
  );
}

describe('ModsContext persistence state', () => {
  beforeEach(() => {
    latestMods = [];
    latestDirty = false;
    installedModsAreArray = false;
    setModConfig = null;
    saveModConfig = null;
    refreshMods = null;
    mockSavedValues = {};
    mockReadModConfig.mockReset().mockResolvedValue({ value: 'old' });
    mockReadModDirectory.mockReset().mockResolvedValue(['A']);
    mockReadModInfo.mockReset().mockResolvedValue(info('A'));
    mockWriteModConfig.mockReset().mockResolvedValue(undefined);
    mockLogger.error.mockReset();
    mockShowToast.mockReset();
  });

  it('uses an actual empty array for fresh installed-mods storage', () => {
    renderProvider();

    expect(installedModsAreArray).toBe(true);
  });

  it('shows a save error and keeps the changed config dirty after rejection', async () => {
    const failure = new Error('synthetic config write failure');
    mockSavedValues = {
      'enabled-mods': { A: true },
      'installed-mods': [{ id: 'A', config: { value: 'old' } }],
      'mods-order': ['A'],
    };
    mockWriteModConfig.mockRejectedValue(failure);
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    renderProvider();
    await waitFor(() => expect(latestMods).toHaveLength(1));
    expect(latestDirty).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'update config' }));
      await Promise.resolve();
    });

    expect(latestMods[0].config).toEqual({ value: 'new' });
    expect(latestDirty).toBe(true);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to save mod config',
      'A',
      failure,
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        title: expect.stringContaining('A'),
      }),
    );
    consoleError.mockRestore();
  });

  it('does not let a deferred save replace a newer local edit', async () => {
    let resolveOldSave!: () => void;
    const oldSave = new Promise<void>((resolve) => {
      resolveOldSave = resolve;
    });
    mockWriteModConfig
      .mockImplementationOnce(() => oldSave)
      .mockResolvedValueOnce(undefined);
    renderProvider();
    await waitFor(() => expect(latestMods).toHaveLength(1));

    let savingOld!: Promise<void>;
    act(() => {
      savingOld = saveModConfig!('A', { value: 'old-save' });
    });
    await waitFor(() => expect(mockWriteModConfig).toHaveBeenCalledTimes(1));

    act(() => setModConfig?.('A', { value: 'new' }));
    expect(latestMods[0].config).toEqual({ value: 'new' });
    expect(mockWriteModConfig).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveOldSave();
      await savingOld;
    });
    await waitFor(() => expect(mockWriteModConfig).toHaveBeenCalledTimes(2));
    expect(mockWriteModConfig.mock.calls).toEqual([
      ['A', { value: 'old-save' }],
      ['A', { value: 'new' }],
    ]);
    expect(latestMods[0].config).toEqual({ value: 'new' });
  });

  it('rejects saveModConfig when persistence fails', async () => {
    const failure = new Error('collection config write failure');
    mockWriteModConfig.mockRejectedValue(failure);
    renderProvider();
    await waitFor(() => expect(latestMods).toHaveLength(1));

    await expect(saveModConfig!('A', { value: 'collection' })).rejects.toBe(
      failure,
    );
    expect(latestMods[0].config).toEqual({ value: 'old' });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to save mod config',
      'A',
      failure,
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );

    mockReadModConfig.mockResolvedValue({ value: 'external' });
    await act(async () => {
      await refreshMods?.();
    });
    expect(latestMods[0].config).toEqual({ value: 'external' });
  });

  it('does not clear a newer optimistic edit when an older save fails', async () => {
    let rejectOldSave!: (error: Error) => void;
    const oldSave = new Promise<void>((_resolve, reject) => {
      rejectOldSave = reject;
    });
    let resolveNewEdit!: () => void;
    const newEdit = new Promise<void>((resolve) => {
      resolveNewEdit = resolve;
    });
    mockWriteModConfig
      .mockImplementationOnce(() => oldSave)
      .mockImplementationOnce(() => newEdit);
    renderProvider();
    await waitFor(() => expect(latestMods).toHaveLength(1));

    const savingOld = saveModConfig!('A', { value: 'collection' });
    await waitFor(() => expect(mockWriteModConfig).toHaveBeenCalledTimes(1));
    act(() => setModConfig?.('A', { value: 'newer' }));

    const failure = new Error('older collection save failed');
    rejectOldSave(failure);
    await expect(savingOld).rejects.toBe(failure);
    await waitFor(() => expect(mockWriteModConfig).toHaveBeenCalledTimes(2));

    mockReadModConfig.mockResolvedValue({ value: 'external' });
    await act(async () => {
      await refreshMods?.();
    });
    expect(latestMods[0].config).toEqual({ value: 'newer' });

    await act(async () => resolveNewEdit());
  });
});
