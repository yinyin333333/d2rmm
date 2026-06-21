import BridgeAPI from 'renderer/BridgeAPI';
import { useD2RLoaderSettings } from 'renderer/react/context/D2RLoaderSettingsContext';
import { useSanitizedGamePath } from 'renderer/react/context/GamePathContext';
import { useInstallBeforeRun } from 'renderer/react/context/InstallBeforeRunContext';
import { useIsInstallConfigChanged } from 'renderer/react/context/ModsContext';
import { useOutputModName } from 'renderer/react/context/OutputModNameContext';
import useAsyncCallback from 'renderer/react/hooks/useAsyncCallback';
import useGameLaunchArgs from 'renderer/react/hooks/useGameLaunchArgs';
import useInstallMods from 'renderer/react/modlist/hooks/useInstallMods';
import resolvePath from 'renderer/utils/resolvePath';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PlayCircleFilled,
  PlayCircleOutlineOutlined,
} from '@mui/icons-material';
import { Button, Tooltip } from '@mui/material';

type Props = Record<string, never>;

export default function RunGameButton(_props: Props): JSX.Element {
  const { t } = useTranslation();
  const isInstallConfigChanged = useIsInstallConfigChanged();

  const gamePath = useSanitizedGamePath();
  const args = useGameLaunchArgs();
  const [outputModName] = useOutputModName();
  const [d2rLoaderSettings] = useD2RLoaderSettings();
  const command = useMemo(
    () =>
      [
        d2rLoaderSettings.useD2RLoader ? 'D2RLoader.exe' : 'D2R.exe',
        ...args,
      ].join(' '),
    [args, d2rLoaderSettings.useD2RLoader],
  );

  const [isInstallBeforeRunEnabled] = useInstallBeforeRun();

  const onInstallMods = useInstallMods();

  const onPress = useAsyncCallback(async () => {
    if (isInstallBeforeRunEnabled) {
      if (!(await onInstallMods())) {
        return;
      }
    }
    if (d2rLoaderSettings.useD2RLoader) {
      const pathD2RLoaderExe = resolvePath(gamePath, 'D2RLoader.exe');
      await BridgeAPI.prepareD2RLoaderLaunch(gamePath, {
        defaultMod: outputModName,
        skipTitleScreen: d2rLoaderSettings.skipTitleScreen,
        showGroundSockets: d2rLoaderSettings.showGroundSockets,
        extraSharedTabs: d2rLoaderSettings.extraSharedTabs,
        forceTcpip: d2rLoaderSettings.forceTcpip,
        globalPlugins: d2rLoaderSettings.globalPlugins,
        devConsole: d2rLoaderSettings.devConsole,
        detectEarlyCrashes: d2rLoaderSettings.detectEarlyCrashes,
        damageIndicator: d2rLoaderSettings.damageIndicator,
        jsonResourceLoads: d2rLoaderSettings.jsonResourceLoads,
      });
      await BridgeAPI.execute(pathD2RLoaderExe, args);
      return;
    }

    const pathD2rExe = resolvePath(gamePath, 'D2R.exe');
    await BridgeAPI.execute(pathD2rExe, args);
  }, [
    isInstallBeforeRunEnabled,
    onInstallMods,
    d2rLoaderSettings,
    gamePath,
    outputModName,
    args,
  ]);

  const tooltipText = isInstallConfigChanged
    ? `${t('run.tooltip', { command })} ${t('run.tooltip.unsaved')}`
    : t('run.tooltip', { command });

  return (
    <Tooltip title={tooltipText}>
      <Button
        onClick={onPress}
        startIcon={
          !isInstallConfigChanged ? (
            <PlayCircleFilled />
          ) : (
            <PlayCircleOutlineOutlined />
          )
        }
        variant={!isInstallConfigChanged ? 'contained' : 'outlined'}
      >
        {t('run.button')}
      </Button>
    </Tooltip>
  );
}
