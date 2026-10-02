import D2RLoaderLogExportButton from 'renderer/react/D2RLoaderLogExportButton';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockExport = jest.fn();
const mockToast = jest.fn();
jest.mock('renderer/ShellAPI', () => ({
  __esModule: true,
  default: { exportD2RLoaderLogs: (...args: unknown[]) => mockExport(...args) },
}));
jest.mock('renderer/react/context/GamePathContext', () => ({
  useSanitizedGamePath: () => 'C:\\Games\\Diablo II Resurrected',
}));
jest.mock('renderer/react/context/OutputModNameContext', () => ({
  useOutputModName: () => ['CustomMod'],
}));
jest.mock('renderer/react/hooks/useToast', () => ({
  __esModule: true,
  default: () => mockToast,
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  mockExport.mockReset();
  mockToast.mockReset();
});

it.each(['loader', 'loader-and-mod', 'all'])(
  'exports %s with the current game path and mod name',
  async (scope) => {
    mockExport.mockResolvedValue({
      path: 'C:\\chosen.zip',
      missingDirectories: [],
    });
    render(<D2RLoaderLogExportButton />);
    fireEvent.click(screen.getByRole('button', { name: 'logs.loader.export' }));
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(
      screen.getAllByText(/mods\/CustomMod\/d2rloader\/logs/),
    ).toHaveLength(2);
    fireEvent.click(
      screen.getByText(new RegExp(`logs.loader.scope.${scope}$`)),
    );
    await waitFor(() =>
      expect(mockExport).toHaveBeenCalledWith(
        'C:\\Games\\Diablo II Resurrected',
        'CustomMod',
        scope,
      ),
    );
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      ),
    );
  },
);

it('does not show a success message when saving is canceled', async () => {
  mockExport.mockResolvedValue(null);
  render(<D2RLoaderLogExportButton />);
  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(screen.getByText('1. logs.loader.scope.loader'));
  await waitFor(() =>
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  expect(mockToast).not.toHaveBeenCalled();
});
