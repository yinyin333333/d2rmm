import { useIsLoadingMods, useMods } from 'renderer/react/context/ModsContext';
import useAsyncCallback from 'renderer/react/hooks/useAsyncCallback';
import { useTranslation } from 'react-i18next';
import { Refresh } from '@mui/icons-material';
import { Button } from '@mui/material';

export default function RefreshModListButton(): JSX.Element {
  const { t } = useTranslation();
  const isLoadingMods = useIsLoadingMods();
  const [, onRefreshMods] = useMods();
  const onRefreshModList = useAsyncCallback(async () => {
    if (isLoadingMods) {
      return;
    }

    await onRefreshMods();
  }, [isLoadingMods, onRefreshMods]);

  return (
    <Button
      disabled={isLoadingMods}
      onClick={onRefreshModList}
      startIcon={<Refresh />}
      variant="outlined"
    >
      {t('modlist.menu.refresh')}
    </Button>
  );
}
