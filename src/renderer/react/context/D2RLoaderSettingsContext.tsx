import type { D2RLoaderSettings } from 'bridge/BridgeAPI';
import { useSavedStateJSON } from 'renderer/react/hooks/useSavedState';
import React, { useMemo } from 'react';

export type D2RLoaderSettingsState = Omit<D2RLoaderSettings, 'defaultMod'> & {
  useD2RLoader: boolean;
};

type ISetD2RLoaderSettings = React.Dispatch<
  React.SetStateAction<D2RLoaderSettingsState>
>;

type ID2RLoaderSettingsContext = {
  settings: D2RLoaderSettingsState;
  setSettings: ISetD2RLoaderSettings;
};

const DEFAULT_D2R_LOADER_SETTINGS: D2RLoaderSettingsState = {
  useD2RLoader: false,
  skipTitleScreen: false,
  showGroundSockets: false,
  extraSharedTabs: 0,
  forceTcpip: false,
  globalPlugins: true,
  devConsole: false,
  detectEarlyCrashes: false,
  damageIndicator: 0,
  jsonResourceLoads: false,
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
  const [settings, setSettings] = useSavedStateJSON<D2RLoaderSettingsState>(
    'd2r-loader-settings',
    DEFAULT_D2R_LOADER_SETTINGS,
  );

  const context = useMemo(
    (): ID2RLoaderSettingsContext => ({
      settings: { ...DEFAULT_D2R_LOADER_SETTINGS, ...settings },
      setSettings,
    }),
    [settings, setSettings],
  );

  return (
    <D2RLoaderSettingsContext.Provider value={context}>
      {children}
    </D2RLoaderSettingsContext.Provider>
  );
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
