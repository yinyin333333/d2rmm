import { useD2RLoaderPluginManager } from 'renderer/react/context/D2RLoaderPluginContext';
import { useD2RLoaderSettings } from 'renderer/react/context/D2RLoaderSettingsContext';
import { useIsInstalling } from 'renderer/react/context/InstallContext';
import {
  useIsInstallConfigChanged,
  useIsLoadingMods,
} from 'renderer/react/context/ModsContext';
import useInstallMods from 'renderer/react/modlist/hooks/useInstallMods';
import { useTranslation } from 'react-i18next';
import { SaveOutlined } from '@mui/icons-material';
import Save from '@mui/icons-material/Save';
import { LoadingButton } from '@mui/lab';

export default function ModInstallButton(): JSX.Element {
  const { t } = useTranslation();
  const isInstallConfigChanged = useIsInstallConfigChanged();
  const {
    hasUnsavedEdits = false,
    isDeploymentChanged,
    isInventoryCurrent = true,
    isLoading: isLoadingPlugins,
    isMutating: isMutatingPlugins,
    isOutputModeChanged,
  } = useD2RLoaderPluginManager();
  const [d2rLoaderSettings] = useD2RLoaderSettings();
  const isLoadingMods = useIsLoadingMods();
  const [isInstalling] = useIsInstalling();
  const onInstallMods = useInstallMods();
  const hasPendingInstallation =
    isInstallConfigChanged ||
    isOutputModeChanged ||
    (d2rLoaderSettings.useD2RLoader && isDeploymentChanged);
  const isPluginStateLoading =
    d2rLoaderSettings.useD2RLoader && (isLoadingPlugins || isMutatingPlugins);
  const isPluginStateUnsafe =
    d2rLoaderSettings.useD2RLoader && (hasUnsavedEdits || !isInventoryCurrent);

  return (
    <LoadingButton
      disabled={
        isLoadingMods ||
        isPluginStateLoading ||
        isPluginStateUnsafe ||
        isInstalling
      }
      loading={isInstalling}
      loadingPosition="start"
      onClick={onInstallMods}
      startIcon={hasPendingInstallation ? <Save /> : <SaveOutlined />}
      title={
        isPluginStateUnsafe
          ? hasUnsavedEdits
            ? 'Save or cancel D2RLoader JSON edits before installing.'
            : 'Refresh the D2RLoader plugin list before installing.'
          : undefined
      }
      variant={hasPendingInstallation ? 'contained' : 'outlined'}
    >
      {t('install.button.install')}
    </LoadingButton>
  );
}
