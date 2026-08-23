import type { Mod } from 'bridge/BridgeAPI';
import type { ModConfig } from 'bridge/ModConfig';
import {
  ModsContextProvider,
  useMods,
  useSetModConfig,
} from 'renderer/react/context/ModsContext';
import { act, render, screen, waitFor } from '@testing-library/react';

const mockReadModConfig = jest.fn();
const mockReadModDirectory = jest.fn();
const mockReadModInfo = jest.fn();
const mockWriteModConfig = jest.fn();
const mockLogger = { error: jest.fn() };
const mockShowToast = jest.fn();
const mockConfigOverrides = {};
const mockSetConfigOverrides = jest.fn();

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
  default: function useMockSavedState(_key: string, initialValue: unknown) {
    const React = require('react') as typeof import('react');
    return React.useState(initialValue);
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

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function info(id: string): ModConfig {
  return { name: id, type: 'd2rmm', version: '1.0.0' };
}

let refreshMods: ((ids?: string[]) => Promise<Mod[]>) | undefined;
let latestMods: Mod[] = [];
let setModConfig: ReturnType<typeof useSetModConfig> | undefined;

function Probe(): JSX.Element {
  const [mods, refresh] = useMods();
  refreshMods = refresh;
  latestMods = mods;
  setModConfig = useSetModConfig();
  return <output>{mods.map(({ id }) => id).join(',')}</output>;
}

function renderProvider(): void {
  render(
    <ModsContextProvider>
      <Probe />
    </ModsContextProvider>,
  );
}

describe('ModsContext initial/full and partial refresh ordering', () => {
  beforeEach(() => {
    refreshMods = undefined;
    latestMods = [];
    setModConfig = undefined;
    mockReadModConfig.mockReset().mockResolvedValue({});
    mockReadModDirectory.mockReset().mockResolvedValue(['A']);
    mockReadModInfo.mockReset();
    mockWriteModConfig.mockReset().mockResolvedValue(undefined);
  });

  it('keeps a newly installed partial mod when the older initial scan finishes', async () => {
    const initialA = deferred<ModConfig | null>();
    mockReadModInfo.mockImplementation((id: string) =>
      id === 'A' ? initialA.promise : Promise.resolve(info(id)),
    );
    renderProvider();
    await waitFor(() => expect(mockReadModInfo).toHaveBeenCalledWith('A'));

    await act(async () => {
      await refreshMods?.(['B']);
    });
    expect(screen.getByText('B')).toBeTruthy();

    await act(async () => initialA.resolve(info('A')));
    await waitFor(() => expect(screen.getByText('A,B')).toBeTruthy());
  });

  it('does not resurrect a mod deleted by a partial refresh during initial scan', async () => {
    const initialA = deferred<ModConfig | null>();
    mockReadModInfo
      .mockImplementationOnce(() => initialA.promise)
      .mockResolvedValueOnce(null);
    renderProvider();
    await waitFor(() => expect(mockReadModInfo).toHaveBeenCalledTimes(1));

    await act(async () => {
      await refreshMods?.(['A']);
    });
    expect(document.querySelector('output')?.textContent).toBe('');

    await act(async () => initialA.resolve(info('A')));
    await waitFor(() =>
      expect(document.querySelector('output')?.textContent).toBe(''),
    );
  });

  it('keeps a partial install that completes during an older full refresh', async () => {
    mockReadModInfo.mockImplementation((id: string) =>
      Promise.resolve(info(id)),
    );
    renderProvider();
    await waitFor(() => expect(screen.getByText('A')).toBeTruthy());

    const fullRefreshA = deferred<ModConfig | null>();
    mockReadModInfo.mockImplementation((id: string) =>
      id === 'A' ? fullRefreshA.promise : Promise.resolve(info(id)),
    );
    let fullRefresh!: Promise<Mod[]>;
    act(() => {
      fullRefresh = refreshMods!();
    });
    await waitFor(() => expect(mockReadModInfo).toHaveBeenCalledTimes(2));

    await act(async () => {
      await refreshMods?.(['B']);
    });
    expect(screen.getByText('A,B')).toBeTruthy();

    await act(async () => {
      fullRefreshA.resolve(info('A'));
      await fullRefresh;
    });
    expect(screen.getByText('A,B')).toBeTruthy();
  });

  it('keeps config edited after a full refresh already read stale config', async () => {
    mockReadModInfo.mockImplementation((id: string) =>
      Promise.resolve(info(id)),
    );
    mockReadModConfig.mockResolvedValue({ value: 'initial' });
    renderProvider();
    await waitFor(() => expect(latestMods).toHaveLength(1));

    const pendingBConfig = deferred<{ value: string }>();
    mockReadModDirectory.mockResolvedValue(['A', 'B']);
    mockReadModConfig.mockImplementation((id: string) =>
      id === 'A' ? Promise.resolve({ value: 'stale' }) : pendingBConfig.promise,
    );
    let fullRefresh!: Promise<Mod[]>;
    act(() => {
      fullRefresh = refreshMods!();
    });
    await waitFor(() => expect(mockReadModConfig).toHaveBeenCalledWith('B'));

    act(() => setModConfig?.('A', { value: 'new' }));
    expect(latestMods[0].config).toEqual({ value: 'new' });

    await act(async () => {
      pendingBConfig.resolve({ value: 'b' });
      await fullRefresh;
    });
    expect(latestMods.find(({ id }) => id === 'A')?.config).toEqual({
      value: 'new',
    });
  });

  it('keeps config whose persistence was pending when a full refresh started', async () => {
    mockReadModInfo.mockImplementation((id: string) =>
      Promise.resolve(info(id)),
    );
    mockReadModConfig.mockResolvedValue({ value: 'old' });
    renderProvider();
    await waitFor(() => expect(latestMods).toHaveLength(1));

    const pendingWrite = deferred<void>();
    mockWriteModConfig.mockReturnValueOnce(pendingWrite.promise);
    act(() => setModConfig?.('A', { value: 'new' }));
    await waitFor(() => expect(mockWriteModConfig).toHaveBeenCalledTimes(1));

    await act(async () => {
      await refreshMods?.();
    });
    expect(latestMods[0].config).toEqual({ value: 'new' });

    await act(async () => pendingWrite.resolve(undefined));
    mockReadModConfig.mockResolvedValue({ value: 'external' });
    await act(async () => {
      await refreshMods?.();
    });
    expect(latestMods[0].config).toEqual({ value: 'external' });
  });

  it('loads mods with bounded concurrency while preserving directory order', async () => {
    const ids = ['A', 'B', 'C', 'D', 'E', 'F'];
    const configs = new Map(
      ids.map((id) => [id, deferred<Record<string, never>>()]),
    );
    mockReadModDirectory.mockResolvedValue(ids);
    mockReadModInfo.mockImplementation((id: string) =>
      Promise.resolve(info(id)),
    );
    mockReadModConfig.mockImplementation(
      (id: string) => configs.get(id)!.promise,
    );

    renderProvider();
    await waitFor(() => expect(mockReadModConfig).toHaveBeenCalledTimes(4));
    expect(mockReadModConfig.mock.calls.map(([id]) => id)).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);

    await act(async () => configs.get('D')!.resolve({}));
    await waitFor(() => expect(mockReadModConfig).toHaveBeenCalledTimes(5));
    expect(mockReadModConfig).toHaveBeenLastCalledWith('E');
    await act(async () => configs.get('B')!.resolve({}));
    await waitFor(() => expect(mockReadModConfig).toHaveBeenCalledTimes(6));
    expect(mockReadModConfig).toHaveBeenLastCalledWith('F');

    await act(async () => {
      configs.get('A')!.resolve({});
      configs.get('C')!.resolve({});
      configs.get('E')!.resolve({});
      configs.get('F')!.resolve({});
    });
    await waitFor(() => expect(screen.getByText(ids.join(','))).toBeTruthy());
  });
});
