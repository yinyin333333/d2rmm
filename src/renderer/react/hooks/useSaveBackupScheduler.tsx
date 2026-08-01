import BridgeAPI from 'renderer/BridgeAPI';
import {
  normalizeSaveBackupIntervalMinutes,
  useSaveBackupSettings,
} from 'renderer/react/context/SaveBackupSettingsContext';
import { useFinalSavesPath } from 'renderer/react/context/SavesPathContext';
import { useSavedStateJSON } from 'renderer/react/hooks/useSavedState';
import useToast from 'renderer/react/hooks/useToast';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export const SAVE_BACKUP_LAST_SUCCESS_STORAGE_KEY = 'save-backup-last-success';
export const SAVE_BACKUP_INTERVAL_MILLISECONDS = 60 * 1000;

const MAX_SET_TIMEOUT_DELAY_MILLISECONDS = 2_147_483_647;

export type SaveBackupLastSuccess = {
  savesPath: string | null;
  timestamp: number | null;
};

const EMPTY_SAVE_BACKUP_LAST_SUCCESS: SaveBackupLastSuccess = {
  savesPath: null,
  timestamp: null,
};

export function normalizeSaveBackupLastSuccess(
  value: unknown,
): SaveBackupLastSuccess {
  const candidate =
    typeof value === 'object' && value != null
      ? (value as Partial<SaveBackupLastSuccess>)
      : {};
  return {
    savesPath:
      typeof candidate.savesPath === 'string' && candidate.savesPath !== ''
        ? candidate.savesPath
        : null,
    timestamp:
      typeof candidate.timestamp === 'number' &&
      Number.isFinite(candidate.timestamp) &&
      candidate.timestamp >= 0
        ? candidate.timestamp
        : null,
  };
}

