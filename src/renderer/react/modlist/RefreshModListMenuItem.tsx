import { useIsLoadingMods, useMods } from 'renderer/react/context/ModsContext';
import useAsyncCallback from 'renderer/react/hooks/useAsyncCallback';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Refresh } from '@mui/icons-material';
import { MenuItem } from '@mui/material';

export default function RefreshModListMenuItem({
  onHideMenu,
}: {
  onHideMenu: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const isLoadingMods = useIsLoadingMods();
  const [, onRefreshMods] = useMods();
  const [, setIsRefreshing] = useState(false);
  const onRefreshModList = useAsyncCallback(async () => {
    if (isLoadingMods) {
      return;
    }

    onHideMenu();
    setIsRefreshing(true);
    try {
      await onRefreshMods();
    } finally {
      setIsRefreshing(false);
    }
  }, [isLoadingMods, onHideMenu, onRefreshMods]);

  return (
    <MenuItem
      disabled={isLoadingMods}
      disableRipple={true}
      onClick={onRefreshModList}
    >
      <Refresh sx={{ marginRight: 1 }} />
      {t('modlist.menu.refresh')}
    </MenuItem>
  );
}
