import { useDialog } from 'renderer/react/context/DialogContext';
import { useIsLoadingMods } from 'renderer/react/context/ModsContext';
import useNexusAuthState from 'renderer/react/context/hooks/useNexusAuthState';
import CreateCollectionDialog from 'renderer/react/modlist/CreateCollectionDialog';
import { useTranslation } from 'react-i18next';
import { CloudUpload } from '@mui/icons-material';
import { MenuItem } from '@mui/material';

export default function CreateCollectionMenuItem({
  onHideMenu,
}: {
  onHideMenu: () => void;
}): JSX.Element | null {
  const { t } = useTranslation();
  const isLoadingMods = useIsLoadingMods();
  const { nexusAuthState } = useNexusAuthState();
  const [showDialog] = useDialog(<CreateCollectionDialog />);

  if (nexusAuthState.apiKey == null) {
    return null;
  }

  return (
    <MenuItem
      disabled={isLoadingMods}
      disableRipple={true}
      onClick={() => {
        if (isLoadingMods) {
          return;
        }

        showDialog();
        onHideMenu();
      }}
    >
      <CloudUpload sx={{ marginRight: 1 }} />
      {t('modlist.menu.createCollection')}
    </MenuItem>
  );
}
