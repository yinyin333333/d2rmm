import type {
  D2RLoaderPluginEditableJSON,
  D2RLoaderPluginEditableSource,
  D2RLoaderPluginEditResult,
  D2RLoaderPluginImportResult,
  D2RLoaderPluginInventory,
} from 'bridge/D2RLoaderPluginAPI';
import D2RLoaderPluginAPI from 'renderer/D2RLoaderPluginAPI';
import { useD2RLoaderSettings } from 'renderer/react/context/D2RLoaderSettingsContext';
import { useMods, useModsRevision } from 'renderer/react/context/ModsContext';
import { useOutputPath } from 'renderer/react/context/OutputPathContext';
import useSavedState from 'renderer/react/hooks/useSavedState';
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const EMPTY_INVENTORY: D2RLoaderPluginInventory = {
  configs: [],
  conflicts: [],
  deploymentSignature: '',
  managedSignature: '',
  managedRoot: '',
  packages: [],
  patches: [],
  plugins: [],
};

type D2RLoaderPluginContextValue = {
  deletePackage: (packageName: string) => Promise<void>;
  error: Error | null;
  importSources: (
    sourcePaths: string[],
  ) => Promise<D2RLoaderPluginImportResult>;
  inventory: D2RLoaderPluginInventory;
  hasUnsavedEdits: boolean;
  isDeploymentChanged: boolean;
  isInventoryCurrent: boolean;
  isLoading: boolean;
  isMutating: boolean;
  isOutputModeChanged: boolean;
  markDeploymentInstalled: () => void;
  markDeploymentOutdated: () => void;
  markOutputModeInstalled: () => void;
  readEditableJSON: (
    source: D2RLoaderPluginEditableSource,
  ) => Promise<D2RLoaderPluginEditableJSON>;
  refresh: () => Promise<D2RLoaderPluginInventory>;
  saveEditableJSON: (
    source: D2RLoaderPluginEditableSource,
    expectedSha256: string,
    contents: string,
  ) => Promise<D2RLoaderPluginEditResult>;
  setEditableJSONDirty: (editorID: string, dirty: boolean) => void;
};

const D2RLoaderPluginContext =
  React.createContext<D2RLoaderPluginContextValue | null>(null);

