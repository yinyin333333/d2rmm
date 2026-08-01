import { useSavedStateJSON } from 'renderer/react/hooks/useSavedState';
import React, { useCallback, useContext, useEffect, useMemo } from 'react';

export const DEFAULT_SAVE_BACKUP_INTERVAL_MINUTES = 60;
export const SAVE_BACKUP_SETTINGS_STORAGE_KEY = 'save-backup-settings';

export type SaveBackupSettings = {
  enabled: boolean;
  intervalMinutes: number;
};

type SetSaveBackupSettings = React.Dispatch<
  React.SetStateAction<SaveBackupSettings>
>;

type SaveBackupSettingsContextValue = {
  settings: SaveBackupSettings;
  setSettings: SetSaveBackupSettings;
};

const SaveBackupSettingsContext =
  React.createContext<SaveBackupSettingsContextValue | null>(null);

const DEFAULT_SAVE_BACKUP_SETTINGS: SaveBackupSettings = {
  enabled: false,
  intervalMinutes: DEFAULT_SAVE_BACKUP_INTERVAL_MINUTES,
};

export function normalizeSaveBackupIntervalMinutes(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  return DEFAULT_SAVE_BACKUP_INTERVAL_MINUTES;
}

export function parseSaveBackupIntervalMinutes(value: string): number | null {
  if (value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeSaveBackupSettings(
  value: unknown,
): SaveBackupSettings {
  const candidate =
    typeof value === 'object' && value != null
      ? (value as Partial<SaveBackupSettings>)
      : {};
  return {
    enabled: candidate.enabled === true,
    intervalMinutes: normalizeSaveBackupIntervalMinutes(
      candidate.intervalMinutes,
    ),
  };
}

type Props = {
  children: React.ReactNode;
};

export function SaveBackupSettingsContextProvider({
  children,
}: Props): JSX.Element {
  const [savedSettings, setSavedSettings] =
    useSavedStateJSON<SaveBackupSettings>(
      SAVE_BACKUP_SETTINGS_STORAGE_KEY,
      DEFAULT_SAVE_BACKUP_SETTINGS,
    );
  const settings = useMemo(
    () => normalizeSaveBackupSettings(savedSettings),
    [savedSettings],
  );

  useEffect(() => {
    if (
      savedSettings?.enabled !== settings.enabled ||
      savedSettings?.intervalMinutes !== settings.intervalMinutes
    ) {
      setSavedSettings(settings);
    }
  }, [savedSettings, setSavedSettings, settings]);

  const setSettings = useCallback<SetSaveBackupSettings>(
    (action) => {
      setSavedSettings((currentSettings) => {
        const current = normalizeSaveBackupSettings(currentSettings);
        const next = typeof action === 'function' ? action(current) : action;
        return normalizeSaveBackupSettings(next);
      });
    },
    [setSavedSettings],
  );

  const context = useMemo(
    (): SaveBackupSettingsContextValue => ({ settings, setSettings }),
    [setSettings, settings],
  );

  return (
    <SaveBackupSettingsContext.Provider value={context}>
      {children}
    </SaveBackupSettingsContext.Provider>
  );
}

export function useSaveBackupSettings(): [
  SaveBackupSettings,
  SetSaveBackupSettings,
] {
  const context = useContext(SaveBackupSettingsContext);
  if (context == null) {
    throw new Error(
      'useSaveBackupSettings must be used within a SaveBackupSettingsContextProvider',
    );
  }
  return [context.settings, context.setSettings];
}
