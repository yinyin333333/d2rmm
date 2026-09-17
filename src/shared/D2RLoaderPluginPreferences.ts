import type { D2RLoaderPluginSource } from 'bridge/D2RLoaderPluginAPI';

export type D2RLoaderPluginPreference = {
  enabled: boolean;
  tags: string[];
  notes: string;
  source: D2RLoaderPluginSource;
};

function normalize(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

// Managed preferences belong to the entire imported package, including data
// files that do not appear in the plugin/config inventory tabs.
export function getPluginPreferenceKey(source: D2RLoaderPluginSource): string {
  return JSON.stringify(
    source.sourceType === 'managed'
      ? ['managed', normalize(source.packageName)]
      : [
          'mod',
          normalize(source.modID),
          normalize(source.loaderRootPath),
          source.category,
          normalize(source.sourcePath),
        ],
  );
}

export function migratePluginPreferences(
  saved: Record<string, D2RLoaderPluginPreference>,
): Record<string, D2RLoaderPluginPreference> {
  const result: Record<string, D2RLoaderPluginPreference> = {};
  for (const preference of Object.values(saved)) {
    const key = getPluginPreferenceKey(preference.source);
    const previous = result[key];
    result[key] =
      previous == null
        ? preference
        : {
            ...previous,
            enabled: previous.enabled && preference.enabled,
            tags: Array.from(new Set([...previous.tags, ...preference.tags])),
            notes: Array.from(
              new Set([previous.notes, preference.notes].filter(Boolean)),
            ).join('\n\n'),
          };
  }
  return result;
}

export function isModPluginDisabled(
  sources: D2RLoaderPluginSource[] | undefined,
  modID: string,
  outputPath: string,
): boolean {
  const target = normalize(outputPath);
  return (
    sources?.some(
      (source) =>
        source.sourceType === 'mod' &&
        normalize(source.modID) === normalize(modID) &&
        target ===
          `../../d2rloader/${source.category}/${normalize(source.sourcePath)}`,
    ) ?? false
  );
}
