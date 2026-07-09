import ModList from 'renderer/react/modlist/ModList';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mod = {
  config: {},
  id: 'example',
  info: { name: 'Example Mod' },
};
const mockOrderedItems = [{ id: mod.id, mod, type: 'mod' }];

jest.mock('renderer/AppInfoAPI', () => ({
  getAppPath: () => 'C:\\D2RMM',
}));
jest.mock('renderer/ShellAPI', () => ({
  showItemInFolder: jest.fn(),
}));
jest.mock('renderer/react/context/IsDirectModeContext', () => ({
  useIsDirectMode: () => [false],
}));
jest.mock('renderer/react/context/ModsContext', () => ({
  useEnabledMods: () => [{}],
  useIsLoadingMods: () => false,
  useMods: () => [[], jest.fn()],
  useOrdereredItems: () => [mockOrderedItems, jest.fn()],
}));
jest.mock('renderer/react/modlist/ModInstallButton', () => () => null);
jest.mock(
  'renderer/react/modlist/ModListItem',
  () =>
    ({ mod: item }: { mod: { info: { name: string } } }) => (
      <span>{item.info.name}</span>
    ),
);
jest.mock('renderer/react/modlist/ModListSectionHeader', () => () => null);
jest.mock('renderer/react/modlist/OverflowActionsButton', () => () => null);
jest.mock('renderer/react/modlist/RunGameButton', () => () => null);
jest.mock('renderer/react/settings/ModSettingsDrawer', () => () => null);

describe('ModList search', () => {
  it('matches mod names case-insensitively', async () => {
    render(<ModList />);

    fireEvent.change(screen.getByPlaceholderText('Search...'), {
      target: { value: 'EXAMPLE' },
    });

    await waitFor(() =>
      expect(screen.queryByText('Example Mod')).not.toBeNull(),
    );
  });
});
