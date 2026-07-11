import type { Mod } from 'bridge/BridgeAPI';
import type { ModConfig } from 'bridge/ModConfig';
import {
  ModsContextProvider,
  useInstalledMods,
  useIsInstallConfigChanged,
  useMods,
  useSetModConfig,
} from 'renderer/react/context/ModsContext';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

function Probe(): JSX.Element {
  const [mods] = useMods();
  const [installedMods] = useInstalledMods();
  latestMods = mods;
  latestDirty = useIsInstallConfigChanged();
  installedModsAreArray = Array.isArray(installedMods);
  setModConfig = useSetModConfig();
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
});
