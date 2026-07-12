import type {
  D2RLoaderPluginEditableJSON,
  D2RLoaderPluginInventoryItem,
  D2RLoaderPluginPackageSummary,
} from 'bridge/D2RLoaderPluginAPI';
import BridgeAPI from 'renderer/BridgeAPI';
import ShellAPI from 'renderer/ShellAPI';
import { useD2RLoaderPluginManager } from 'renderer/react/context/D2RLoaderPluginContext';
import {
  useDialog,
  useDialogContext,
} from 'renderer/react/context/DialogContext';
import { useIsInstalling } from 'renderer/react/context/InstallContext';
import useToast from 'renderer/react/hooks/useToast';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  DeleteOutline,
  EditOutlined,
  ExpandMore,
  FolderOpen,
  Refresh,
  Security,
} from '@mui/icons-material';
import { LoadingButton } from '@mui/lab';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';

type InventoryGroup = {
  id: string;
  items: D2RLoaderPluginInventoryItem[];
  sourceName: string;
  sourceType: D2RLoaderPluginInventoryItem['sourceType'];
};

function groupInventoryItems(
  items: D2RLoaderPluginInventoryItem[],
): InventoryGroup[] {
  const groups = new Map<string, InventoryGroup>();
  for (const item of items) {
    const id = `${item.sourceType}:${item.packageName ?? item.sourceName}`;
    const existing = groups.get(id);
    if (existing == null) {
      groups.set(id, {
        id,
        items: [item],
        sourceName: item.sourceName,
        sourceType: item.sourceType,
      });
    } else {
      existing.items.push(item);
    }
  }
  return Array.from(groups.values());
}

