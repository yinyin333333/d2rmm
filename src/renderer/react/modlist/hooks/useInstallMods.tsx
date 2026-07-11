import type { IInstallModsOptions } from 'bridge/BridgeAPI';
import BridgeAPI from 'renderer/BridgeAPI';
import { useDataPath } from 'renderer/react/context/DataPathContext';
import { useD2RLoaderSettings } from 'renderer/react/context/D2RLoaderSettingsContext';
import { useSanitizedGamePath } from 'renderer/react/context/GamePathContext';
import { useIsInstalling } from 'renderer/react/context/InstallContext';
import { useIsDirectMode } from 'renderer/react/context/IsDirectModeContext';
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

export default function useInstallMods(
  isUninstall: boolean = false,
): () => Promise<boolean> {
  const { t } = useTranslation();
  const showToast = useToast();
  const dataPath = useDataPath();
  const [d2rLoaderSettings] = useD2RLoaderSettings();
  const gamePath = useSanitizedGamePath();
  const [isDirectMode] = useIsDirectMode();
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
    setIsInstalling(true);
    try {
      logger.clear();

      const options: IInstallModsOptions = {
        dataPath,
        gamePath,
        isDirectMode,
        isDryRun: isUninstall,
        useD2RLoader: d2rLoaderSettings.useD2RLoader,
        isPreExtractedData,
        mergedPath: outputPath,
        normalizeOutputCRLF,
        outputModName,
        preExtractedDataPath,
        savesPath,
      };

      console.debug(`Installing mods...`, options);
      const installedModIDs = await BridgeAPI.installMods(
        modsToInstall,
        options,
      );

      if (modsToInstall.length === 0) {
        showToast({
          severity: 'success',
          title: t(
            isUninstall
              ? 'install.toast.noMods.uninstall'
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
        throw new Error(
          t(
            isUninstall
              ? 'install.toast.error.uninstall'
              : 'install.toast.error.install',
          ),
        );
      }

      setInstalledMods(
        installedMods.map((mod) => ({ id: mod.id, config: mod.config })),
      );
      showToast({
        severity:
          installedMods.length < modsToInstall.length ? 'warning' : 'success',
        title: t(
          isUninstall
            ? 'install.toast.success.uninstall'
            : 'install.toast.success.install',
          {
            installed: installedMods.length,
            total: modsToInstall.length,
          },
        ),
      });
      return true;
    } catch (error) {
      console.error(error);
      showToast({
        severity: 'error',
        title: t(
          isUninstall
            ? 'install.toast.error.uninstall'
            : 'install.toast.error.install',
        ),
        description: localizeConsoleArgs([error as ConsoleArg]).join(' '),
      });
      // switch to the logs tab so user can see what happened
      setTab('logs');
      return false;
    } finally {
      setIsInstalling(false);
    }
  }, [
    dataPath,
    d2rLoaderSettings.useD2RLoader,
    gamePath,
    isDirectMode,
    isPreExtractedData,
    isUninstall,
    logger,
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
