import type { Mod } from 'bridge/BridgeAPI';
import type { ModConfigFieldOrSection } from 'bridge/ModConfig';
import type {
  ModConfigSingleValue,
  ModConfigValue,
} from 'bridge/ModConfigValue';
import BridgeAPI from 'renderer/BridgeAPI';
import { parseBinding } from 'renderer/react/BindingsParser';
import {
  getAbsoluteIndexFromRenderedIndex,
  getHiddenItemCountForSection,
  isOrderedMod,
} from 'renderer/react/ReorderUtils';
import { useLogger } from 'renderer/react/context/LogContext';
import useModsContextConfigOverrides, {
  IModConfigOverrides,
  ISetModConfigOverrides,
} from 'renderer/react/context/hooks/useModsContextConfigOverrides';
import useSavedState from 'renderer/react/hooks/useSavedState';
import useToast from 'renderer/react/hooks/useToast';
import deferUntilAfterFirstPaint from 'renderer/utils/deferUntilAfterFirstPaint';
import { startupMark, startupMeasure } from 'shared/startupProfiler';
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// inversse of Readonly<T>
type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

type IMods = Mod[];

type IModsRefresher = (ids?: string[]) => Promise<IMods>;

type IEnabledMods = { [id: string]: boolean };

type IEnabledModsMutator = React.Dispatch<React.SetStateAction<IEnabledMods>>;

type IInstalledMod = { id: Mod['id']; config: Mod['config'] };

type IInstalledMods = IInstalledMod[];

type IInstalledModsMutator = React.Dispatch<
  React.SetStateAction<IInstalledMods>
>;

type ISelectedMod = Mod | null;

type ISelectedModMutator = React.Dispatch<React.SetStateAction<ISelectedMod>>;

export type ISectionHeader = {
  id: string;
  label: string;
  isExpanded: boolean;
};

type ISectionHeaders = {
  nextIndex: number;
  headers: ISectionHeader[];
};

type ISectionHeadersMutator = React.Dispatch<
  React.SetStateAction<ISectionHeaders>
>;

export type IOrderedMod = {
  type: 'mod';
  id: string;
  mod: Mod;
};

export type IOrderedSectionHeader = {
  type: 'sectionHeader';
  id: string;
  sectionHeader: ISectionHeader;
};

export type IOrderedItem = IOrderedMod | IOrderedSectionHeader;

export type IOrderedItems = IOrderedItem[];

type IOrderedMods = Mod[];

type IItemsOrder = string[];

type IItemsOrderMutator = (from: number, to: number) => unknown;

const MOD_LOAD_CONCURRENCY = 4;

type IModConfigMutator = (
  id: string,
  value: React.SetStateAction<ModConfigValue>,
) => void;

type IModConfigSaver = (id: string, value: ModConfigValue) => Promise<void>;

export type IModsContext = {
  enabledMods: IEnabledMods;
  installedMods: IInstalledMods;
  isInstallConfigChanged: boolean;
  isLoadingMods: boolean;
  modConfigOverrides: IModConfigOverrides;
  mods: IMods;
  modsRevision: number;
  modsToInstall: IOrderedMods;
  orderedItems: IOrderedItems;
  refreshMods: IModsRefresher;
  reorderItems: IItemsOrderMutator;
  sectionHeaders: ISectionHeaders;
  selectedMod: ISelectedMod;
  saveModConfig: IModConfigSaver;
  setEnabledMods: IEnabledModsMutator;
  setInstalledMods: IInstalledModsMutator;
  setItemsOrder: React.Dispatch<React.SetStateAction<IItemsOrder>>;
  setModConfig: IModConfigMutator;
  setModConfigOverrides: ISetModConfigOverrides;
  setSectionHeaders: ISectionHeadersMutator;
  setSelectedMod: ISelectedModMutator;
};

export const Context = React.createContext<IModsContext | null>(null);

