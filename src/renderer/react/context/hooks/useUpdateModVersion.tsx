import useModUpdates from 'renderer/react/context/hooks/useModUpdates';
import getUpdatesFromDownloads from 'renderer/react/context/utils/getUpdatesFromDownloads';
import { useCallback } from 'react';

export function useUpdateModVersion(): (
  modID: string,
  version: string,
) => Promise<boolean> {
  const [updates, setUpdates] = useModUpdates();

  return useCallback(
    async (modID: string, newVersion: string): Promise<boolean> => {
      if (!updates.has(modID)) {
        return false;
      }

      setUpdates((oldUpdates) => {
        const oldUpdateState = oldUpdates.get(modID);
        if (oldUpdateState == null) {
          return oldUpdates;
        }

        const nexusUpdates = getUpdatesFromDownloads(
          newVersion,
          oldUpdateState.nexusDownloads,
        );

        const newUpdates = new Map(oldUpdates);
        newUpdates.set(modID, {
          isUpdateChecked: true,
          isUpdateAvailable: nexusUpdates.length > 0,
          nexusUpdates,
          nexusDownloads: oldUpdateState.nexusDownloads,
        });
        return newUpdates;
      });
      return true;
    },
    [setUpdates, updates],
  );
}
