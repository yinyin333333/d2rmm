export type D2RLoaderPluginSourceType = 'managed' | 'mod';

export type D2RLoaderPluginCategory = 'config' | 'patches' | 'plugins';

export type D2RLoaderPluginSource =
  | {
      packageName: string;
      sourcePath: string;
      sourceType: 'managed';
    }
  | {
      category: D2RLoaderPluginCategory;
      loaderRootPath: string;
      modID: string;
      sourcePath: string;
      sourceType: 'mod';
    };

export type D2RLoaderPluginEditableSource = D2RLoaderPluginSource;

export type D2RLoaderPluginInventoryItem = {
  deletionSource: D2RLoaderPluginSource;
  editableSource: D2RLoaderPluginEditableSource | null;
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
  deploymentSignature: string;
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
  packageName: string | null;
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
  deleteSource: (
    source: D2RLoaderPluginSource,
    expectedSha256: string,
  ) => Promise<void>;
  importSources: (
    sourcePaths: string[],
  ) => Promise<D2RLoaderPluginImportResult>;
  readEditableJSON: (
    source: D2RLoaderPluginEditableSource,
  ) => Promise<D2RLoaderPluginEditableJSON>;
  readInventory: (modIDs: string[]) => Promise<D2RLoaderPluginInventory>;
  saveEditableJSON: (
    source: D2RLoaderPluginEditableSource,
    expectedSha256: string,
    contents: string,
  ) => Promise<D2RLoaderPluginEditResult>;
};
