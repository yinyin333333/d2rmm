import { useSanitizedGamePath } from 'renderer/react/context/GamePathContext';
import useSavedState from 'renderer/react/hooks/useSavedState';
import resolvePath from 'renderer/utils/resolvePath';
import React, { useCallback, useContext, useMemo } from 'react';

type IPath = string;
type ISavedPath = IPath | null;
type ISetPath = React.Dispatch<React.SetStateAction<IPath>>;

type IPreExtractedDataPathContext = {
  path: IPath;
  setPath: ISetPath;
};

export const Context = React.createContext<IPreExtractedDataPathContext | null>(
  null,
);

export function usePreExtractedDataPath(): [IPath, ISetPath] {
  const context = useContext(Context);
  if (context == null) {
    throw new Error(
      'usePreExtractedDataPath must be used within a PreExtractedDataPathContextProvider',
    );
  }
  return [context.path, context.setPath];
}

type Props = {
  children: React.ReactNode;
};

export function PreExtractedDataPathContextProvider({
  children,
}: Props): JSX.Element {
  const gamePath = useSanitizedGamePath();
  const defaultPath = resolvePath(gamePath, 'data');
  const [savedPath, setSavedPath] = useSavedState<ISavedPath>(
    'pre-extracted-data-path',
    null,
  );
  const path = savedPath ?? defaultPath;
  const setPath = useCallback<ISetPath>(
    (action) => {
      setSavedPath((oldSavedPath) => {
        const oldPath = oldSavedPath ?? defaultPath;
        return typeof action === 'function' ? action(oldPath) : action;
      });
    },
    [defaultPath, setSavedPath],
  );

  const context = useMemo(
    (): IPreExtractedDataPathContext => ({
      path,
      setPath,
    }),
    [path, setPath],
  );

  return <Context.Provider value={context}>{children}</Context.Provider>;
}
