import { dialog, shell } from 'electron';
import { openPath, selectDirectory } from '../main/ShellAPI';
import { stat } from 'fs/promises';

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
}));

jest.mock('electron', () => ({
  dialog: {
    showOpenDialog: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
    openPath: jest.fn(),
    showItemInFolder: jest.fn(),
  },
}));

const showOpenDialog = dialog.showOpenDialog as jest.Mock;
const shellOpenPath = shell.openPath as jest.Mock;
const statPath = stat as jest.Mock;

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

describe('ShellAPI openPath', () => {
  beforeEach(() => {
    shellOpenPath.mockReset();
    statPath.mockReset().mockResolvedValue({ isDirectory: () => true });
  });

  it('opens a directory directly in the system file explorer', async () => {
    shellOpenPath.mockResolvedValue('');

    await expect(openPath('C:\\D2RMM\\d2rloader')).resolves.toBeUndefined();
    expect(shellOpenPath).toHaveBeenCalledWith('C:\\D2RMM\\d2rloader');
  });

  it('rejects when Electron reports that the path could not be opened', async () => {
    shellOpenPath.mockResolvedValue(
      'The system cannot find the path specified.',
    );

    await expect(openPath('C:\\missing')).rejects.toThrow(
      'The system cannot find the path specified.',
    );
  });

  it('rejects files instead of asking the operating system to execute them', async () => {
    statPath.mockResolvedValue({ isDirectory: () => false });

    await expect(openPath('C:\\untrusted.exe')).rejects.toThrow(
      'Path is not a directory',
    );
    expect(shellOpenPath).not.toHaveBeenCalled();
  });
});
