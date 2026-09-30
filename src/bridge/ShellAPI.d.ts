export type D2RLoaderLogScope = 'loader' | 'loader-and-mod' | 'all';

export type D2RLoaderLogExportResult = {
  path: string;
  missingDirectories: string[];
};

export type IShellAPI = {
  exportD2RLoaderLogs: (
    gamePath: string,
    outputModName: string,
    scope: D2RLoaderLogScope,
  ) => Promise<D2RLoaderLogExportResult | null>;
  openExternal: (url: string) => Promise<void>;
  openPath: (path: string) => Promise<void>;
  selectDirectory: (defaultPath?: string) => Promise<string | null>;
  showItemInFolder: (path: string) => Promise<void>;
};
