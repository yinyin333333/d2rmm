import type { ModUpdaterDownload } from 'bridge/ModUpdaterAPI';
import type {
  IUpdates,
  IUpdateState,
} from 'renderer/react/context/UpdatesContext';
import { useUpdateModVersion } from 'renderer/react/context/hooks/useUpdateModVersion';
import { render } from '@testing-library/react';

const mockSetUpdates = jest.fn();
let mockUpdates: IUpdates;

jest.mock('renderer/react/context/hooks/useModUpdates', () => ({
  __esModule: true,
  default: () => [mockUpdates, mockSetUpdates],
}));

const DOWNLOADS: ModUpdaterDownload[] = [
  {
    type: 'nexus',
    modID: '100',
    fileID: 1001,
    version: '1.5.0',
  },
  {
    type: 'nexus',
    modID: '100',
    fileID: 1002,
    version: '2.0.0',
  },
];

function makeUpdateState(): IUpdateState {
  return {
    checkedVersion: '1.0.0',
    sourceNexusModID: '100',
    isUpdateChecked: true,
    isUpdateAvailable: true,
    nexusUpdates: DOWNLOADS,
    nexusDownloads: DOWNLOADS,
  };
}

function renderUseUpdateModVersion(): ReturnType<typeof useUpdateModVersion> {
  let result: ReturnType<typeof useUpdateModVersion> | undefined;

  function Probe(): null {
    result = useUpdateModVersion();
    return null;
  }

  render(<Probe />);
  if (result == null) {
    throw new Error('useUpdateModVersion did not initialize.');
  }
  return result;
}

describe('useUpdateModVersion', () => {
  beforeEach(() => {
    mockSetUpdates.mockReset();
    mockUpdates = new Map();
  });

  it('reports an existing cache before React runs the queued updater', async () => {
    mockUpdates.set('local-mod', makeUpdateState());
    const updateModVersion = renderUseUpdateModVersion();

    await expect(updateModVersion('local-mod', '1.5.0')).resolves.toBe(true);
    expect(mockSetUpdates).toHaveBeenCalledTimes(1);

    const updater = mockSetUpdates.mock.calls[0][0] as (
      updates: IUpdates,
    ) => IUpdates;
    const updated = updater(mockUpdates);
    expect(updated.get('local-mod')).toEqual({
      checkedVersion: '1.5.0',
      sourceNexusModID: '100',
      isUpdateChecked: true,
      isUpdateAvailable: true,
      nexusUpdates: [DOWNLOADS[1]],
      nexusDownloads: DOWNLOADS,
    });
  });

  it('reports a cache miss without scheduling an update', async () => {
    const updateModVersion = renderUseUpdateModVersion();

    await expect(updateModVersion('missing-mod', '1.5.0')).resolves.toBe(false);
    expect(mockSetUpdates).not.toHaveBeenCalled();
  });
});