export function getSaveBackupDelayMilliseconds(
  now: number,
  lastSuccess: SaveBackupLastSuccess,
  savesPath: string,
  intervalMinutes: number,
): number {
  const intervalMilliseconds =
    normalizeSaveBackupIntervalMinutes(intervalMinutes) *
    SAVE_BACKUP_INTERVAL_MILLISECONDS;

  if (lastSuccess.savesPath !== savesPath || lastSuccess.timestamp == null) {
    return 0;
  }

  if (lastSuccess.timestamp > now) {
    return intervalMilliseconds;
  }

  return Math.max(0, intervalMilliseconds - (now - lastSuccess.timestamp));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function useSaveBackupScheduler(): null {
  const { t } = useTranslation();
  const [settings] = useSaveBackupSettings();
  const savesPath = useFinalSavesPath();
  const showToast = useToast();
  const [savedLastSuccess, setSavedLastSuccess] =
    useSavedStateJSON<SaveBackupLastSuccess>(
      SAVE_BACKUP_LAST_SUCCESS_STORAGE_KEY,
      EMPTY_SAVE_BACKUP_LAST_SUCCESS,
    );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingScheduleRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const configRef = useRef({
    enabled: settings.enabled,
    intervalMinutes: settings.intervalMinutes,
    savesPath,
  });
  const lastSuccessRef = useRef(
    normalizeSaveBackupLastSuccess(savedLastSuccess),
  );
  const scheduleRef = useRef<(generation: number, delay: number) => void>(
    () => undefined,
  );
  const runBackupRef = useRef<
    ((generation: number, expectedSavesPath: string) => Promise<void>) | null
  >(null);

  configRef.current = {
    enabled: settings.enabled,
    intervalMinutes: settings.intervalMinutes,
    savesPath,
  };
  lastSuccessRef.current = normalizeSaveBackupLastSuccess(savedLastSuccess);

  const clearTimer = useCallback((): void => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (generation: number, delay: number): void => {
      clearTimer();

      const safeDelay = Math.min(
        Math.max(0, delay),
        MAX_SET_TIMEOUT_DELAY_MILLISECONDS,
      );
      const remainingDelay = Math.max(0, delay - safeDelay);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (!mountedRef.current || generation !== generationRef.current) {
          return;
        }

        if (remainingDelay > 0) {
          scheduleRef.current(generation, remainingDelay);
          return;
        }

        if (inFlightRef.current) {
          pendingScheduleRef.current = true;
          return;
        }

        const config = configRef.current;
        if (config.enabled) {
          void runBackupRef.current?.(generation, config.savesPath);
        }
      }, safeDelay);
    },
    [clearTimer],
  );
  scheduleRef.current = schedule;

  const runBackup = useCallback(
    async (generation: number, expectedSavesPath: string): Promise<void> => {
      const initialConfig = configRef.current;
      if (
        !mountedRef.current ||
        generation !== generationRef.current ||
        !initialConfig.enabled ||
        initialConfig.savesPath !== expectedSavesPath
      ) {
        return;
      }

      inFlightRef.current = true;
      let succeeded = false;
      try {
        await BridgeAPI.createSaveBackup(expectedSavesPath);
        succeeded = true;
        const successfulBackup: SaveBackupLastSuccess = {
          savesPath: expectedSavesPath,
          timestamp: Date.now(),
        };
        lastSuccessRef.current = successfulBackup;
        if (mountedRef.current) {
          setSavedLastSuccess(successfulBackup);
        }
      } catch (error) {
        console.error('Automatic save backup failed.', error);
        if (mountedRef.current) {
          showToast({
            description: getErrorMessage(error),
            severity: 'error',
            title: t('settings.general.saveBackup.toast.failed'),
          });
        }
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) {
          const currentConfig = configRef.current;
          if (!currentConfig.enabled) {
            pendingScheduleRef.current = false;
            clearTimer();
          } else {
            const currentGeneration = generationRef.current;
            const needsReschedule =
              pendingScheduleRef.current || generation !== currentGeneration;
            pendingScheduleRef.current = false;

            let delay: number;
            if (needsReschedule) {
              const pathChanged = currentConfig.savesPath !== expectedSavesPath;
              delay = pathChanged
                ? 0
                : succeeded
                  ? getSaveBackupDelayMilliseconds(
                      Date.now(),
                      lastSuccessRef.current,
                      currentConfig.savesPath,
                      currentConfig.intervalMinutes,
                    )
                  : currentConfig.intervalMinutes *
                    SAVE_BACKUP_INTERVAL_MILLISECONDS;
            } else {
              delay = succeeded
                ? getSaveBackupDelayMilliseconds(
                    Date.now(),
                    lastSuccessRef.current,
                    currentConfig.savesPath,
                    currentConfig.intervalMinutes,
                  )
                : currentConfig.intervalMinutes *
                  SAVE_BACKUP_INTERVAL_MILLISECONDS;
            }
            schedule(currentGeneration, delay);
          }
        }
      }
    },
    [clearTimer, schedule, setSavedLastSuccess, showToast, t],
  );
  runBackupRef.current = runBackup;

  useEffect(() => {
    if (
      savedLastSuccess?.savesPath !== lastSuccessRef.current.savesPath ||
      savedLastSuccess?.timestamp !== lastSuccessRef.current.timestamp
    ) {
      setSavedLastSuccess(lastSuccessRef.current);
    }
  }, [savedLastSuccess, setSavedLastSuccess]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    clearTimer();
    pendingScheduleRef.current = false;

    if (!settings.enabled) {
      return clearTimer;
    }

    if (inFlightRef.current) {
      pendingScheduleRef.current = true;
      return clearTimer;
    }

    schedule(
      generation,
      getSaveBackupDelayMilliseconds(
        Date.now(),
        lastSuccessRef.current,
        savesPath,
        settings.intervalMinutes,
      ),
    );
    return clearTimer;
  }, [
    clearTimer,
    savesPath,
    schedule,
    settings.enabled,
    settings.intervalMinutes,
  ]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      generationRef.current += 1;
      pendingScheduleRef.current = false;
      clearTimer();
    },
    [clearTimer],
  );

  return null;
}

export function SaveBackupScheduler(): null {
  return useSaveBackupScheduler();
}
