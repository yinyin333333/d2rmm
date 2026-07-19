import type { IInstallModsOptions } from 'bridge/BridgeAPI';
import BridgeAPI from 'renderer/BridgeAPI';
import { useD2RLoaderPluginManager } from 'renderer/react/context/D2RLoaderPluginContext';
import { useD2RLoaderSettings } from 'renderer/react/context/D2RLoaderSettingsContext';
import { useSanitizedGamePath } from 'renderer/react/context/GamePathContext';
import { useIsInstalling } from 'renderer/react/context/InstallContext';
import { useIsPreExtractedData } from 'renderer/react/context/IsPreExtractedDataContext';
import { useLogger } from 'renderer/react/context/LogContext';
import {
  useInstalledMods,
  useModsToInstall,
} from 'renderer/react/context/ModsContext';
import { useNormalizeCRLFOnInstall } from 'renderer/react/context/NormalizeCRLFOnInstallContext';
import { useOutputModName } from 'renderer/react/context/OutputModNameContext';
import { useOutputPath } from 'renderer/react/context/OutputPathContext';
import { usePreExtractedDataPath } from 'renderer/react/context/PreExtractedDataPathContext';
import { useFinalSavesPath } from 'renderer/react/context/SavesPathContext';
import { useTabState } from 'renderer/react/context/TabContext';
import useToast from 'renderer/react/hooks/useToast';
import { localizeConsoleArgs } from 'shared/i18n';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export default function useInstallMods(): () => Promise<boolean> {
  const { t } = useTranslation();
  const showToast = useToast();
  const {
    hasUnsavedEdits = false,
    isDeploymentChanged,
    isInventoryCurrent = true,
    isOutputModeChanged,
    markDeploymentInstalled,
    markDeploymentOutdated,
    markOutputModeInstalled,
  } = useD2RLoaderPluginManager();
  const [d2rLoaderSettings] = useD2RLoaderSettings();
  const gamePath = useSanitizedGamePath();
  const [isPreExtractedData] = useIsPreExtractedData();
  const [preExtractedDataPath] = usePreExtractedDataPath();
  const [outputModName] = useOutputModName();
  const [normalizeOutputCRLF] = useNormalizeCRLFOnInstall();
  const outputPath = useOutputPath();
  const logger = useLogger();
  const modsToInstall = useModsToInstall();
  const [, setInstalledMods] = useInstalledMods();
  const [, setIsInstalling] = useIsInstalling();
  const savesPath = useFinalSavesPath();

  const [, setTab] = useTabState();

  return useCallback(async (): Promise<boolean> => {
    if (
      d2rLoaderSettings.useD2RLoader &&
      (hasUnsavedEdits || !isInventoryCurrent)
    ) {
      showToast({
        severity: 'warning',
        title: hasUnsavedEdits
          ? 'Save or cancel D2RLoader file edits before installing.'
          : 'Refresh the D2RLoader plugin list before installing.',
      });
      setTab('plugins');
      return false;
    }
    setIsInstalling(true);
    try {
      logger.clear();

      const options: IInstallModsOptions = {
        gamePath,
        isDryRun: false,
        useD2RLoader: d2rLoaderSettings.useD2RLoader,
        isPreExtractedData,
        mergedPath: outputPath,
        normalizeOutputCRLF,
        outputModName,
        preExtractedDataPath,
        savesPath,
        syncD2RLoaderOutput:
          isOutputModeChanged ||
          (d2rLoaderSettings.useD2RLoader && isDeploymentChanged),
      };

      console.debug(`Installing mods...`, options);
      const installedModIDs = await BridgeAPI.installMods(
        modsToInstall,
        options,
      );

      const didSyncD2RLoaderOutput =
        options.syncD2RLoaderOutput === true &&
        (modsToInstall.length === 0 || installedModIDs.length > 0);
      const didApplyOutputMode =
        installedModIDs.length > 0 ||
        (modsToInstall.length === 0 && didSyncD2RLoaderOutput);
      if (didApplyOutputMode) {
        markOutputModeInstalled();
      }
      if (didSyncD2RLoaderOutput && d2rLoaderSettings.useD2RLoader) {
        markDeploymentInstalled();
      } else if (
        !d2rLoaderSettings.useD2RLoader &&
        (installedModIDs.length > 0 || didSyncD2RLoaderOutput)
      ) {
        // Rebuilding the non-loader output removes any previously deployed
        // managed data files. Make that visible if D2RLoader is enabled later.
        markDeploymentOutdated();
      }

      if (modsToInstall.length === 0) {
        if (didApplyOutputMode) {
          setInstalledMods([]);
        }
        showToast({
          severity: 'success',
          title: t(
            didSyncD2RLoaderOutput
              ? 'install.toast.output.install'
              : 'install.toast.noMods.install',
          ),
        });
        return true;
      }

      const installedModIDSet = new Set(installedModIDs);
      const installedMods = modsToInstall.filter(({ id }) =>
        installedModIDSet.has(id),
      );
      if (installedMods.length === 0) {
        throw new Error(t('install.toast.error.install'));
      }

      setInstalledMods(
        installedMods.map((mod) => ({ id: mod.id, config: mod.config })),
      );
      showToast({
        severity:
          installedMods.length < modsToInstall.length ? 'warning' : 'success',
        title: t('install.toast.success.install', {
          installed: installedMods.length,
          total: modsToInstall.length,
        }),
      });
      return true;
    } catch (error) {
      console.error(error);
      showToast({
        severity: 'error',
        title: t('install.toast.error.install'),
        description: localizeConsoleArgs([error as ConsoleArg]).join(' '),
      });
      // switch to the logs tab so user can see what happened
      setTab('logs');
      return false;
    } finally {
      setIsInstalling(false);
    }
  }, [
    d2rLoaderSettings.useD2RLoader,
    gamePath,
    hasUnsavedEdits,
    isPreExtractedData,
    isDeploymentChanged,
    isInventoryCurrent,
    isOutputModeChanged,
    logger,
    markDeploymentInstalled,
    markDeploymentOutdated,
    markOutputModeInstalled,
    modsToInstall,
    normalizeOutputCRLF,
    outputModName,
    outputPath,
    preExtractedDataPath,
    savesPath,
    setInstalledMods,
    setIsInstalling,
    setTab,
    showToast,
    t,
  ]);
}
