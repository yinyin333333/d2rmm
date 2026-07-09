import useModDropZone from 'renderer/react/hooks/useModDropZone';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInstallModFromZip = jest.fn();
const mockRefreshMods = jest.fn();
const mockShowToast = jest.fn();

jest.mock('renderer/ElectronUtilsAPI', () => ({
  getPathForFile: () => 'C:\\Mods\\Example.ZIP',
}));

jest.mock('renderer/ModUpdaterAPI', () => ({
  installModFromFolder: jest.fn(),
  installModFromZip: (...args: unknown[]) => mockInstallModFromZip(...args),
}));

jest.mock('renderer/react/context/ModsContext', () => ({
  useMods: () => [[], (...args: unknown[]) => mockRefreshMods(...args)],
}));

jest.mock(
  'renderer/react/hooks/useToast',
  () => () => (toast: unknown) => mockShowToast(toast),
);

function Probe(): JSX.Element {
  const handlers = useModDropZone();
  return (
    <div
      data-over={String(handlers.isDraggingOver)}
      data-testid="drop-zone"
      onDragEnter={handlers.onDragEnter}
      onDragLeave={handlers.onDragLeave}
      onDragOver={handlers.onDragOver}
      onDrop={handlers.onDrop}
    />
  );
}

describe('useModDropZone', () => {
  beforeEach(() => {
    mockInstallModFromZip.mockReset();
    mockRefreshMods.mockReset();
    mockShowToast.mockReset();
    mockInstallModFromZip.mockResolvedValue('Example');
    mockRefreshMods.mockResolvedValue([]);
  });

  it('accepts zip extensions case-insensitively', async () => {
    render(<Probe />);
    const file = new File(['zip'], 'Example.ZIP');

    fireEvent.drop(screen.getByTestId('drop-zone'), {
      dataTransfer: {
        files: [file],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
      },
    });

    await waitFor(() =>
      expect(mockRefreshMods).toHaveBeenCalledWith(['Example']),
    );
  });

  it('recovers from an unmatched drag-leave event', () => {
    render(<Probe />);
    const dropZone = screen.getByTestId('drop-zone');

    fireEvent.dragLeave(dropZone);
    fireEvent.dragEnter(dropZone);

    expect(dropZone.getAttribute('data-over')).toBe('true');
  });
});
