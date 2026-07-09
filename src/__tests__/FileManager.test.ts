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

  it('tracks file names that match object prototype properties', async () => {
    const manager = new FileManager({} as never);
    const data = Buffer.from('content');

    try {
      manager.setData('__proto__', data);
      await manager.write('__proto__', 'example');

      expect(manager.getData('__proto__')).toBe(data);
      expect(manager.getModifiedFiles()).toEqual([
        { filePath: '__proto__', data },
      ]);
    } finally {
      Reflect.deleteProperty(Object.prototype, 'data');
      Reflect.deleteProperty(Object.prototype, 'exists');
    }
  });
});
