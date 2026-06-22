import { useIsLoadingMods } from 'renderer/react/context/ModsContext';
import useCheckModsForUpdates from 'renderer/react/context/hooks/useCheckModsForUpdates';
import useNexusAuthState from 'renderer/react/context/hooks/useNexusAuthState';
import useAsyncCallback from 'renderer/react/hooks/useAsyncCallback';
import { useTranslation } from 'react-i18next';
import { Update } from '@mui/icons-material';
import { MenuItem } from '@mui/material';

export default function CheckForAllModUpdatesMenuItem({
  onHideMenu,
}: {
  onHideMenu: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const isLoadingMods = useIsLoadingMods();
  const { nexusAuthState } = useNexusAuthState();
  const checkModsForUpdates = useCheckModsForUpdates(nexusAuthState);

  const onCheckForUpdates = useAsyncCallback(async () => {
    if (isLoadingMods) {
      return;
    }

    onHideMenu();
    await checkModsForUpdates();
  }, [checkModsForUpdates, isLoadingMods, onHideMenu]);

  return (
    <MenuItem
      disabled={isLoadingMods}
      disableRipple={true}
      onClick={onCheckForUpdates}
    >
      <Update sx={{ marginRight: 1 }} />
      {t('modlist.menu.checkUpdates')}
    </MenuItem>
  );
}
