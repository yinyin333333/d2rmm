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
  Search,
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
  InputAdornment,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
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
  const editableSource = item.editableSource;
  const isEditable = editableSource != null;
  const editorLabel = `${item.name} from ${
    item.sourceType === 'managed'
      ? `D2RMM package ${item.packageName ?? item.sourceName}`
      : `mod ${item.sourceName}`
  }`;
  const editorFormat =
    document?.format === 'toml' ||
    (document == null && /\.toml$/i.test(item.editableSourcePath ?? ''))
      ? 'TOML'
      : 'JSON';
  const fileFormat = /\.dll$/i.test(item.name)
    ? 'DLL'
    : /\.toml$/i.test(item.name)
      ? 'TOML'
      : /\.jsonc?$/i.test(item.name)
        ? 'JSON'
        : 'FILE';
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
    if (editableSource == null) return;
    setError(null);
    setIsLoading(true);
    try {
      const nextDocument = await readEditableJSON(editableSource);
      setDocument(nextDocument);
      setDraft(nextDocument.contents);
      setLoadedInventorySha(item.sha256);
      setIsStale(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setIsLoading(false);
    }
  }, [editableSource, item.sha256, readEditableJSON]);

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
          'This file changed on disk while you were editing it. Reload to discard this draft and open the latest version.',
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
    if (editableSource == null || document == null) return;
    setError(null);
    setIsSaving(true);
    try {
      const result = await saveEditableJSON(
        editableSource,
        document.sha256,
        draft,
      );
      setDocument({ ...document, contents: draft, sha256: result.sha256 });
      setLoadedInventorySha(result.sha256);
      setIsStale(false);
      showToast({
        duration: 4000,
        severity: result.warnings.length === 0 ? 'success' : 'warning',
        title: `${item.name} saved`,
        description:
          result.warnings.length === 0
            ? item.sourceType === 'managed'
              ? 'D2RMM package storage was updated. Run Install Mods to deploy this change.'
              : 'The source file in the mod folder was updated. Run Install Mods to rebuild the output.'
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
    editableSource,
    item.name,
    item.sourceType,
    saveEditableJSON,
    showToast,
  ]);

  return (
    <Box>
      <ListItem
        component="div"
        secondaryAction={
          <Stack alignItems="center" direction="row" spacing={1}>
            <Chip
              color={isEditable ? 'primary' : 'default'}
              label={fileFormat}
              size="small"
              variant="outlined"
            />
            {isEditable ? (
              <Button
                aria-controls={editorID}
                aria-expanded={isExpanded}
                aria-label={`Edit ${editorLabel}`}
                disabled={disabled || isLoading || isSaving}
                endIcon={
                  <ExpandMore
                    sx={{
                      transform: isExpanded
                        ? 'rotate(180deg)'
                        : 'rotate(0deg)',
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
            ) : null}
          </Stack>
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
            {item.sourceType === 'mod' ? (
              <Alert severity="info" sx={{ mb: 1 }}>
                This edits the source file inside the mod folder directly. A mod
                update can overwrite the change; keep a backup of important
                customizations.
              </Alert>
            ) : null}
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
                    'aria-label': `${editorFormat} editor for ${editorLabel}`,
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
                    {item.sourceType === 'managed'
                      ? 'Saving updates D2RMM package storage. Install Mods deploys it.'
                      : 'Saving updates the mod source. Install Mods rebuilds the generated output.'}
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
  const [workspaceView, setWorkspaceView] = useState<'files' | 'packages'>(
    'files',
  );
  const [fileCategory, setFileCategory] = useState<
    'plugins' | 'patches' | 'configs'
  >('plugins');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'managed' | 'mod'>(
    'all',
  );
  const [searchQuery, setSearchQuery] = useState('');

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

  const categoryItems = inventory[fileCategory];
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const visibleItems = useMemo(
    () =>
      categoryItems.filter((item) => {
        if (sourceFilter !== 'all' && item.sourceType !== sourceFilter) {
          return false;
        }
        if (normalizedSearch === '') return true;
        return [
          item.name,
          item.relativePath,
          item.sourceName,
          item.packageName ?? '',
        ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
      }),
    [categoryItems, normalizedSearch, sourceFilter],
  );
  const totalFileCount =
    inventory.plugins.length +
    inventory.patches.length +
    inventory.configs.length;
  const sourceCount = new Set(
    [...inventory.plugins, ...inventory.patches, ...inventory.configs].map(
      (item) => `${item.sourceType}:${item.sourceName}`,
    ),
  ).size;
  const categoryTitle =
    fileCategory === 'plugins'
      ? 'Plugins'
      : fileCategory === 'patches'
        ? 'Patches'
        : 'Plugin Configs';
  const categoryEmptyText =
    normalizedSearch !== '' || sourceFilter !== 'all'
      ? 'No files match the current search and source filters.'
      : fileCategory === 'plugins'
        ? 'No plugin DLL or companion files were found.'
        : fileCategory === 'patches'
          ? 'No patch JSON/JSONC files were found.'
          : 'No plugin TOML config files were found.';
  const isPackageActionDisabled = hasUnsavedEdits || isInstalling || isMutating;
  const isEditorActionDisabled = isInstalling || isMutating;
  const workspaceStatus =
    error != null
      ? { color: 'error' as const, label: 'Scan failed' }
      : inventory.conflicts.length > 0
        ? { color: 'error' as const, label: 'Conflicts found' }
        : !isInventoryCurrent
          ? { color: 'warning' as const, label: 'Refresh required' }
          : isLoading
            ? { color: 'info' as const, label: 'Scanning' }
            : { color: 'success' as const, label: 'Ready' };

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'auto',
        p: { md: 2.5, xs: 1.5 },
      }}
    >
      <Box sx={{ maxWidth: 1320, mx: 'auto', width: '100%' }}>
        <Paper
          sx={{ overflow: 'hidden', p: { md: 2.5, xs: 2 } }}
          variant="outlined"
        >
          <Stack
            alignItems={{ md: 'flex-start', xs: 'stretch' }}
            direction={{ md: 'row', xs: 'column' }}
            spacing={2}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack alignItems="center" direction="row" spacing={1}>
                <Typography variant="h5">D2RLoader Plugins</Typography>
                <Chip
                  color={workspaceStatus.color}
                  label={workspaceStatus.label}
                  size="small"
                  variant="outlined"
                />
              </Stack>
              <Typography
                color="text.secondary"
                sx={{ mt: 0.5 }}
                variant="body2"
              >
                Import, inspect, and safely edit D2RLoader files from one
                focused workspace. D2RMM-managed packages and files supplied by
                enabled mods are always identified separately.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                disabled={inventory.managedRoot === '' || isMutating}
                onClick={() => onOpenManagedRoot().catch(console.error)}
                startIcon={<FolderOpen />}
                variant="outlined"
              >
                Open package storage
              </Button>
              <LoadingButton
                disabled={hasUnsavedEdits || isMutating}
                loading={isLoading || isMutating}
                onClick={() => refresh().catch(console.error)}
                startIcon={<Refresh />}
                variant="contained"
              >
                Refresh inventory
              </LoadingButton>
            </Stack>
          </Stack>

          <Box
            sx={{
              alignItems: 'center',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              borderStyle: 'dashed',
              display: 'flex',
              gap: 1.5,
              mt: 2,
              p: 1.75,
            }}
          >
            <FolderOpen color="primary" />
            <Box>
              <Typography sx={{ fontWeight: 600 }} variant="body2">
                Drop a DLL, JSON/JSONC, TOML, plugin folder, or ZIP anywhere on
                this tab.
              </Typography>
              <Typography color="text.secondary" variant="caption">
                D2RMM keeps an editable source copy. Run Install Mods after a
                package import or file edit to rebuild the selected output.
              </Typography>
            </Box>
          </Box>
        </Paper>

        <Stack
          direction={{ md: 'row', xs: 'column' }}
          spacing={1.5}
          sx={{ mt: 1.5 }}
        >
          {[
            {
              count: inventory.plugins.length,
              description: 'DLLs and companion files',
              label: 'Plugin files',
            },
            {
              count: inventory.patches.length,
              description: 'Memory patch definitions',
              label: 'Patch files',
            },
            {
              count: inventory.configs.length,
              description: 'Editable TOML files',
              label: 'Config files',
            },
            {
              count: totalFileCount,
              description: `${sourceCount} source${sourceCount === 1 ? '' : 's'} detected`,
              label: 'All files',
            },
          ].map(({ count, description, label }) => (
            <Paper key={label} sx={{ flex: 1, p: 1.5 }} variant="outlined">
              <Stack alignItems="baseline" direction="row" spacing={1}>
                <Typography sx={{ fontWeight: 700 }} variant="h6">
                  {count}
                </Typography>
                <Typography sx={{ fontWeight: 600 }} variant="body2">
                  {label}
                </Typography>
              </Stack>
              <Typography color="text.secondary" variant="caption">
                {description}
              </Typography>
            </Paper>
          ))}
        </Stack>

        <Alert icon={<Security />} severity="warning" sx={{ mt: 1.5 }}>
          DLL plugins execute native code and patch files can modify game
          memory. Import only files you trust. JSON and TOML from a mod are
          edited in that mod&apos;s source folder; package files are edited in
          D2RMM storage.
        </Alert>

        {error != null ? (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error.message}
          </Alert>
        ) : null}
        {hasUnsavedEdits ? (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            A file editor has unsaved changes. Save or cancel it before
            importing, deleting, refreshing, installing, or running D2R.
          </Alert>
        ) : null}
        {!isInventoryCurrent ? (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            A source changed but the inventory could not be refreshed. Refresh
            successfully before installing or running D2R.
          </Alert>
        ) : null}
        {inventory.conflicts.map((conflict) => (
          <Alert key={conflict} severity="error" sx={{ mt: 1 }}>
            {conflict}
          </Alert>
        ))}

        <Paper sx={{ mt: 2, overflow: 'hidden' }} variant="outlined">
          {isLoading ? <LinearProgress /> : null}
          <Tabs
            aria-label="Plugin workspace views"
            onChange={(_event, value) =>
              setWorkspaceView(value as 'files' | 'packages')
            }
            value={workspaceView}
          >
            <Tab label={`File library (${totalFileCount})`} value="files" />
            <Tab
              disabled={hasUnsavedEdits}
              label={`Managed packages (${inventory.packages.length})`}
              value="packages"
            />
          </Tabs>
          <Divider />

          {workspaceView === 'files' ? (
            <>
              <Box sx={{ p: 2 }}>
                <Stack
                  alignItems={{ md: 'center', xs: 'stretch' }}
                  direction={{ md: 'row', xs: 'column' }}
                  spacing={1.5}
                >
                  <TextField
                    disabled={hasUnsavedEdits}
                    fullWidth={true}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Search fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                    inputProps={{ 'aria-label': 'Search plugin files' }}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search by file, path, package, or mod..."
                    size="small"
                    value={searchQuery}
                  />
                  <ToggleButtonGroup
                    aria-label="Filter plugin files by source"
                    exclusive={true}
                    onChange={(_event, value: typeof sourceFilter | null) => {
                      if (value != null) setSourceFilter(value);
                    }}
                    size="small"
                    value={sourceFilter}
                  >
                    <ToggleButton disabled={hasUnsavedEdits} value="all">
                      All sources
                    </ToggleButton>
                    <ToggleButton disabled={hasUnsavedEdits} value="managed">
                      D2RMM
                    </ToggleButton>
                    <ToggleButton disabled={hasUnsavedEdits} value="mod">
                      Mods
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Stack>

                <Tabs
                  aria-label="Plugin file categories"
                  onChange={(_event, value) =>
                    setFileCategory(value as 'plugins' | 'patches' | 'configs')
                  }
                  sx={{ mt: 1.5 }}
                  value={fileCategory}
                  variant="scrollable"
                >
                  <Tab
                    disabled={hasUnsavedEdits && fileCategory !== 'plugins'}
                    label={`Plugins · ${inventory.plugins.length}`}
                    value="plugins"
                  />
                  <Tab
                    disabled={hasUnsavedEdits && fileCategory !== 'patches'}
                    label={`Patches · ${inventory.patches.length}`}
                    value="patches"
                  />
                  <Tab
                    disabled={hasUnsavedEdits && fileCategory !== 'configs'}
                    label={`Plugin Configs · ${inventory.configs.length}`}
                    value="configs"
                  />
                </Tabs>
                <Typography
                  color="text.secondary"
                  sx={{ mt: 1 }}
                  variant="caption"
                >
                  Showing {visibleItems.length} of {categoryItems.length}{' '}
                  {categoryTitle.toLocaleLowerCase()} across{' '}
                  {
                    new Set(
                      visibleItems.map(
                        (item) => `${item.sourceType}:${item.sourceName}`,
                      ),
                    ).size
                  }{' '}
                  source(s).
                </Typography>
              </Box>
              <Divider />
              <Box sx={{ p: 2 }}>
                <InventorySection
                  disabled={isEditorActionDisabled}
                  emptyText={categoryEmptyText}
                  items={visibleItems}
                  title={categoryTitle}
                />
              </Box>
            </>
          ) : (
            <Box sx={{ p: 2 }}>
              <Alert severity="info" sx={{ mb: 2 }}>
                Managed packages are preserved source bundles owned by D2RMM.
                Review their deployment targets here; edit individual JSON or
                TOML files from the File library.
              </Alert>
              {inventory.packages.length === 0 ? (
                <Paper sx={{ p: 3, textAlign: 'center' }} variant="outlined">
                  <Typography sx={{ fontWeight: 600 }}>
                    No managed packages yet
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    Drop a supported file, folder, or ZIP on this tab to import
                    the first package.
                  </Typography>
                </Paper>
              ) : (
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
              )}
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
