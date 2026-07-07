import type { Mod } from 'bridge/BridgeAPI';
import { getModOpenPath } from '../renderer/react/modlist/ModListOpenAction';

function createMod(type: 'd2rmm' | 'data', id: string): Mod {
  return {
    id,
    info: {
      type,
      name: id,
    },
    config: {},
  };
}

describe('ModListOpenAction.getModOpenPath', () => {
  it('opens mod.json for D2RMM mods', async () => {
    const readDirectory = jest.fn();

    await expect(
      getModOpenPath(
        createMod('d2rmm', 'Example'),
        'C:\\D2RMM\\mods\\Example',
        readDirectory,
      ),
    ).resolves.toBe('C:\\D2RMM\\mods\\Example\\mod.json');
    expect(readDirectory).not.toHaveBeenCalled();
  });

  it('keeps opening direct data mod data folders', async () => {
    const readDirectory = jest.fn().mockResolvedValue([
      {
        name: 'data',
        isDirectory: true,
      },
    ]);

    await expect(
      getModOpenPath(
        createMod('data', 'DirectData'),
        'C:\\D2RMM\\mods\\DirectData',
        readDirectory,
      ),
    ).resolves.toBe('C:\\D2RMM\\mods\\DirectData\\data');
  });

  it('opens wrapper data mod folders through d2rloader', async () => {
    const readDirectory = jest.fn().mockResolvedValue([
      {
        name: 'Reimagined.mpq',
        isDirectory: true,
      },
      {
        name: 'd2rloader',
        isDirectory: true,
      },
    ]);

    await expect(
      getModOpenPath(
        createMod('data', 'Reimagined'),
        'C:\\D2RMM\\mods\\Reimagined',
        readDirectory,
      ),
    ).resolves.toBe('C:\\D2RMM\\mods\\Reimagined\\d2rloader');
  });

  it('opens wrapper data mod folders through the mpq folder without d2rloader', async () => {
    const readDirectory = jest.fn().mockResolvedValue([
      {
        name: 'Other.mpq',
        isDirectory: true,
      },
    ]);

    await expect(
      getModOpenPath(
        createMod('data', 'Other'),
        'C:\\D2RMM\\mods\\Other',
        readDirectory,
      ),
    ).resolves.toBe('C:\\D2RMM\\mods\\Other\\Other.mpq');
  });
});
