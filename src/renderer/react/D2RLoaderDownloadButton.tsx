import BridgeAPI from 'renderer/BridgeAPI';
import {
  useD2RLoaderConfigRefresh,
  useD2RLoaderSettings,
} from 'renderer/react/context/D2RLoaderSettingsContext';
import { useSanitizedGamePath } from 'renderer/react/context/GamePathContext';
import { useInstallationOperation } from 'renderer/react/context/InstallContext';
import useToast from 'renderer/react/hooks/useToast';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DownloadIcon from '@mui/icons-material/Download';
import { Button, CircularProgress, Tooltip } from '@mui/material';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function D2RLoaderDownloadButton(): JSX.Element {
  const { t } = useTranslation();
  const gamePath = useSanitizedGamePath();
  const [, setD2RLoaderSettings] = useD2RLoaderSettings();
  const [, refreshConfig] = useD2RLoaderConfigRefresh();
  const showToast = useToast();
  const [isInstalling, setIsInstalling] = useState(false);
  const { operation, finishOperation, tryStartOperation } =
    useInstallationOperation();

  const install = useCallback(async () => {
    const operationToken = tryStartOperation(
      t('install.progress.installingD2RLoader'),
    );
    if (operationToken == null) {
      showToast({
        duration: 4000,
        severity: 'info',
        title: t('install.disabled.activeOperation'),
      });
      return;
    }

    setIsInstalling(true);
    try {
      const result = await BridgeAPI.installD2RLoader(gamePath);
      setD2RLoaderSettings((settings) => ({
        ...settings,
        useD2RLoader: true,
      }));
      refreshConfig();
      if (result.status === 'already-current') {
        showToast({
          severity: 'info',
          title: t('d2rLoader.download.alreadyCurrent'),
          description:
            result.version == null
              ? undefined
              : t('d2rLoader.download.currentVersion', {
                  version: result.version,
                }),
          duration: 6000,
        });
      } else {
        showToast({
          severity: 'success',
          title: t('d2rLoader.download.success'),
          description: t('d2rLoader.download.success.description'),
          duration: 6000,
        });
      }
    } catch (error) {
      console.error(error);
      showToast({
        severity: 'error',
        title: t('d2rLoader.download.failed'),
        description: errorMessage(error),
      });
    } finally {
      setIsInstalling(false);
      finishOperation(operationToken);
    }
  }, [
    finishOperation,
    gamePath,
    refreshConfig,
    setD2RLoaderSettings,
    showToast,
    t,
    tryStartOperation,
  ]);

  const isBusyWithAnotherOperation = operation.active && !isInstalling;

  return (
    <Tooltip
      title={
        isBusyWithAnotherOperation
          ? t('install.disabled.activeOperation')
          : t('d2rLoader.download.tooltip')
      }
    >
      <span>
        <Button
          aria-label={t('d2rLoader.download.ariaLabel')}
          color="error"
          disabled={operation.active}
          onClick={() => void install()}
          startIcon={
            isInstalling ? (
              <CircularProgress color="inherit" size={16} />
            ) : (
              <DownloadIcon />
            )
          }
          sx={{
            fontWeight: 700,
            '& .MuiButton-startIcon': { marginRight: 0.25 },
          }}
        >
          {t(
            isInstalling
              ? 'd2rLoader.download.installing'
              : 'd2rLoader.download.button',
          )}
        </Button>
      </span>
    </Tooltip>
  );
}
