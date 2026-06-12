import useSavedState from 'renderer/react/hooks/useSavedState';
import React, { useMemo } from 'react';

type IIsEnabled = boolean;
type ISetIsEnabled = React.Dispatch<React.SetStateAction<boolean>>;

type INormalizeCRLFOnInstallContext = {
  isEnabled: IIsEnabled;
  setIsEnabled: ISetIsEnabled;
};

const NormalizeCRLFOnInstallContext =
  React.createContext<INormalizeCRLFOnInstallContext | null>(null);

type Props = {
  children: React.ReactNode;
};

export function NormalizeCRLFOnInstallContextProvider({
  children,
}: Props): JSX.Element {
  const [isEnabled, setIsEnabled] = useSavedState<IIsEnabled>(
    'normalize-crlf-on-install',
    false,
    (value) => JSON.stringify(value),
    (value) => JSON.parse(value),
  );

  const context = useMemo(
    () => ({ isEnabled, setIsEnabled }),
    [isEnabled, setIsEnabled],
  );

  return (
    <NormalizeCRLFOnInstallContext.Provider value={context}>
      {children}
    </NormalizeCRLFOnInstallContext.Provider>
  );
}

export function useNormalizeCRLFOnInstall(): [IIsEnabled, ISetIsEnabled] {
  const context = React.useContext(NormalizeCRLFOnInstallContext);
  if (context == null) {
    throw new Error(
      'useNormalizeCRLFOnInstall must be used within a NormalizeCRLFOnInstallContextProvider',
    );
  }
  return [context.isEnabled, context.setIsEnabled];
}
