export type D2RLoaderPluginSourceType = 'managed' | 'mod';

export type D2RLoaderPluginInventoryItem = {
  editableSourcePath: string | null;
  id: string;
  name: string;
  packageName: string | null;
  relativePath: string;
  sha256: string;
  sourceName: string;
  sourceType: D2RLoaderPluginSourceType;
};

export type D2RLoaderPluginPackageSummary = {
  configFiles: string[];
  dataFiles: string[];
  name: string;
  pluginFiles: string[];
  patchFiles: string[];
  unmappedFiles: string[];
  warnings: string[];
};

export type D2RLoaderPluginInventory = {
  configs: D2RLoaderPluginInventoryItem[];
  conflicts: string[];
  managedSignature: string;
  managedRoot: string;
  packages: D2RLoaderPluginPackageSummary[];
  patches: D2RLoaderPluginInventoryItem[];
  plugins: D2RLoaderPluginInventoryItem[];
};

export type D2RLoaderPluginImportResult = {
  importedFiles: number;
  packages: string[];
  warnings: string[];
};

export type D2RLoaderPluginEditableJSON = {
  contents: string;
  format: 'json' | 'toml';
  packageName: string;
  role: 'config' | 'patch' | 'plugin';
  sha256: string;
  sourcePath: string;
  targetPath: string;
};

export type D2RLoaderPluginEditResult = {
  sha256: string;
  warnings: string[];
};

export type ID2RLoaderPluginAPI = {
  deletePackage: (packageName: string) => Promise<void>;
  importSources: (
    sourcePaths: string[],
  ) => Promise<D2RLoaderPluginImportResult>;
  readEditableJSON: (
    packageName: string,
    sourcePath: string,
  ) => Promise<D2RLoaderPluginEditableJSON>;
  readInventory: (modIDs: string[]) => Promise<D2RLoaderPluginInventory>;
  saveEditableJSON: (
    packageName: string,
    sourcePath: string,
    expectedSha256: string,
    contents: string,
  ) => Promise<D2RLoaderPluginEditResult>;
};
