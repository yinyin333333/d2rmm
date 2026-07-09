import { FileManager } from '../main/worker/FileManager';

describe('FileManager', () => {
  it('caches successful game-file checks', async () => {
    const isGameFile = jest.fn().mockResolvedValue(true);
    const manager = new FileManager({ BridgeAPI: { isGameFile } } as never);

    await expect(manager.gameFile('GLOBAL\\EXCEL\\armor.txt')).resolves.toBe(
      true,
    );
    await expect(manager.gameFile('global/excel/armor.txt')).resolves.toBe(
      true,
    );

    expect(isGameFile).toHaveBeenCalledTimes(1);
    expect(isGameFile).toHaveBeenCalledWith('global/excel/armor.txt');
  });
});
