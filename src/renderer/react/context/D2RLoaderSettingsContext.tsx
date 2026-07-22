import type { D2RLoaderSettings } from 'bridge/BridgeAPI';
import { useSavedStateJSON } from 'renderer/react/hooks/useSavedState';
import React, { useCallback, useMemo, useState } from 'react';

export type D2RLoaderSettingsState = Omit<D2RLoaderSettings, 'defaultMod'> & {
  useD2RLoader: boolean;
};

type ISetD2RLoaderSettings = React.Dispatch<
  React.SetStateAction<D2RLoaderSettingsState>
>;

type ID2RLoaderSettingsContext = {
  configRevision: number;
  refreshConfig: () => void;
  settings: D2RLoaderSettingsState;
  setSettings: ISetD2RLoaderSettings;
};

const DEFAULT_D2R_LOADER_SETTINGS: D2RLoaderSettingsState = {
  useD2RLoader: false,
  tomlSettings: {},
};

const D2RLoaderSettingsContext =
  React.createContext<ID2RLoaderSettingsContext | null>(null);

type Props = {
  children: React.ReactNode;
};

export function D2RLoaderSettingsContextProvider({
  children,
}: Props): JSX.Element {
  const [configRevision, setConfigRevision] = useState(0);
  const [settings, setSettings] = useSavedStateJSON<D2RLoaderSettingsState>(
    'd2r-loader-settings',
    DEFAULT_D2R_LOADER_SETTINGS,
  );
  const refreshConfig = useCallback(() => {
    setConfigRevision((revision) => revision + 1);
  }, []);

  const context = useMemo(
    (): ID2RLoaderSettingsContext => ({
      configRevision,
      refreshConfig,
      settings: { ...DEFAULT_D2R_LOADER_SETTINGS, ...settings },
      setSettings,
    }),
    [configRevision, refreshConfig, settings, setSettings],
  );

  return (
    <D2RLoaderSettingsContext.Provider value={context}>
      {children}
    </D2RLoaderSettingsContext.Provider>
  );
}

export function useD2RLoaderConfigRefresh(): [number, () => void] {
  const context = React.useContext(D2RLoaderSettingsContext);
  if (context == null) {
    throw new Error(
      'useD2RLoaderConfigRefresh must be used within a D2RLoaderSettingsContextProvider',
    );
  }
  return [context.configRevision, context.refreshConfig];
}

export function useD2RLoaderSettings(): [
  D2RLoaderSettingsState,
  ISetD2RLoaderSettings,
] {
  const context = React.useContext(D2RLoaderSettingsContext);
  if (context == null) {
    throw new Error(
      'useD2RLoaderSettings must be used within a D2RLoaderSettingsContextProvider',
    );
  }
  return [context.settings, context.setSettings];
}
