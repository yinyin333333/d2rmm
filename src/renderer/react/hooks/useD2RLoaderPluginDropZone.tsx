import ElectronUtilsAPI from 'renderer/ElectronUtilsAPI';
import { useD2RLoaderPluginManager } from 'renderer/react/context/D2RLoaderPluginContext';
import { useIsInstalling } from 'renderer/react/context/InstallContext';
import useToast from 'renderer/react/hooks/useToast';
import { useCallback, useRef, useState } from 'react';

export type D2RLoaderPluginDropZoneHandlers = {
  isDraggingOver: boolean;
  onDragEnter: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
};

const SUPPORTED_LOOSE_EXTENSIONS = new Set([
  '.dll',
  '.json',
  '.jsonc',
  '.toml',
  '.txt',
  '.zip',
]);

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase();
}

export default function useD2RLoaderPluginDropZone(): D2RLoaderPluginDropZoneHandlers {
  const showToast = useToast();
  const {
    hasUnsavedEdits = false,
    importSources,
    isMutating,
  } = useD2RLoaderPluginManager();
  const [isInstalling] = useIsInstalling();
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragDepth = useRef(0);

  const onDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current += 1;
    if (dragDepth.current === 1) setIsDraggingOver(true);
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDraggingOver(false);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setIsDraggingOver(false);

      if (hasUnsavedEdits || isInstalling || isMutating) {
        showToast({
          duration: 4000,
          severity: 'info',
          title: hasUnsavedEdits
            ? 'Save or cancel file edits before importing packages'
            : isInstalling
              ? 'Wait for Install Mods to finish before importing packages'
              : 'Wait for the current package change to finish',
        });
        return;
      }

      const droppedFiles = Array.from(event.dataTransfer.files).map(
        (file, index) => ({
          entry: event.dataTransfer.items[index]?.webkitGetAsEntry(),
          extension: extensionOf(file.name),
          path: ElectronUtilsAPI.getPathForFile(file),
        }),
      );
      // A loose DLL package may contain arbitrary companion assets (INI, BIN,
      // images, and so on). Preserve the whole batch and let the worker map or
      // explicitly retain those files instead of silently discarding them here.
      const preserveLooseCompanions = droppedFiles.some(
        ({ entry, extension }) => !entry?.isDirectory && extension === '.dll',
      );
      const sourcePaths = droppedFiles
        .filter(
          ({ entry, extension }) =>
            entry?.isDirectory ||
            preserveLooseCompanions ||
            SUPPORTED_LOOSE_EXTENSIONS.has(extension),
        )
        .map(({ path }) => path);
      const ignoredCount = droppedFiles.length - sourcePaths.length;

      if (ignoredCount > 0) {
        showToast({
          duration: 4000,
          severity: 'info',
          title: `${ignoredCount} unsupported file${ignoredCount === 1 ? '' : 's'} ignored`,
        });
      }
      if (sourcePaths.length === 0) return;

      void importSources(sourcePaths)
        .then((result) => {
          showToast({
            duration: 5000,
            severity: result.warnings.length > 0 ? 'warning' : 'success',
            title: `${result.packages.length} D2RLoader package${
              result.packages.length === 1 ? '' : 's'
            } imported`,
            description:
              result.warnings.length === 0
                ? `${result.importedFiles} file${
                    result.importedFiles === 1 ? '' : 's'
                  } preserved in D2RMM storage.`
                : `${result.warnings.length} file mapping warning${
                    result.warnings.length === 1 ? '' : 's'
                  }. Review the package details in Plugins.`,
          });
        })
        .catch((error) => {
          showToast({
            severity: 'error',
            title: 'Failed to import D2RLoader package',
            description: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [hasUnsavedEdits, importSources, isInstalling, isMutating, showToast],
  );

  return { isDraggingOver, onDragEnter, onDragLeave, onDragOver, onDrop };
}
