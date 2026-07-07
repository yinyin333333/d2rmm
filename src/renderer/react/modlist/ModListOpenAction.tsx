import type { Mod } from 'bridge/BridgeAPI';
import { getAppPath } from 'renderer/AppInfoAPI';
import BridgeAPI from 'renderer/BridgeAPI';
import ShellAPI from 'renderer/ShellAPI';
import useAsyncCallback from 'renderer/react/hooks/useAsyncCallback';
import ModListMenuItem from 'renderer/react/modlist/ModListMenuItem';
import resolvePath from 'renderer/utils/resolvePath';
import { useTranslation } from 'react-i18next';
import { Folder } from '@mui/icons-material';

type ReadDirectory = typeof BridgeAPI.readDirectory;

export async function getModOpenPath(
  mod: Mod,
  modPath: string,
  readDirectory: ReadDirectory = BridgeAPI.readDirectory,
): Promise<string> {
  if (mod.info.type !== 'data') {
    return resolvePath(modPath, 'mod.json');
  }

  const entries = await readDirectory(modPath);
  const dataEntry = entries.find((entry) => {
    return entry.isDirectory && entry.name.toLowerCase() === 'data';
  });
  if (dataEntry != null) {
    return resolvePath(modPath, dataEntry.name);
  }

  const d2rLoaderEntry = entries.find((entry) => {
    return entry.isDirectory && entry.name.toLowerCase() === 'd2rloader';
  });
  if (d2rLoaderEntry != null) {
    return resolvePath(modPath, d2rLoaderEntry.name);
  }

  const mpqEntry = entries.find((entry) => {
    return entry.isDirectory && entry.name.toLowerCase().endsWith('.mpq');
  });
  if (mpqEntry != null) {
    return resolvePath(modPath, mpqEntry.name);
  }

  return modPath;
}

export function ModListOpenMenuItem({ mod }: { mod: Mod }) {
  const { t } = useTranslation();
  const appPath = getAppPath();
  const modPath = resolvePath(appPath, 'mods', mod.id);

  const onOpen = useAsyncCallback(async () => {
    await ShellAPI.showItemInFolder(await getModOpenPath(mod, modPath));
  }, [mod, modPath]);

  return (
    <ModListMenuItem
      icon={<Folder />}
      label={t('modlist.action.open')}
      onClick={onOpen}
    />
  );
}
