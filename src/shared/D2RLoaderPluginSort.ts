import type { D2RLoaderPluginInventoryItem } from 'bridge/D2RLoaderPluginAPI';
import {
  getPluginPreferenceKey,
  type D2RLoaderPluginPreference,
} from 'shared/D2RLoaderPluginPreferences';

export const PLUGIN_SORT_OPTIONS = [
  'default',
  'nameAsc',
  'nameDesc',
  'enabledFirst',
  'disabledFirst',
  'newest',
  'oldest',
  'tagsAsc',
  'tagsDesc',
] as const;

export type PluginSortOrder = (typeof PLUGIN_SORT_OPTIONS)[number];

export function sortPluginInventory(
  items: D2RLoaderPluginInventoryItem[],
  preferences: Record<string, D2RLoaderPluginPreference>,
  order: PluginSortOrder,
  locale?: string,
): D2RLoaderPluginInventoryItem[] {
  if (order === 'default') return items;
  const compare = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: 'base',
  }).compare;
  const preference = (item: D2RLoaderPluginInventoryItem) =>
    preferences[getPluginPreferenceKey(item.deletionSource)];
  const tags = (item: D2RLoaderPluginInventoryItem) =>
    [...(preference(item)?.tags ?? [])].sort(compare).join(', ');
  const byName = (
    a: D2RLoaderPluginInventoryItem,
    b: D2RLoaderPluginInventoryItem,
  ) =>
    compare(a.sourceName, b.sourceName) ||
    compare(a.pluginInfo?.name ?? a.name, b.pluginInfo?.name ?? b.name) ||
    compare(a.relativePath, b.relativePath) ||
    compare(a.id, b.id);

  // Sorting before grouping keeps packages together. A mod group is positioned
  // by its first matching file; its files follow the same selected order.
  return [...items].sort((a, b) => {
    let result = 0;
    if (order === 'nameAsc' || order === 'nameDesc') {
      return byName(a, b) * (order === 'nameAsc' ? 1 : -1);
    }
    if (order === 'enabledFirst' || order === 'disabledFirst') {
      result =
        (Number(preference(a)?.enabled === false) -
          Number(preference(b)?.enabled === false)) *
        (order === 'enabledFirst' ? 1 : -1);
    } else if (order === 'newest' || order === 'oldest') {
      const aTime = Date.parse(a.addedAt ?? '');
      const bTime = Date.parse(b.addedAt ?? '');
      if (Number.isFinite(aTime) !== Number.isFinite(bTime)) {
        return Number.isFinite(aTime) ? -1 : 1;
      }
      result =
        Number.isFinite(aTime) && Number.isFinite(bTime)
          ? (aTime - bTime) * (order === 'oldest' ? 1 : -1)
          : 0;
    } else {
      const aTags = tags(a);
      const bTags = tags(b);
      if ((aTags === '') !== (bTags === '')) return aTags === '' ? 1 : -1;
      result = compare(aTags, bTags) * (order === 'tagsAsc' ? 1 : -1);
    }
    return result || byName(a, b);
  });
}