function getDefaultConfig(
  fields: readonly ModConfigFieldOrSection[] | null | undefined,
  savedConfig: ModConfigValue,
): ModConfigValue {
  if (fields == null) {
    return {};
  }
  const defaultConfig: Mutable<ModConfigValue> = {};
  for (const field of fields) {
    const currentConfig = { ...defaultConfig, ...savedConfig };

    defaultConfig[field.id] = parseBinding<ModConfigSingleValue>(
      field.defaultValue as unknown as ModConfigSingleValue,
      currentConfig,
      {},
    );

    if (field.type === 'section') {
      Object.assign(
        defaultConfig,
        getDefaultConfig(field.children, currentConfig),
      );
    }
  }
  return defaultConfig;
}

function mergeFullModsWithPartialRefreshes(
  fullRefreshMods: Mod[],
  currentMods: Mod[],
  partiallyRefreshedIDs: ReadonlySet<string>,
): Mod[] {
  const currentByID = new Map(currentMods.map((mod) => [mod.id, mod]));
  const fullRefreshIDs = new Set(fullRefreshMods.map((mod) => mod.id));
  const merged = fullRefreshMods.flatMap((fullRefreshMod) => {
    if (!partiallyRefreshedIDs.has(fullRefreshMod.id)) {
      return [fullRefreshMod];
    }
    const currentMod = currentByID.get(fullRefreshMod.id);
    return currentMod == null ? [] : [currentMod];
  });

  return merged.concat(
    currentMods.filter(
      (currentMod) =>
        partiallyRefreshedIDs.has(currentMod.id) &&
        !fullRefreshIDs.has(currentMod.id),
    ),
  );
}