function EditableInventoryFile({
  disabled,
  item,
}: {
  disabled: boolean;
  item: D2RLoaderPluginInventoryItem;
}): JSX.Element {
  const editorID = useId();
  const showToast = useToast();
  const { readEditableJSON, saveEditableJSON, setEditableJSONDirty } =
    useD2RLoaderPluginManager();
  const [document, setDocument] = useState<D2RLoaderPluginEditableJSON | null>(
    null,
  );
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [loadedInventorySha, setLoadedInventorySha] = useState<string | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const packageName = item.packageName;
  const sourcePath = item.editableSourcePath;
  const isEditable =
    item.sourceType === 'managed' && packageName != null && sourcePath != null;
  const editorLabel = `${item.name} in ${packageName ?? item.sourceName}`;
  const isDirty = document != null && draft !== document.contents;

  useEffect(() => {
    setEditableJSONDirty(item.id, isEditable && isDirty);
  }, [isDirty, isEditable, item.id, setEditableJSONDirty]);

  useEffect(
    () => () => {
      setEditableJSONDirty(item.id, false);
    },
    [item.id, setEditableJSONDirty],
  );

  const loadDocument = useCallback(async () => {
    if (!isEditable) return;
    setError(null);
    setIsLoading(true);
    try {
      const nextDocument = await readEditableJSON(packageName, sourcePath);
      setDocument(nextDocument);
      setDraft(nextDocument.contents);
      setLoadedInventorySha(item.sha256);
      setIsStale(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setIsLoading(false);
    }
  }, [isEditable, item.sha256, packageName, readEditableJSON, sourcePath]);

  useEffect(() => {
    if (
      document == null ||
      loadedInventorySha == null ||
      isSaving ||
      item.sha256.toLowerCase() === loadedInventorySha.toLowerCase()
    ) {
      return;
    }
    if (item.sha256.toLowerCase() === document.sha256.toLowerCase()) {
      setLoadedInventorySha(item.sha256);
      return;
    }
    if (draft !== document.contents) {
      setIsStale(true);
      setError(
        new Error(
          'This file changed in storage while you were editing it. Reload to discard this draft and open the latest version.',
        ),
      );
      return;
    }
    setDocument(null);
    setDraft('');
    setLoadedInventorySha(null);
    setError(null);
    setIsStale(false);
    if (isExpanded) loadDocument().catch(console.error);
  }, [
    document,
    draft,
    isExpanded,
    isSaving,
    item.sha256,
    loadDocument,
    loadedInventorySha,
  ]);

  const onToggle = useCallback(async () => {
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
    setIsExpanded(true);
    if (document == null) await loadDocument();
  }, [document, isExpanded, loadDocument]);

  const onCancel = useCallback(() => {
    if (isStale) {
      setDocument(null);
      setDraft('');
      setLoadedInventorySha(null);
      setIsStale(false);
    } else {
      setDraft(document?.contents ?? '');
    }
    setError(null);
    setIsExpanded(false);
  }, [document, isStale]);

  const onReload = useCallback(async () => {
    setDocument(null);
    setDraft('');
    setLoadedInventorySha(null);
    setError(null);
    setIsStale(false);
    await loadDocument();
  }, [loadDocument]);

  const onSave = useCallback(async () => {
    if (!isEditable || document == null) return;
    setError(null);
    setIsSaving(true);
    try {
      const result = await saveEditableJSON(
        packageName,
        sourcePath,
        document.sha256,
        draft,
      );
      setDocument({ ...document, contents: draft, sha256: result.sha256 });
      setIsStale(false);
      showToast({
        duration: 4000,
        severity: result.warnings.length === 0 ? 'success' : 'warning',
        title: `${item.name} saved`,
        description:
          result.warnings.length === 0
            ? 'Run Install Mods to deploy this change.'
            : result.warnings.join(' '),
      });
    } catch (caught) {
      const nextError =
        caught instanceof Error ? caught : new Error(String(caught));
      setError(nextError);
      if (
        /changed (?:since|while|before)|revision|re-import/i.test(
          nextError.message,
        )
      ) {
        setIsStale(true);
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    document,
    draft,
    isEditable,
    item.name,
    packageName,
    saveEditableJSON,
    showToast,
    sourcePath,
  ]);

  return (
    <Box>
      <ListItem
        component="div"
        secondaryAction={
          isEditable ? (
            <Button
              aria-controls={editorID}
              aria-expanded={isExpanded}
              aria-label={`Edit ${editorLabel}`}
              disabled={disabled || isLoading || isSaving}
              endIcon={
                <ExpandMore
                  sx={{
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: (theme) =>
                      theme.transitions.create('transform'),
                  }}
                />
              }
              onClick={() => onToggle().catch(console.error)}
              size="small"
              startIcon={<EditOutlined />}
            >
              Edit
            </Button>
          ) : undefined
        }
      >
        <ListItemText
          primary={item.name}
          secondary={
            item.relativePath === item.name ? undefined : item.relativePath
          }
        />
      </ListItem>
      {isEditable ? (
        <Collapse in={isExpanded} timeout="auto" unmountOnExit={true}>
          <Box
            aria-labelledby={`${editorID}-label`}
            id={editorID}
            role="region"
            sx={{
              bgcolor: 'action.hover',
              borderTop: 1,
              borderColor: 'divider',
              p: 1.5,
            }}
          >
            <Typography
              id={`${editorID}-label`}
              sx={{ fontWeight: 600, mb: 1 }}
              variant="body2"
            >
              {editorLabel}
            </Typography>
            {error != null ? (
              <Alert
                action={
                  isStale ? (
                    <Button
                      aria-label={`Reload ${editorLabel}`}
                      color="inherit"
                      onClick={() => onReload().catch(console.error)}
                      size="small"
                    >
                      Reload
                    </Button>
                  ) : undefined
                }
                severity="error"
                sx={{ mb: 1 }}
              >
                {error.message}
              </Alert>
            ) : null}
            {isLoading ? (
              <LoadingButton loading={true}>Loading</LoadingButton>
            ) : document == null ? (
              <Button onClick={() => loadDocument().catch(console.error)}>
                Retry
              </Button>
            ) : (
              <>
                <TextField
                  fullWidth={true}
                  inputProps={{
                    'aria-label': `JSON editor for ${editorLabel}`,
                    spellCheck: false,
                  }}
                  maxRows={24}
                  minRows={8}
                  multiline={true}
                  onChange={(event) => setDraft(event.target.value)}
                  sx={{
                    '& textarea': {
                      fontFamily: 'Consolas, "Courier New", monospace',
                      fontSize: '0.82rem',
                      lineHeight: 1.5,
                    },
                  }}
                  value={draft}
                />
                <Stack
                  alignItems="center"
                  direction="row"
                  justifyContent="flex-end"
                  spacing={1}
                  sx={{ mt: 1 }}
                >
                  <Typography
                    color="text.secondary"
                    sx={{ flex: 1 }}
                    variant="caption"
                  >
                    Saving updates D2RMM storage only. Install Mods deploys it.
                  </Typography>
                  <Button
                    aria-label={`Cancel editing ${editorLabel}`}
                    disabled={isSaving}
                    onClick={onCancel}
                  >
                    Cancel
                  </Button>
                  <LoadingButton
                    aria-label={`Save ${editorLabel}`}
                    disabled={
                      disabled ||
                      isSaving ||
                      isStale ||
                      draft === document.contents
                    }
                    loading={isSaving}
                    onClick={() => onSave().catch(console.error)}
                    variant="contained"
                  >
                    Save
                  </LoadingButton>
                </Stack>
              </>
            )}
          </Box>
        </Collapse>
      ) : null}
    </Box>
  );
}

function InventoryGroupCard({
  defaultExpanded,
  disabled,
  group,
}: {
  defaultExpanded: boolean;
  disabled: boolean;
  group: InventoryGroup;
}): JSX.Element {
  const filesID = useId();
  const { hasUnsavedEdits } = useD2RLoaderPluginManager();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const sourceLabel =
    group.sourceType === 'managed'
      ? `D2RMM package: ${group.sourceName}`
      : `Mod: ${group.sourceName}`;
  return (
    <Paper
      sx={{
        borderColor:
          group.sourceType === 'managed' ? 'primary.light' : 'divider',
        overflow: 'hidden',
      }}
      variant="outlined"
    >
      <Stack
        alignItems="center"
        direction="row"
        spacing={1}
        sx={{ bgcolor: 'action.hover', px: 1.5, py: 1 }}
      >
        <Typography sx={{ flex: 1, fontWeight: 600 }} variant="subtitle2">
          {sourceLabel}
        </Typography>
        <Chip
          label={`${group.items.length} file(s)`}
          size="small"
          variant="outlined"
        />
        <Chip
          color={group.sourceType === 'managed' ? 'primary' : 'default'}
          label={group.sourceType === 'managed' ? 'D2RMM' : 'MOD'}
          size="small"
          variant="outlined"
        />
        <Button
          aria-controls={filesID}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Hide' : 'Show'} files for ${sourceLabel}`}
          disabled={isExpanded && hasUnsavedEdits}
          endIcon={
            <ExpandMore
              sx={{
                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: (theme) => theme.transitions.create('transform'),
              }}
            />
          }
          onClick={() => setIsExpanded((expanded) => !expanded)}
          size="small"
        >
          {isExpanded ? 'Hide' : 'Show'}
        </Button>
      </Stack>
      <Collapse in={isExpanded} timeout="auto" unmountOnExit={true}>
        <Box aria-label={`Files for ${sourceLabel}`} id={filesID} role="region">
          <Divider />
          <List dense={true} disablePadding={true}>
            {group.items.map((item, index) => (
              <Box
                key={item.id}
                component="li"
                sx={{
                  borderBottom: index === group.items.length - 1 ? 0 : 1,
                  borderColor: 'divider',
                  listStyle: 'none',
                }}
              >
                <EditableInventoryFile disabled={disabled} item={item} />
              </Box>
            ))}
          </List>
        </Box>
      </Collapse>
    </Paper>
  );
}

function InventorySection({
  disabled,
  emptyText,
  items,
  title,
}: {
  disabled: boolean;
  emptyText: string;
  items: D2RLoaderPluginInventoryItem[];
  title: string;
}): JSX.Element {
  const groups = useMemo(() => groupInventoryItems(items), [items]);
  return (
    <Paper sx={{ flex: '1 1 0', minWidth: 0 }} variant="outlined">
      <Box sx={{ px: 2, py: 1.5 }}>
        <Typography variant="h6">
          {title} ({items.length})
        </Typography>
      </Box>
      <Divider />
      {items.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">
          {emptyText}
        </Typography>
      ) : (
        <Stack spacing={1.5} sx={{ p: 1.5 }}>
          {groups.map((group) => (
            <InventoryGroupCard
              key={group.id}
              defaultExpanded={items.length <= 200 && groups.length <= 20}
              disabled={disabled}
              group={group}
            />
          ))}
        </Stack>
      )}
    </Paper>
  );
}

function packageDetails(packageInfo: D2RLoaderPluginPackageSummary): string {
  const details = [
    `${packageInfo.pluginFiles.length} plugin file(s)`,
    `${packageInfo.patchFiles.length} patch file(s)`,
  ];
  if (packageInfo.configFiles.length > 0) {
    details.push(`${packageInfo.configFiles.length} config file(s)`);
  }
  if (packageInfo.dataFiles.length > 0) {
    details.push(`${packageInfo.dataFiles.length} mod data file(s)`);
  }
  if (packageInfo.unmappedFiles.length > 0) {
    details.push(`${packageInfo.unmappedFiles.length} preserved only`);
  }
  return details.join(' • ');
}

function PackageTargets({
  packageInfo,
}: {
  packageInfo: D2RLoaderPluginPackageSummary;
}): JSX.Element {
  const groups = [
    ['Plugins', 'd2rloader', packageInfo.pluginFiles],
    ['Patches', 'd2rloader', packageInfo.patchFiles],
    ['Config', 'd2rloader', packageInfo.configFiles],
    ['Mod data', 'MPQ data', packageInfo.dataFiles],
    ['Preserved only', 'storage', packageInfo.unmappedFiles],
  ] as const;
  return (
    <Stack spacing={0.5}>
      {groups.map(([label, root, files]) =>
        files.length === 0 ? null : (
          <Typography
            key={label}
            color={
              label === 'Preserved only' ? 'warning.main' : 'text.secondary'
            }
            sx={{ overflowWrap: 'anywhere' }}
            variant="caption"
          >
            {label}: {files.map((file) => `${root}/${file}`).join(', ')}
          </Typography>
        ),
      )}
    </Stack>
  );
}

function PackageDeleteDialog({
  onDelete,
  packageName,
}: {
  onDelete: (packageName: string) => Promise<void>;
  packageName: string;
}): JSX.Element {
  const { close, isOpen } = useDialogContext();
  const dialogTitleID = useId();
  const onConfirm = useCallback(() => {
    close();
    onDelete(packageName).catch(console.error);
  }, [close, onDelete, packageName]);
  return (
    <Dialog
      aria-labelledby={dialogTitleID}
      fullWidth={true}
      onClose={close}
      open={isOpen}
    >
      <DialogContent>
        <DialogContentText id={dialogTitleID}>
          Are you sure you want to delete &quot;{packageName}&quot;?
        </DialogContentText>
        <br />
        <DialogContentText>
          This will permanently remove the managed plugin package from D2RMM
          storage. Run Install Mods afterward to update the game mod output.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button color="error" onClick={onConfirm} variant="contained">
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PackageDeleteAction({
  disabled,
  onDelete,
  packageName,
}: {
  disabled: boolean;
  onDelete: (packageName: string) => Promise<void>;
  packageName: string;
}): JSX.Element {
  const [openDialog] = useDialog(
    <PackageDeleteDialog onDelete={onDelete} packageName={packageName} />,
  );
  return (
    <Tooltip title={`Delete ${packageName}`}>
      <span>
        <IconButton
          aria-label={`Delete ${packageName}`}
          disabled={disabled}
          onClick={openDialog}
        >
          <DeleteOutline />
        </IconButton>
      </span>
    </Tooltip>
  );
}

function ManagedPackageCard({
  disabled,
  onDelete,
  packageInfo,
}: {
  disabled: boolean;
  onDelete: (packageName: string) => Promise<void>;
  packageInfo: D2RLoaderPluginPackageSummary;
}): JSX.Element {
  const [showDetails, setShowDetails] = useState(false);
  const detailsID = useId();
  return (
    <Paper
      sx={{
        borderLeft: 4,
        borderLeftColor: 'primary.main',
        overflow: 'hidden',
      }}
      variant="outlined"
    >
      <Stack alignItems="center" direction="row" spacing={1} sx={{ p: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }} variant="subtitle1">
            {packageInfo.name}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {packageDetails(packageInfo)}
          </Typography>
        </Box>
        <Button
          aria-controls={detailsID}
          aria-expanded={showDetails}
          aria-label={`${showDetails ? 'Hide' : 'Show'} details for ${packageInfo.name}`}
          endIcon={
            <ExpandMore
              sx={{
                transform: showDetails ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: (theme) => theme.transitions.create('transform'),
              }}
            />
          }
          onClick={() => setShowDetails((visible) => !visible)}
          size="small"
        >
          Details
        </Button>
        <PackageDeleteAction
          disabled={disabled}
          onDelete={onDelete}
          packageName={packageInfo.name}
        />
      </Stack>
      {packageInfo.warnings.length > 0 ? (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          {packageInfo.warnings.join(' ')}
        </Alert>
      ) : null}
      <Collapse in={showDetails} timeout="auto" unmountOnExit={true}>
        <Divider />
        <Box
          aria-label={`Deployment targets for ${packageInfo.name}`}
          id={detailsID}
          role="region"
          sx={{ p: 1.5 }}
        >
          <PackageTargets packageInfo={packageInfo} />
        </Box>
      </Collapse>
    </Paper>
  );
}

export default function ModManagerPlugins(): JSX.Element {
  const showToast = useToast();
  const [isInstalling] = useIsInstalling();
  const {
    deletePackage,
    error,
    hasUnsavedEdits,
    inventory,
    isInventoryCurrent,
    isLoading,
    isMutating,
    refresh,
  } = useD2RLoaderPluginManager();

  const onOpenManagedRoot = useCallback(async () => {
    try {
      await BridgeAPI.createDirectory(inventory.managedRoot);
      await ShellAPI.showItemInFolder(inventory.managedRoot);
    } catch (caught) {
      showToast({
        severity: 'error',
        title: 'Failed to open D2RLoader package storage',
        description: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }, [inventory.managedRoot, showToast]);

  const onDeletePackage = useCallback(
    async (packageName: string) => {
      try {
        await deletePackage(packageName);
        showToast({
          duration: 4000,
          severity: 'success',
          title: `${packageName} deleted`,
        });
      } catch (caught) {
        showToast({
          severity: 'error',
          title: `Failed to delete ${packageName}`,
          description:
            caught instanceof Error ? caught.message : String(caught),
        });
      }
    },
    [deletePackage, showToast],
  );

  const isPackageActionDisabled = hasUnsavedEdits || isInstalling || isMutating;
  const isEditorActionDisabled = isInstalling || isMutating;

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'auto',
        p: 2,
      }}
    >
      <Stack alignItems="center" direction="row" spacing={1}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">D2RLoader Plugins</Typography>
          <Typography color="text.secondary" variant="body2">
            Drop DLL, patch JSON, plugin folders, or ZIP packages here. Refresh
            Mod List also refreshes mod-scoped loader files.
          </Typography>
        </Box>
        <Button
          disabled={inventory.managedRoot === '' || isMutating}
          onClick={() => onOpenManagedRoot().catch(console.error)}
          startIcon={<FolderOpen />}
        >
          Open Storage
        </Button>
        <LoadingButton
          disabled={isMutating}
          loading={isLoading || isMutating}
          onClick={() => refresh().catch(console.error)}
          startIcon={<Refresh />}
          variant="outlined"
        >
          Refresh
        </LoadingButton>
      </Stack>

      <Alert icon={<Security />} severity="warning" sx={{ mt: 2 }}>
        DLL plugins execute native code and patch JSON files modify game memory.
        Import only files you trust. Managed packages are deployed to the
        selected D2RLoader mod output when Install Mods runs.
      </Alert>

      {error != null ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error.message}
        </Alert>
      ) : null}
      {hasUnsavedEdits ? (
        <Alert severity="warning" sx={{ mt: 2 }}>
          An edited JSON file has unsaved changes. Save or cancel it before
          importing, deleting, installing, or running D2R.
        </Alert>
      ) : null}
      {!isInventoryCurrent ? (
        <Alert severity="warning" sx={{ mt: 2 }}>
          A package change was saved, but the plugin list could not be
          refreshed. Refresh successfully before installing or running D2R.
        </Alert>
      ) : null}
      {inventory.conflicts.map((conflict) => (
        <Alert key={conflict} severity="error" sx={{ mt: 1 }}>
          {conflict}
        </Alert>
      ))}

      {inventory.packages.length > 0 ? (
        <Box sx={{ mt: 2 }}>
          <Typography sx={{ mb: 1 }} variant="h6">
            D2RMM-managed packages ({inventory.packages.length})
          </Typography>
          <Stack spacing={1.5}>
            {inventory.packages.map((packageInfo) => (
              <ManagedPackageCard
                key={packageInfo.name}
                disabled={isPackageActionDisabled}
                onDelete={onDeletePackage}
                packageInfo={packageInfo}
              />
            ))}
          </Stack>
        </Box>
      ) : null}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 2 }}>
        <InventorySection
          disabled={isEditorActionDisabled}
          emptyText="No plugin files found."
          items={inventory.plugins}
          title="Plugins"
        />
        <InventorySection
          disabled={isEditorActionDisabled}
          emptyText="No patch JSON files found."
          items={inventory.patches}
          title="Patches"
        />
      </Stack>
    </Box>
  );
}
