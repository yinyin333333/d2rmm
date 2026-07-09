import type { Mod } from 'bridge/BridgeAPI';
import useModUpdater from 'renderer/react/modlist/hooks/useModUpdater';
import { render, screen } from '@testing-library/react';

jest.mock(
  'renderer/react/context/hooks/useModInstaller',
  () => () => jest.fn(),
);
jest.mock('renderer/react/context/hooks/useModUpdate', () => () => [
  {
    isUpdateAvailable: false,
    isUpdateChecked: false,
    nexusDownloads: [],
    nexusUpdates: [],
  },
]);
jest.mock('renderer/react/context/hooks/useNexusAuthState', () => () => ({
  nexusAuthState: { apiKey: null },
}));
jest.mock(
  'renderer/react/context/utils/useCheckModForUpdates',
  () => () => jest.fn(),
);

const mod = {
  id: 'example',
  info: {
    name: 'Example',
    website: 'https://www.nexusmods.com/diablo2resurrected/mods/123',
  },
} as Mod;

function Probe(): JSX.Element {
  const { isUpdatePossible } = useModUpdater(mod);
  return <span>{String(isUpdatePossible)}</span>;
}

describe('useModUpdater', () => {
  it('does not present Nexus update actions while signed out', () => {
    render(<Probe />);

    expect(screen.getByText('false')).not.toBeNull();
  });
});
