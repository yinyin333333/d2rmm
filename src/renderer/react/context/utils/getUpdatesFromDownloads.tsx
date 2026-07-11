import type { ModUpdaterDownload } from 'bridge/ModUpdaterAPI';
import { compareVersions } from 'shared/version';

export default function getUpdatesFromDownloads(
  currentVersion: string,
  downloads: ModUpdaterDownload[],
): ModUpdaterDownload[] {
  return downloads.filter(
    (download) => compareVersions(download.version, currentVersion) < 0,
  );
}