export function D2RLoaderPluginContextProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [mods] = useMods();
  const modsRevision = useModsRevision();
  const [d2rLoaderSettings] = useD2RLoaderSettings();
  const outputPath = useOutputPath();
  const currentOutputMode = `mod:${
    d2rLoaderSettings.useD2RLoader ? 'loader' : 'standard'
  }`;
  const modIDs = useMemo(
    () => mods.map(({ id }) => id).sort((a, b) => a.localeCompare(b)),
    [mods],
  );
  const modIDsRef = useRef(modIDs);
  modIDsRef.current = modIDs;
  const [inventory, setInventory] = useState(EMPTY_INVENTORY);
  const [installedManagedSignature, setInstalledManagedSignature] =
    useSavedState('installed-d2rloader-packages-signature', '');
  const [installedOutputMode, setInstalledOutputMode] = useSavedState(
    'installed-output-mode',
    currentOutputMode,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [hasUnrefreshedMutation, setHasUnrefreshedMutation] = useState(false);
  const dirtyEditors = useRef(new Set<string>());
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const scanGeneration = useRef(0);
  const mutationPending = useRef(false);
  const isMounted = useRef(true);

  useEffect(
    () => () => {
      isMounted.current = false;
    },
    [],
  );

  const refresh = useCallback(async (): Promise<D2RLoaderPluginInventory> => {
    const generation = ++scanGeneration.current;
    setIsLoading(true);
    try {
      const nextInventory = await D2RLoaderPluginAPI.readInventory(
        modIDsRef.current,
      );
      if (isMounted.current && generation === scanGeneration.current) {
        setInventory(nextInventory);
        setError(null);
        setHasUnrefreshedMutation(false);
      }
      return nextInventory;
    } catch (caught) {
      const nextError =
        caught instanceof Error ? caught : new Error(String(caught));
      if (isMounted.current && generation === scanGeneration.current) {
        setError(nextError);
      }
      throw nextError;
    } finally {
      if (isMounted.current && generation === scanGeneration.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [modsRevision, refresh]);

  const runMutation = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      if (mutationPending.current) {
        throw new Error('Another D2RLoader package change is still running.');
      }
      mutationPending.current = true;
      setIsMutating(true);
      try {
        return await operation();
      } finally {
        mutationPending.current = false;
        if (isMounted.current) setIsMutating(false);
      }
    },
    [],
  );

  const importSources = useCallback(
    (sourcePaths: string[]): Promise<D2RLoaderPluginImportResult> => {
      if (dirtyEditors.current.size > 0) {
        return Promise.reject(
          new Error(
            'Save or cancel all D2RLoader file edits before importing packages.',
          ),
        );
      }
      return runMutation(async () => {
        const result = await D2RLoaderPluginAPI.importSources(sourcePaths);
        if (isMounted.current) setHasUnrefreshedMutation(true);
        await refresh().catch(console.error);
        return result;
      });
    },
    [refresh, runMutation],
  );

  const deletePackage = useCallback(
    (packageName: string): Promise<void> => {
      if (dirtyEditors.current.size > 0) {
        return Promise.reject(
          new Error(
            'Save or cancel all D2RLoader file edits before deleting packages.',
          ),
        );
      }
      return runMutation(async () => {
        await D2RLoaderPluginAPI.deletePackage(packageName);
        if (isMounted.current) setHasUnrefreshedMutation(true);
        await refresh().catch(console.error);
      });
    },
    [refresh, runMutation],
  );

  const readEditableJSON = useCallback(
    (
      source: D2RLoaderPluginEditableSource,
    ): Promise<D2RLoaderPluginEditableJSON> =>
      D2RLoaderPluginAPI.readEditableJSON(source),
    [],
  );

  const saveEditableJSON = useCallback(
    (
      source: D2RLoaderPluginEditableSource,
      expectedSha256: string,
      contents: string,
    ): Promise<D2RLoaderPluginEditResult> =>
      runMutation(async () => {
        const result = await D2RLoaderPluginAPI.saveEditableJSON(
          source,
          expectedSha256,
          contents,
        );
        if (isMounted.current) setHasUnrefreshedMutation(true);
        await refresh().catch(console.error);
        return result;
      }),
    [refresh, runMutation],
  );

  const deploymentSignature =
    inventory.deploymentSignature ?? inventory.managedSignature;
  const markDeploymentInstalled = useCallback(() => {
    setInstalledManagedSignature(
      deploymentSignature === '' ? '' : `${deploymentSignature}\0${outputPath}`,
    );
  }, [deploymentSignature, outputPath, setInstalledManagedSignature]);

  const setEditableJSONDirty = useCallback(
    (editorID: string, dirty: boolean): void => {
      const wasDirty = dirtyEditors.current.has(editorID);
      if (dirty === wasDirty) return;
      if (dirty) dirtyEditors.current.add(editorID);
      else dirtyEditors.current.delete(editorID);
      if (isMounted.current) {
        setHasUnsavedEdits(dirtyEditors.current.size > 0);
      }
    },
    [],
  );

  const markDeploymentOutdated = useCallback(() => {
    setInstalledManagedSignature('');
  }, [setInstalledManagedSignature]);

  const markOutputModeInstalled = useCallback(() => {
    setInstalledOutputMode(currentOutputMode);
  }, [currentOutputMode, setInstalledOutputMode]);

  const currentDeployment =
    deploymentSignature === '' ? '' : `${deploymentSignature}\0${outputPath}`;
  const isDeploymentChanged =
    hasUnrefreshedMutation || currentDeployment !== installedManagedSignature;
  const isInventoryCurrent = !hasUnrefreshedMutation;
  const isOutputModeChanged = currentOutputMode !== installedOutputMode;

  const value = useMemo(
    (): D2RLoaderPluginContextValue => ({
      deletePackage,
      error,
      hasUnsavedEdits,
      importSources,
      inventory,
      isDeploymentChanged,
      isInventoryCurrent,
      isLoading,
      isMutating,
      isOutputModeChanged,
      markDeploymentInstalled,
      markDeploymentOutdated,
      markOutputModeInstalled,
      readEditableJSON,
      refresh,
      saveEditableJSON,
      setEditableJSONDirty,
    }),
    [
      deletePackage,
      error,
      hasUnsavedEdits,
      importSources,
      inventory,
      isDeploymentChanged,
      isInventoryCurrent,
      isLoading,
      isMutating,
      isOutputModeChanged,
      markDeploymentInstalled,
      markDeploymentOutdated,
      markOutputModeInstalled,
      readEditableJSON,
      refresh,
      saveEditableJSON,
      setEditableJSONDirty,
    ],
  );

  return (
    <D2RLoaderPluginContext.Provider value={value}>
      {children}
    </D2RLoaderPluginContext.Provider>
  );
}

export function useD2RLoaderPluginManager(): D2RLoaderPluginContextValue {
  const value = useContext(D2RLoaderPluginContext);
  if (value == null) {
    throw new Error(
      'useD2RLoaderPluginManager must be used within D2RLoaderPluginContextProvider.',
    );
  }
  return value;
}
