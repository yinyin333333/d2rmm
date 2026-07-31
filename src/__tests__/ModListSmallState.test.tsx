import type { IOrderedItem } from 'renderer/react/context/ModsContext';
import ModList from 'renderer/react/modlist/ModList';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

const mockRefreshMods = jest.fn();
const mockReorderItems = jest.fn();
let mockOrderedItems: IOrderedItem[] = [];

jest.mock('renderer/AppInfoAPI', () => ({
  getAppPath: () => 'C:\\fake-app',
}));
jest.mock('renderer/ShellAPI', () => ({
  __esModule: true,
  default: { showItemInFolder: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('renderer/react/ReorderUtils', () => ({
  isOrderedSectionHeader: (item: IOrderedItem) => item.type === 'sectionHeader',
}));
jest.mock('renderer/react/context/ModsContext', () => ({
  useEnabledMods: () => [{}],
  useIsLoadingMods: () => false,
  useMods: () => [[], mockRefreshMods],
  useOrdereredItems: () => [mockOrderedItems, mockReorderItems],
}));
jest.mock('renderer/react/modlist/ModInstallButton', () => () => null);
jest.mock('renderer/react/modlist/ModListItem', () => ({
  __esModule: true,
  default: ({ mod }: { mod: { info: { name: string } } }) => (
    <span>{mod.info.name}</span>
  ),
}));
jest.mock('renderer/react/modlist/ModListSectionHeader', () => () => null);
jest.mock('renderer/react/modlist/AddSectionHeaderButton', () => () => null);
jest.mock('renderer/react/modlist/RefreshModListButton', () => () => null);
jest.mock('renderer/react/modlist/RunGameButton', () => () => null);
jest.mock('renderer/react/settings/ModSettingsDrawer', () => () => null);
jest.mock('renderer/utils/resolvePath', () => ({
  __esModule: true,
  default: (...parts: string[]) => parts.join('/'),
}));
jest.mock('react-beautiful-dnd', () => ({
  DragDropContext: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Droppable: ({
    children,
  }: {
    children: (provided: {
      droppableProps: Record<string, never>;
      innerRef: () => void;
      placeholder: null;
    }) => React.ReactNode;
  }) =>
    children({
      droppableProps: {},
      innerRef: () => undefined,
      placeholder: null,
    }),
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@mui/lab', () => ({
  LoadingButton: ({
    children,
    loading,
    onClick,
  }: {
    children: React.ReactNode;
    loading: boolean;
    onClick: () => void;
  }) => (
    <button data-loading={String(loading)} onClick={onClick}>
      {children}
    </button>
  ),
}));

describe('ModList small UI state', () => {
  beforeEach(() => {
    mockOrderedItems = [];
    mockRefreshMods.mockReset().mockResolvedValue([]);
    mockReorderItems.mockReset();
  });

  it('clears the refresh spinner even when refresh rejects', async () => {
    const failure = new Error('synthetic refresh failure');
    let rejectRefresh!: (error: Error) => void;
    mockRefreshMods.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRefresh = reject;
      }),
    );
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    render(<ModList />);
    const refresh = screen.getByRole('button', { name: 'modlist.refresh' });

    fireEvent.click(refresh);
    expect(refresh.getAttribute('data-loading')).toBe('true');

    await act(async () => rejectRefresh(failure));
    await waitFor(() =>
      expect(refresh.getAttribute('data-loading')).toBe('false'),
    );
    consoleError.mockRestore();
  });

  it('matches mod names case-insensitively while preserving lowercase search', async () => {
    mockOrderedItems = [
      {
        id: 'alpha',
        type: 'mod',
        mod: {
          config: {},
          id: 'alpha',
          info: { name: 'Alpha Mod', type: 'd2rmm', version: '1.0.0' },
        },
      },
    ];
    render(<ModList />);
    const search = screen.getByPlaceholderText('modlist.search');

    fireEvent.change(search, { target: { value: 'alpha' } });
    await waitFor(() => expect(screen.getByText('Alpha Mod')).toBeTruthy());

    fireEvent.change(search, { target: { value: 'ALPHA' } });
    await waitFor(() => expect(screen.getByText('Alpha Mod')).toBeTruthy());
  });
});
