import type { InstallationStatus } from 'bridge/EventAPI';
import { EventAPI } from 'renderer/EventAPI';
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

type SetIsInstalling = React.Dispatch<React.SetStateAction<boolean>>;
type SetProgress = React.Dispatch<React.SetStateAction<number>>;

export type InstallationOperation = {
  active: boolean;
  label: string;
  progress: number | null;
};

export type InstallationOperationToken = number;

export type IInstallContext = {
  isInstalling: boolean;
  setIsInstalling: SetIsInstalling;
  progress: number;
  setProgress: SetProgress;
  operation: InstallationOperation;
  tryStartOperation: (
    label: string,
    progress?: number | null,
  ) => InstallationOperationToken | null;
  updateOperation: (
    token: InstallationOperationToken,
    update: Partial<Pick<InstallationOperation, 'label' | 'progress'>>,
  ) => void;
  finishOperation: (token: InstallationOperationToken) => void;
};

const InstallContext = React.createContext<IInstallContext | null>(null);

export function InstallContextProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { t } = useTranslation();
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [operation, setOperation] = useState<InstallationOperation>({
    active: false,
    label: '',
    progress: null,
  });
  const activeToken = useRef<InstallationOperationToken | null>(null);
  const nextToken = useRef(1);

  const tryStartOperation = useCallback(
    (label: string, initialProgress: number | null = null) => {
      if (activeToken.current != null) {
        return null;
      }
      const token = nextToken.current++;
      activeToken.current = token;
      setProgress(initialProgress ?? 0);
      setIsInstalling(true);
      setOperation({ active: true, label, progress: initialProgress });
      return token;
    },
    [],
  );

  const updateOperation = useCallback(
    (
      token: InstallationOperationToken,
      update: Partial<Pick<InstallationOperation, 'label' | 'progress'>>,
    ) => {
      if (activeToken.current !== token) {
        return;
      }
      if (update.progress != null) {
        setProgress(update.progress);
      }
      setOperation((current) => ({ ...current, ...update }));
    },
    [],
  );

  const finishOperation = useCallback((token: InstallationOperationToken) => {
    if (activeToken.current !== token) {
      return;
    }
    activeToken.current = null;
    setIsInstalling(false);
    setOperation({ active: false, label: '', progress: null });
  }, []);

  const context = useMemo(
    () => ({
      isInstalling,
      setIsInstalling,
      progress,
      setProgress,
      operation,
      tryStartOperation,
      updateOperation,
      finishOperation,
    }),
    [
      finishOperation,
      isInstalling,
      operation,
      progress,
      tryStartOperation,
      updateOperation,
    ],
  );

  useEffect(() => {
    const listener = EventAPI.addListener(
      'installationProgress',
      async (installedModsCount: number, totalModsCount: number) => {
        const nextProgress =
          totalModsCount === 0
            ? 100
            : (installedModsCount / totalModsCount) * 100;
        setProgress(nextProgress);
        setOperation((current) =>
          current.active ? { ...current, progress: nextProgress } : current,
        );
      },
    );
    const phaseListener = EventAPI.addListener(
      'installationStatus',
      async ({ phase }: InstallationStatus) => {
        if (phase === 'finalizing') {
          setOperation((current) =>
            current.active
              ? {
                  ...current,
                  label: t('install.progress.finalizing'),
                  progress: null,
                }
              : current,
          );
        }
      },
    );
    return () => {
      EventAPI.removeListener('installationProgress', listener);
      EventAPI.removeListener('installationStatus', phaseListener);
    };
  }, [setProgress, t]);

  return (
    <InstallContext.Provider value={context}>
      {children}
    </InstallContext.Provider>
  );
}

export function useIsInstalling(): [boolean, SetIsInstalling] {
  const context = useContext(InstallContext);
  if (context == null) {
    throw new Error('useIsInstalling used outside of a InstallContextProvider');
  }
  return [context.isInstalling, context.setIsInstalling];
}

export function useInstallationProgress(): [number, SetProgress] {
  const context = useContext(InstallContext);
  if (context == null) {
    throw new Error(
      'useInstallationProgress used outside of a InstallContextProvider',
    );
  }
  return [context.progress, context.setProgress];
}

export function useInstallationOperation(): Pick<
  IInstallContext,
  'operation' | 'tryStartOperation' | 'updateOperation' | 'finishOperation'
> {
  const context = useContext(InstallContext);
  if (context == null) {
    throw new Error(
      'useInstallationOperation used outside of a InstallContextProvider',
    );
  }
  return context;
}
