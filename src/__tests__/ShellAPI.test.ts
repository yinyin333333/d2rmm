import { dialog } from 'electron';
import { selectDirectory } from '../main/ShellAPI';

jest.mock('electron', () => ({
  dialog: {
    showOpenDialog: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
    showItemInFolder: jest.fn(),
  },
}));

const showOpenDialog = dialog.showOpenDialog as jest.Mock;

describe('ShellAPI selectDirectory', () => {
  beforeEach(() => {
    showOpenDialog.mockReset();
  });

  it('returns the directory selected by the user', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['D:\\Games\\Diablo II Resurrected'],
    });

    await expect(selectDirectory('C:\\Games')).resolves.toBe(
      'D:\\Games\\Diablo II Resurrected',
    );
    expect(showOpenDialog).toHaveBeenCalledWith({
      defaultPath: 'C:\\Games',
      properties: ['openDirectory', 'createDirectory'],
    });
  });

  it('returns null when the picker is canceled', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });

    await expect(selectDirectory('')).resolves.toBeNull();
    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory', 'createDirectory'],
    });
  });
});
