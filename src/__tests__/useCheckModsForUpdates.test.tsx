import type { Mod } from 'bridge/BridgeAPI';
import type { ModUpdaterDownload } from 'bridge/ModUpdaterAPI';
import type {
  IUpdates,
  IUpdateState,
} from 'renderer/react/context/UpdatesContext';
import useCheckModsForUpdates from 'renderer/react/context/hooks/useCheckModsForUpdates';
import { render } from '@testing-library/react';

type SourceAwareUpdateState = IUpdateState & {
  checkedVersion: string | null;
  sourceNexusModID: string | null;
};

type Deferred<T> = {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
};

const mockGetDownloadsViaNexus = jest.fn();
const mockSetUpdates = jest.fn();
const mockShowToast = jest.fn();
let mockMods: Mod[] = [];
let mockUpdates: IUpdates = new Map();

jest.mock('renderer/ModUpdaterAPI', () => ({
  __esModule: true,
  default: {
    getDownloadsViaNexus: (...args: unknown[]) =>
      mockGetDownloadsViaNexus(...args),
  },
}));

jest.mock('renderer/react/context/ModsContext', () => ({
  useMods: () => [mockMods, jest.fn()],
}));

jest.mock('renderer/react/context/hooks/useModUpdates', () => ({
  __esModule: true,
  default: () => [mockUpdates, mockSetUpdates],
}));

jest.mock('renderer/react/hooks/useAsyncCallback', () => ({
  __esModule: true,
  default: (callback: (...args: unknown[]) => unknown) => callback,
}));

jest.mock('renderer/react/hooks/useToast', () => ({
  __esModule: true,
  default: () => mockShowToast,
}));

jest.mock('shared/startupProfiler', () => ({
  startupMark: jest.fn(),
  startupMeasure: (
    _process: string,
    _label: string,
    callback: () => unknown,
  ) => callback(),
}));

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    reject: (error) => rejectPromise?.(error),
    resolve: (value) => resolvePromise?.(value),
  };
}

function makeMod(id: string, nexusModID: string): Mod {
  return {
    id,
    info: {
      type: 'd2rmm',
      name: id,
      version: '1.0.0',
      website: `https://www.nexusmods.com/diablo2resurrected/mods/${nexusModID}`,
    },
    config: {},
  };
}

function makeDownload(nexusModID: string): ModUpdaterDownload {
  return {
    type: 'nexus',
    modID: nexusModID,
    fileID: Number(nexusModID) * 10,
    version: '2.0.0',
  };
}

function renderUseCheckModsForUpdates(): ReturnType<
  typeof useCheckModsForUpdates
> {
  let checkMods: ReturnType<typeof useCheckModsForUpdates> | undefined;

  function Probe(): null {
    checkMods = useCheckModsForUpdates({ apiKey: 'fake-api-key' });
    return null;
  }

  render(<Probe />);
  if (checkMods == null) {
    throw new Error('useCheckModsForUpdates did not initialize.');
  }
  return checkMods;
}

describe('useCheckModsForUpdates per-mod settlement', () => {
  beforeEach(() => {
    mockGetDownloadsViaNexus.mockReset();
    mockSetUpdates.mockReset();
    mockShowToast.mockReset();
    mockMods = [
      makeMod('mod-a', '100'),
      makeMod('mod-b', '200'),
      makeMod('mod-c', '300'),
    ];
    mockUpdates = new Map();
    mockSetUpdates.mockImplementation((update) => {
      mockUpdates =
        typeof update === 'function' ? update(mockUpdates) : update;
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps successful results when one concurrent request fails', async () => {
    const requests = new Map<string, Deferred<ModUpdaterDownload[]>>([
      ['100', deferred<ModUpdaterDownload[]>()],
      ['200', deferred<ModUpdaterDownload[]>()],
      ['300', deferred<ModUpdaterDownload[]>()],
    ]);
    mockGetDownloadsViaNexus.mockImplementation(
      (_apiKey: string, nexusModID: string) =>
        requests.get(nexusModID)?.promise,
    );
    const previousFailureState = {
      checkedVersion: '0.9.0',
      sourceNexusModID: '200',
      isUpdateChecked: true,
      isUpdateAvailable: false,
      nexusUpdates: [],
      nexusDownloads: [],
    } as SourceAwareUpdateState;
    mockUpdates.set('mod-b', previousFailureState);

    const checkPromise = renderUseCheckModsForUpdates()();
    expect(mockGetDownloadsViaNexus).toHaveBeenCalledTimes(3);

    requests.get('100')?.resolve([makeDownload('100')]);
    const requestError = new Error('429 Too Many Requests');
    requests.get('200')?.reject(requestError);
    requests.get('300')?.resolve([makeDownload('300')]);

    await expect(checkPromise).resolves.toBeUndefined();

    expect(mockUpdates.get('mod-a')).toEqual(
      expect.objectContaining({
        checkedVersion: '1.0.0',
        sourceNexusModID: '100',
        isUpdateChecked: true,
      }),
    );
    expect(mockUpdates.get('mod-b')).toBe(previousFailureState);
    expect(mockUpdates.get('mod-c')).toEqual(
      expect.objectContaining({
        checkedVersion: '1.0.0',
        sourceNexusModID: '300',
        isUpdateChecked: true,
      }),
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('1 of 3'),
      requestError,
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning' }),
    );
  });

  it('preserves normal results when every request succeeds', async () => {
    mockGetDownloadsViaNexus.mockImplementation(
      async (_apiKey: string, nexusModID: string) => [
        makeDownload(nexusModID),
      ],
    );

    await renderUseCheckModsForUpdates()();

    expect(mockUpdates.size).toBe(3);
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
