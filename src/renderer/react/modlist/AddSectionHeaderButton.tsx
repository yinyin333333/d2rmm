import { useAddSectionHeader } from 'renderer/react/context/ModsContext';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Add } from '@mui/icons-material';
import { Button } from '@mui/material';

export default function AddSectionHeaderButton(): JSX.Element {
  const { t } = useTranslation();
  const addSectionHeader = useAddSectionHeader();
  const onAddSectionHeader = useCallback(() => {
    addSectionHeader();
    // TODO: scroll list to end
  }, [addSectionHeader]);

  return (
    <Button onClick={onAddSectionHeader} startIcon={<Add />} variant="outlined">
      {t('modlist.menu.addSection')}
    </Button>
  );
}
