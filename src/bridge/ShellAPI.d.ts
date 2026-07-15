export type IShellAPI = {
  openExternal: (url: string) => Promise<void>;
  selectDirectory: (defaultPath?: string) => Promise<string | null>;
  showItemInFolder: (path: string) => Promise<void>;
};