export function ModsContextProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const logger = useLogger();
  const showToast = useToast();

  const getMods = useCallback(
    async (ids?: string[]): Promise<Mod[]> => {
      const label =
        ids == null ? 'first/full mod list load' : 'partial mod list load';
      const modIDs = ids ?? (await BridgeAPI.readModDirectory());
      startupMark('renderer', `${label}: ${modIDs.length} candidates`);
      const loadedMods = new Array<Mod | null>(modIDs.length).fill(null);
      let nextIndex = 0;
      const loadNext = async (): Promise<void> => {
        while (nextIndex < modIDs.length) {
          const index = nextIndex;
          nextIndex += 1;
          const modID = modIDs[index];
          try {
            let info;
            try {
              info = await BridgeAPI.readModInfo(modID);
            } catch {
              // ignore folder as it may not be a mod
              continue;
            }

            if (info == null) {
              // ignore folder as it may not be a mod
              continue;
            }

            const savedConfig = (await BridgeAPI.readModConfig(
              modID,
            )) as unknown as ModConfigValue;
            const defaultConfig = getDefaultConfig(info.config, savedConfig);

            loadedMods[index] = {
              id: modID,
              info,
              config: { ...defaultConfig, ...savedConfig },
            };
          } catch (error) {
            logger.error('Failed to load mod', modID, error as Error);
            showToast({
              severity: 'error',
              title: `Failed to load mod ${modID}`,
              description: String(error),
            });
          }
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(MOD_LOAD_CONCURRENCY, modIDs.length) },
          loadNext,
        ),
      );
      return loadedMods.filter((mod): mod is Mod => mod != null);
    },
    [logger, showToast],
  );

  const [modsWithoutOverrides, setMods] = useState<Mod[]>([]);
  const modsRef = useRef<Mod[]>([]);
  const updateMods = useCallback((update: (mods: Mod[]) => Mod[]): void => {
    const mods = update(modsRef.current);
    modsRef.current = mods;
    setMods(mods);
  }, []);
  const [isLoadingMods, setIsLoadingMods] = useState(true);
  const [modsRevision, setModsRevision] = useState(0);
  const initialLoadIsPending = useRef(true);
  const initialLoadPartialIDs = useRef(new Set<string>());
  // Sequence manual scans so stale full/partial results cannot overwrite a
  // newer refresh. Per-ID commits let a full scan preserve installs that
  // completed while it was in flight.
  const nextRefreshSequence = useRef(0);
  const latestFullRefreshRequest = useRef(0);
  const latestCommittedFullRefresh = useRef(0);
  const latestPartialRefreshRequestByID = useRef(new Map<string, number>());
  const latestPartialRefreshCommitByID = useRef(new Map<string, number>());
  const pendingFullRefreshes = useRef(0);
  // Config requests are ordered independently from refreshes. Applied
  // generations track only config that reached the UI, while persisted
  // generations advance only after a successful write. This keeps pending or
  // failed optimistic edits protected without treating a failed, non-UI
  // saveModConfig request as a local edit.
  const nextConfigRequestGeneration = useRef(0);
  const latestConfigRequestGenerationByID = useRef(new Map<string, number>());
  const latestAppliedConfigMutationByID = useRef(new Map<string, number>());
  const latestPersistedConfigMutationByID = useRef(new Map<string, number>());
  const configPersistenceQueueByID = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    startupMark('renderer', 'first ModList load scheduled after first paint');
    let isMounted = true;
    const cancel = deferUntilAfterFirstPaint(() => {
      const configRequestGenerationAtStart =
        nextConfigRequestGeneration.current;
      const unpersistedConfigIDsAtStart = new Set(
        Array.from(latestAppliedConfigMutationByID.current).flatMap(
          ([id, generation]) =>
            generation >
            (latestPersistedConfigMutationByID.current.get(id) ?? 0)
              ? [id]
              : [],
        ),
      );
      startupMark('renderer', 'first ModList load deferred start');
      startupMeasure('renderer', 'first ModList load', getMods)
        .then((mods) => {
          if (!isMounted) {
            return;
          }
          if (latestCommittedFullRefresh.current === 0) {
            const partiallyRefreshedIDs = new Set(
              initialLoadPartialIDs.current,
            );
            updateMods((currentMods) =>
              mergeFullModsWithPartialRefreshes(
                mods,
                currentMods,
                partiallyRefreshedIDs,
              ).map((mod) => {
                const currentMod = currentMods.find(({ id }) => id === mod.id);
                return currentMod != null &&
                  ((latestAppliedConfigMutationByID.current.get(mod.id) ?? 0) >
                    configRequestGenerationAtStart ||
                    unpersistedConfigIDsAtStart.has(mod.id))
                  ? { ...mod, config: currentMod.config }
                  : mod;
              }),
            );
            setModsRevision((revision) => revision + 1);
          }
          startupMark(
            'renderer',
            `first ModList load completed with ${mods.length} mods`,
          );
        })
        .catch(console.error)
        .finally(() => {
          initialLoadIsPending.current = false;
          initialLoadPartialIDs.current.clear();
          if (isMounted && pendingFullRefreshes.current === 0) {
            setIsLoadingMods(false);
          }
        });
    });
    return () => {
      isMounted = false;
      cancel();
    };
  }, [getMods, updateMods]);

  const persistModConfig = useCallback(
    async (id: string, config: ModConfigValue): Promise<void> => {
      try {
        await BridgeAPI.writeModConfig(id, config);
      } catch (error) {
        logger.error('Failed to save mod config', id, error as Error);
        showToast({
          severity: 'error',
          title: `Failed to save mod config for ${id}`,
          description: String(error),
        });
        throw error;
      }
    },
    [logger, showToast],
  );

  const queueModConfigPersistence = useCallback(
    (id: string, config: ModConfigValue, generation: number): Promise<void> => {
      const previous = configPersistenceQueueByID.current.get(id);
      const persistence = (previous ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
          await persistModConfig(id, config);
          latestPersistedConfigMutationByID.current.set(id, generation);
        });
      configPersistenceQueueByID.current.set(id, persistence);
      const clear = (): void => {
        if (configPersistenceQueueByID.current.get(id) === persistence) {
          configPersistenceQueueByID.current.delete(id);
        }
      };
      persistence.then(clear, clear);
      return persistence;
    },
    [persistModConfig],
  );

  const setModConfig = useCallback(
    (id: string, value: React.SetStateAction<ModConfigValue>): void => {
      const getConfig = typeof value !== 'function' ? () => value : value;
      const currentMod = modsRef.current.find((mod) => mod.id === id);
      if (currentMod == null) {
        return;
      }
      const config = getConfig(currentMod.config);
      const generation = ++nextConfigRequestGeneration.current;
      latestConfigRequestGenerationByID.current.set(id, generation);
      latestAppliedConfigMutationByID.current.set(id, generation);
      updateMods((mods) =>
        mods.map((mod) => (mod.id === id ? { ...mod, config } : mod)),
      );
      void queueModConfigPersistence(id, config, generation).catch(
        () => undefined,
      );
    },
    [queueModConfigPersistence, updateMods],
  );

  const saveModConfig = useCallback(
    async (id: string, config: ModConfigValue): Promise<void> => {
      const generation = ++nextConfigRequestGeneration.current;
      latestConfigRequestGenerationByID.current.set(id, generation);
      await queueModConfigPersistence(id, config, generation);
      if (latestConfigRequestGenerationByID.current.get(id) === generation) {
        latestAppliedConfigMutationByID.current.set(id, generation);
        updateMods((mods) =>
          mods.map((mod) => (mod.id === id ? { ...mod, config } : mod)),
        );
      }
    },
    [queueModConfigPersistence, updateMods],
  );

  const refreshMods = useCallback(
    async (ids?: string[]): Promise<IMods> => {
      const refreshSequence = ++nextRefreshSequence.current;
      const configRequestGenerationAtStart =
        nextConfigRequestGeneration.current;
      const unpersistedConfigIDsAtStart = new Set(
        Array.from(latestAppliedConfigMutationByID.current).flatMap(
          ([id, generation]) =>
            generation >
            (latestPersistedConfigMutationByID.current.get(id) ?? 0)
              ? [id]
              : [],
        ),
      );
      const isFullRefresh = ids == null;
      if (isFullRefresh) {
        latestFullRefreshRequest.current = refreshSequence;
        pendingFullRefreshes.current += 1;
        setIsLoadingMods(true);
      } else {
        for (const id of ids) {
          latestPartialRefreshRequestByID.current.set(id, refreshSequence);
        }
      }

      try {
        const mods = await startupMeasure('renderer', 'refreshMods', () =>
          getMods(ids),
        );
        if (ids != null) {
          const currentIDs = new Set(
            ids.filter(
              (id) =>
                latestPartialRefreshRequestByID.current.get(id) ===
                refreshSequence,
            ),
          );
          if (currentIDs.size === 0) {
            return mods;
          }

          for (const id of currentIDs) {
            latestPartialRefreshCommitByID.current.set(id, refreshSequence);
          }
          if (initialLoadIsPending.current) {
            for (const id of currentIDs) {
              initialLoadPartialIDs.current.add(id);
            }
          }
          const refreshedByID = new Map(
            mods
              .filter((mod) => currentIDs.has(mod.id))
              .map((mod) => [mod.id, mod]),
          );
          updateMods((oldMods) => {
            const oldIDs = new Set(oldMods.map((mod) => mod.id));
            const currentByID = new Map(oldMods.map((mod) => [mod.id, mod]));
            const preserveNewerConfig = (mod: Mod): Mod => {
              const currentMod = currentByID.get(mod.id);
              return currentMod != null &&
                ((latestAppliedConfigMutationByID.current.get(mod.id) ?? 0) >
                  configRequestGenerationAtStart ||
                  unpersistedConfigIDsAtStart.has(mod.id))
                ? { ...mod, config: currentMod.config }
                : mod;
            };
            return oldMods
              .filter(
                (oldMod) =>
                  !currentIDs.has(oldMod.id) || refreshedByID.has(oldMod.id),
              )
              .map((oldMod) =>
                preserveNewerConfig(refreshedByID.get(oldMod.id) ?? oldMod),
              )
              .concat(
                mods
                  .filter(
                    (mod) => currentIDs.has(mod.id) && !oldIDs.has(mod.id),
                  )
                  .map(preserveNewerConfig),
              );
          });
        } else {
          if (latestFullRefreshRequest.current !== refreshSequence) {
            return mods;
          }
          const partiallyRefreshedIDs = new Set(
            Array.from(latestPartialRefreshCommitByID.current)
              .filter(([, sequence]) => sequence > refreshSequence)
              .map(([id]) => id),
          );
          latestCommittedFullRefresh.current = refreshSequence;
          updateMods((currentMods) => {
            const currentByID = new Map(
              currentMods.map((mod) => [mod.id, mod]),
            );
            return mergeFullModsWithPartialRefreshes(
              mods,
              currentMods,
              partiallyRefreshedIDs,
            ).map((mod) => {
              const currentMod = currentByID.get(mod.id);
              return currentMod != null &&
                ((latestAppliedConfigMutationByID.current.get(mod.id) ?? 0) >
                  configRequestGenerationAtStart ||
                  unpersistedConfigIDsAtStart.has(mod.id))
                ? { ...mod, config: currentMod.config }
                : mod;
            });
          });
        }
        setModsRevision((revision) => revision + 1);
        return mods;
      } finally {
        if (isFullRefresh) {
          pendingFullRefreshes.current -= 1;
          if (
            pendingFullRefreshes.current === 0 &&
            !initialLoadIsPending.current
          ) {
            setIsLoadingMods(false);
          }
        }
      }
    },
    [getMods, updateMods],
  );

  const [installedMods, setInstalledMods] = useSavedState(
    'installed-mods',
    [] as IInstalledMods,
    (map) => JSON.stringify(map),
    (str) => JSON.parse(str),
  );

  const [enabledMods, setEnabledMods] = useSavedState(
    'enabled-mods',
    {} as IEnabledMods,
    (map) => JSON.stringify(map),
    (str) => JSON.parse(str),
  );

  const [sectionHeaders, setSectionHeaders] = useSavedState(
    'section-headers',
    { nextIndex: 0, headers: [] } as ISectionHeaders,
    (map) => JSON.stringify(map),
    (str) => JSON.parse(str),
  );

  const [itemsOrder, setItemsOrder] = useSavedState(
    'mods-order',
    [] as IItemsOrder,
    (arr) => JSON.stringify(arr),
    (str) => JSON.parse(str),
  );

  const [modConfigOverrides, setModConfigOverrides] =
    useModsContextConfigOverrides();
  const mods = useMemo(
    () =>
      modsWithoutOverrides.map((mod) => ({
        ...mod,
        info: {
          ...mod.info,
          ...modConfigOverrides[mod.id],
        },
      })),
    [modsWithoutOverrides, modConfigOverrides],
  );

  const updatedItemsOrder = useMemo(() => {
    const modIDs = mods.map((mod) => mod.id);
    const sectionHeaderIDs = sectionHeaders.headers.map(
      (sectionHeader) => sectionHeader.id,
    );
    const currentIDs = new Set([...modIDs, ...sectionHeaderIDs]);
    const existingOrderIDs = new Set(itemsOrder);
    return [
      ...itemsOrder.filter((id) => currentIDs.has(id)),
      ...modIDs.filter((id) => !existingOrderIDs.has(id)),
      ...sectionHeaderIDs.filter((id) => !existingOrderIDs.has(id)),
    ];
  }, [itemsOrder, mods, sectionHeaders]);

  const orderedItems = useMemo(() => {
    const orderByID = new Map<string, number>();
    updatedItemsOrder.forEach((id, index) => {
      if (!orderByID.has(id)) {
        orderByID.set(id, index);
      }
    });
    return [
      ...mods.map((mod) => ({
        type: 'mod' as const,
        id: mod.id,
        mod,
      })),
      ...sectionHeaders.headers.map((sectionHeader) => ({
        type: 'sectionHeader' as const,
        id: sectionHeader.id,
        sectionHeader,
      })),
    ].sort(
      (a, b) =>
        (orderByID.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (orderByID.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [mods, sectionHeaders, updatedItemsOrder]);

  const reorderItems = useCallback(
    (renderedFromIndex: number, renderedToIndex: number): void => {
      if (renderedFromIndex === renderedToIndex) {
        return;
      }

      const absoluteFromIndex = getAbsoluteIndexFromRenderedIndex(
        renderedFromIndex,
        orderedItems,
      );

      const absoluteToIndex = getAbsoluteIndexFromRenderedIndex(
        renderedToIndex,
        orderedItems,
      );

      const fromHiddenItemCount = getHiddenItemCountForSection(
        absoluteFromIndex,
        orderedItems,
      );

      const toHiddenItemCount = getHiddenItemCountForSection(
        absoluteToIndex,
        orderedItems,
      );

      const adjustedAbsoluteToIndex =
        absoluteToIndex +
        // if moving down, account for hidden section items
        (absoluteToIndex > absoluteFromIndex ? toHiddenItemCount : 0) +
        // if moving down, account for removed items
        (absoluteToIndex > absoluteFromIndex ? -fromHiddenItemCount : 0);

      const newOrder = updatedItemsOrder.slice();
      const removed = newOrder.splice(
        absoluteFromIndex,
        fromHiddenItemCount + 1,
      );
      newOrder.splice(adjustedAbsoluteToIndex, 0, ...removed);
      setItemsOrder(newOrder);
    },
    [orderedItems, updatedItemsOrder, setItemsOrder],
  );

  const [selectedModID, setSelectedModID] = useState<string | null>(null);

  const getModByID = useCallback(
    (modID: string | null): Mod | null =>
      mods.filter((mod) => mod.id === modID).shift() ?? null,
    [mods],
  );

  const selectedMod: ISelectedMod = useMemo(
    () => getModByID(selectedModID),
    [selectedModID, getModByID],
  );

  const setSelectedMod: ISelectedModMutator = useCallback(
    (action: React.SetStateAction<ISelectedMod>): void => {
      setSelectedModID((previousID) => {
        if (typeof action === 'function') {
          return action(getModByID(previousID))?.id ?? null;
        }
        return action?.id ?? null;
      });
    },
    [getModByID],
  );

  const modsToInstall = useMemo(
    () =>
      orderedItems
        .filter<IOrderedMod>(isOrderedMod)
        .filter(({ mod }) => enabledMods[mod.id] ?? false)
        .map(({ mod }) => mod),
    [orderedItems, enabledMods],
  );

  const isInstallConfigChanged = useMemo(() => {
    const installedModsNew: IInstalledMods = modsToInstall.map((mod) => ({
      id: mod.id,
      config: mod.config,
    }));
    return JSON.stringify(installedMods) != JSON.stringify(installedModsNew);
  }, [modsToInstall, installedMods]);

  const context = useMemo(
    (): IModsContext => ({
      enabledMods,
      installedMods,
      isInstallConfigChanged,
      isLoadingMods,
      modConfigOverrides,
      mods,
      modsRevision,
      modsToInstall,
      orderedItems,
      refreshMods,
      reorderItems,
      saveModConfig,
      sectionHeaders,
      selectedMod,
      setEnabledMods,
      setInstalledMods,
      setItemsOrder,
      setModConfig,
      setModConfigOverrides,
      setSectionHeaders,
      setSelectedMod,
    }),
    [
      enabledMods,
      installedMods,
      isInstallConfigChanged,
      isLoadingMods,
      modConfigOverrides,
      mods,
      modsRevision,
      modsToInstall,
      orderedItems,
      refreshMods,
      reorderItems,
      saveModConfig,
      sectionHeaders,
      selectedMod,
      setEnabledMods,
      setInstalledMods,
      setItemsOrder,
      setModConfig,
      setModConfigOverrides,
      setSectionHeaders,
      setSelectedMod,
    ],
  );

  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export function useEnabledMods(): [IEnabledMods, IEnabledModsMutator] {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return [context.enabledMods, context.setEnabledMods];
}

export function useInstalledMods(): [IInstalledMods, IInstalledModsMutator] {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return [context.installedMods, context.setInstalledMods];
}

export function useToggleMod(): (mod: Mod) => void {
  const [, setEnabledMods] = useEnabledMods();
  return useCallback(
    (mod: Mod): void =>
      setEnabledMods((prev) => ({
        ...prev,
        [mod.id]: !prev[mod.id],
      })),
    [setEnabledMods],
  );
}

export function useMods(): [IMods, IModsRefresher] {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return [context.mods, context.refreshMods];
}

export function useModsRevision(): number {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return context.modsRevision;
}

export function useIsLoadingMods(): boolean {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return context.isLoadingMods;
}

export function useSectionHeaders(): [ISectionHeaders, ISectionHeadersMutator] {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return [context.sectionHeaders, context.setSectionHeaders];
}

export function useAddSectionHeader(): () => void {
  const [, setSectionHeaders] = useSectionHeaders();
  return useCallback(() => {
    setSectionHeaders((oldSectionHeaders) => ({
      nextIndex: oldSectionHeaders.nextIndex + 1,
      headers: [
        ...oldSectionHeaders.headers,
        {
          id: `sectionHeader:${oldSectionHeaders.nextIndex}`,
          label: 'New Section Header',
          isExpanded: true,
        },
      ],
    }));
  }, [setSectionHeaders]);
}

export function useRemoveSectionHeader(id: string): () => void {
  const [, setSectionHeaders] = useSectionHeaders();
  return useCallback(() => {
    setSectionHeaders((oldSectionHeaders) => ({
      ...oldSectionHeaders,
      headers: oldSectionHeaders.headers.filter((header) => header.id !== id),
    }));
  }, [id, setSectionHeaders]);
}

export function useRenameSectionHeader(id: string): (newName: string) => void {
  const [, setSectionHeaders] = useSectionHeaders();
  return useCallback(
    (newName: string) => {
      setSectionHeaders((oldSectionHeaders) => ({
        ...oldSectionHeaders,
        headers: oldSectionHeaders.headers.map((header) => {
          if (header.id === id) {
            return { ...header, label: newName };
          }
          return header;
        }),
      }));
    },
    [id, setSectionHeaders],
  );
}

export function useToggleSectionHeader(id: string): () => void {
  const [, setSectionHeaders] = useSectionHeaders();
  return useCallback(() => {
    setSectionHeaders((oldSectionHeaders) => ({
      ...oldSectionHeaders,
      headers: oldSectionHeaders.headers.map((header) => {
        if (header.id === id) {
          return { ...header, isExpanded: !header.isExpanded };
        }
        return header;
      }),
    }));
  }, [id, setSectionHeaders]);
}

export function useSetItemsOrder(): React.Dispatch<
  React.SetStateAction<IItemsOrder>
> {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return context.setItemsOrder;
}

export function useOrdereredItems(): [IOrderedItems, IItemsOrderMutator] {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return [context.orderedItems, context.reorderItems];
}

export function useModsToInstall(): IOrderedMods {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return context.modsToInstall;
}

export function useSelectedMod(): [ISelectedMod, ISelectedModMutator] {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return [context.selectedMod, context.setSelectedMod];
}

export function useSetModConfig(): IModsContext['setModConfig'] {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return context.setModConfig;
}

export function useSaveModConfig(): IModsContext['saveModConfig'] {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return context.saveModConfig;
}

export function useIsInstallConfigChanged(): boolean {
  const context = useContext(Context);
  if (context == null) {
    throw new Error('No preferences context available.');
  }
  return context.isInstallConfigChanged;
}
