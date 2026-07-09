import type { ModUpdaterDownload } from 'bridge/ModUpdaterAPI';
import type { IUpdateState } from 'renderer/react/context/UpdatesContext';
import { Context } from 'renderer/react/context/UpdatesContext';
import useModUpdates from 'renderer/react/context/hooks/useModUpdates';
import { useUpdateModVersion } from 'renderer/react/context/hooks/useUpdateModVersion';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

const downloads: ModUpdaterDownload[] = [
  {
    fileID: 1,
    modID: '123',
    type: 'nexus',
    version: '2.0.0',
  },
];

function Probe(): JSX.Element {
  const [updates] = useModUpdates();
  const updateVersion = useUpdateModVersion();
  const [result, setResult] = useState<boolean | null>(null);

  return (
    <>
      <button
        onClick={async () => setResult(await updateVersion('example', '2.0.0'))}
      >
        Update
      </button>
      <span>{String(result)}</span>
      <span>{String(updates.get('example')?.isUpdateAvailable)}</span>
    </>
  );
}

function Harness(): JSX.Element {
  const [updates, setUpdates] = useState(
    new Map<string, IUpdateState>([
      [
        'example',
        {
          isUpdateAvailable: true,
          isUpdateChecked: true,
          nexusDownloads: downloads,
          nexusUpdates: downloads,
        },
      ],
    ]),
  );
  return (
    <Context.Provider value={{ updates, setUpdates }}>
      <Probe />
    </Context.Provider>
  );
}

describe('useUpdateModVersion', () => {
  it('reports that cached update data was updated', async () => {
    render(<Harness />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    });

    expect(screen.getByText('true')).not.toBeNull();
    expect(screen.queryByText('false')).not.toBeNull();
  });
});
