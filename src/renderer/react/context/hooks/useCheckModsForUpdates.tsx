import type { Mod } from 'bridge/BridgeAPI';
import type { ModUpdaterNexusDownload } from 'bridge/ModUpdaterAPI';
import ModUpdaterAPI from 'renderer/ModUpdaterAPI';
import { useMods } from 'renderer/react/context/ModsContext';
import { INexusAuthState } from 'renderer/react/context/NexusModsContext';
import useModUpdates from 'renderer/react/context/hooks/useModUpdates';
import getNexusModID from 'renderer/react/context/utils/getNexusModID';
import getUpdatesFromDownloads from 'renderer/react/context/utils/getUpdatesFromDownloads';
import useAsyncCallback from 'renderer/react/hooks/useAsyncCallback';
import useToast from 'renderer/react/hooks/useToast';
import { startupMark, startupMeasure } from 'shared/startupProfiler';
import { compareVersions } from 'shared/version';

export default function useCheckModsForUpdates(
  nexusAuthState: INexusAuthState,
): () => Promise<void> {
  const [mods] = useMods();
  const [, setUpdates] = useModUpdates();
  const showToast = useToast();

  return useAsyncCallback(async (): Promise<void> => {
    const modsToCheck = mods.filter((mod) => getNexusModID(mod) != null);
    if (nexusAuthState.apiKey == null || modsToCheck.length === 0) {
      startupMark('renderer', 'mod update check skipped');
      return;
    }

    const settledResults = await startupMeasure(
      'renderer',
      `mod update check for ${modsToCheck.length} mods`,
      () =>
        Promise.allSettled(
          modsToCheck.map(
            async (
              mod,
            ): Promise<
              [
                Mod,
                string,
                string,
                ModUpdaterNexusDownload[],
                ModUpdaterNexusDownload[],
              ]
            > => {
              const currentVersion = mod.info.version ?? '0';
              const nexusModID = getNexusModID(mod) as string;

              const nexusDownloads = (
                await ModUpdaterAPI.getDownloadsViaNexus(
                  nexusAuthState.apiKey as string,
                  nexusModID,
                )
              ).sort((a, b) => compareVersions(a.version, b.version));

              const nexusUpdates = getUpdatesFromDownloads(
                currentVersion,
                nexusDownloads,
              );

              return [
                mod,
                nexusModID,
                currentVersion,
                nexusDownloads,
                nexusUpdates,
              ];
            },
          ),
        ),
    );

    const results = settledResults.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const errors = settledResults.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    );

    if (results.length > 0) {
      setUpdates((oldUpdates) => {
        const newUpdates = new Map(oldUpdates);
        results.forEach(
          ([
            mod,
            sourceNexusModID,
            checkedVersion,
            nexusDownloads,
            nexusUpdates,
          ]) =>
            newUpdates.set(mod.id, {
              checkedVersion,
              sourceNexusModID,
              isUpdateChecked: true,
              isUpdateAvailable: nexusUpdates.length > 0,
              nexusUpdates,
              nexusDownloads,
            }),
        );
        return newUpdates;
      });
    }

    if (errors.length > 0) {
      const warning = `Failed to check updates for ${errors.length} of ${modsToCheck.length} mods. Check the logs.`;
      console.warn(warning, ...errors);
      showToast({ title: warning, severity: 'warning' });
    }
  }, [mods, nexusAuthState.apiKey, setUpdates, showToast]);
}
