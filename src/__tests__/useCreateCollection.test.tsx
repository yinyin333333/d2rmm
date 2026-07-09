import type { Mod } from 'bridge/BridgeAPI';
import type { ICollectionPayload } from 'bridge/NexusModsAPI';
import useCreateCollection from 'renderer/react/context/hooks/useCreateCollection';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

const mockCreateCollection = jest.fn();
const mockGetModFiles = jest.fn();

jest.mock('renderer/BridgeAPI', () => ({
  readModConfig: jest.fn().mockResolvedValue(null),
}));
jest.mock('renderer/ModUpdaterAPI', () => ({
  createCollection: (...args: unknown[]) => mockCreateCollection(...args),
  getModFiles: (...args: unknown[]) => mockGetModFiles(...args),
  getMyCollections: jest.fn().mockResolvedValue([]),
  updateRevisionInstallationInfo: jest.fn().mockResolvedValue(undefined),
}));

const mod = {
  id: 'example',
  info: {
    name: 'Example',
    version: '1.0.0',
    website: 'https://www.nexusmods.com/diablo2resurrected/mods/123',
  },
} as Mod;

function Probe(): JSX.Element {
  const createCollection = useCreateCollection();
  const [done, setDone] = useState(false);
  return (
    <>
      <button
        onClick={async () => {
          await createCollection({
            authState: { apiKey: 'key', name: 'User' },
            mode: 'create',
            modConfigInclusion: { example: false },
            modRoles: { example: 'required' },
            mods: [mod],
            selectedCollectionId: null,
            title: 'Collection',
          });
          setDone(true);
        }}
      >
        Create
      </button>
      {done && <span>Done</span>}
    </>
  );
}

describe('useCreateCollection', () => {
  beforeEach(() => {
    mockCreateCollection.mockReset();
    mockGetModFiles.mockReset();
  });

  it('uses the selected fallback file version in the manifest', async () => {
    mockGetModFiles.mockResolvedValue([
      {
        fileId: 10,
        name: 'Newest',
        uploadedTimestamp: 20,
        version: '2.0.0',
      },
    ]);
    mockCreateCollection.mockResolvedValue({ collectionId: 1, revisionId: 2 });
    render(<Probe />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    });

    expect(screen.getByText('Done')).not.toBeNull();
    const payload = mockCreateCollection.mock.calls[0][1] as ICollectionPayload;
    expect(payload.collectionManifest.mods[0]).toMatchObject({
      source: { fileId: 10 },
      version: '2.0.0',
    });
  });
});
