export type MainLifecycleDependencies<TWindow> = {
  bindWindow: (window: TWindow) => Promise<void>;
  initAppInfoAPI: () => Promise<void>;
  initConsoleAPI: () => Promise<void>;
  initEventAPI: () => Promise<void>;
  initNxmProtocolAPI: () => Promise<void>;
  initRequestAPI: () => Promise<void>;
  initShellAPI: () => Promise<void>;
  spawnWorker: () => Promise<void>;
};

export type MainLifecycleCoordinator<TWindow> = {
  attachWindow: (window: TWindow) => Promise<void>;
};

export function createMainLifecycleCoordinator<TWindow>(
  dependencies: MainLifecycleDependencies<TWindow>,
): MainLifecycleCoordinator<TWindow> {
  let processInitialization: Promise<void> | null = null;

  const initializeProcess = async (): Promise<void> => {
    await dependencies.initEventAPI();
    await dependencies.initConsoleAPI();
    await dependencies.initAppInfoAPI();
    await dependencies.initShellAPI();
    await dependencies.initRequestAPI();
    await dependencies.initNxmProtocolAPI();
    await dependencies.spawnWorker();
  };

  return {
    attachWindow: async (window) => {
      await dependencies.bindWindow(window);
      processInitialization ??= initializeProcess();
      await processInitialization;
    },
  };
}
