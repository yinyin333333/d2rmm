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
import { type TFunction } from 'i18next';
import { isD2RLoaderPluginEditConflictError } from 'shared/D2RLoaderPluginEditError';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
  const editorLabel = t(
    item.sourceType === 'managed'
      ? 'plugins.editor.source.managed'
      : 'plugins.editor.source.mod',
    {
      file: item.name,
      source: item.packageName ?? item.sourceName,
    },
  );
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
      setError(new Error(t('plugins.editor.changedOnDisk')));
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
    t,
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
        title: t('plugins.editor.saved', { file: item.name }),
        description:
          result.warnings.length === 0
            ? item.sourceType === 'managed'
              ? t('plugins.editor.savedDescription.managed')
              : t('plugins.editor.savedDescription.mod')
            : result.warnings.join(' '),
      });
    } catch (caught) {
      const nextError =
        caught instanceof Error ? caught : new Error(String(caught));
      setError(nextError);
      if (isD2RLoaderPluginEditConflictError(nextError)) {
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
    t,
  ]);

  return (
    <Box>
      <ListItem
        component="div"
        sx={{
          alignItems: { sm: 'center', xs: 'stretch' },
          flexDirection: { sm: 'row', xs: 'column' },
          gap: 1,
          paddingX: 1.5,
          paddingY: 1,
        }}
      >
        <ListItemText
          primary={item.name}
          secondary={
            item.relativePath === item.name ? undefined : item.relativePath
          }
          sx={{
            flex: 1,
            margin: 0,
            minWidth: 0,
            '& .MuiListItemText-primary, & .MuiListItemText-secondary': {
              overflowWrap: 'anywhere',
            },
          }}
        />
        <Stack
          alignItems="center"
          direction="row"
          justifyContent="flex-end"
          spacing={1}
          sx={{
            alignSelf: { sm: 'center', xs: 'stretch' },
            flexShrink: 0,
          }}
        >
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
              aria-label={t('plugins.editor.editAria', { target: editorLabel })}
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
              {t('plugins.editor.edit')}
            </Button>
          ) : null}
        </Stack>
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
                {t('plugins.editor.modWarning')}
              </Alert>
            ) : null}
            {error != null ? (
              <Alert
                action={
                  isStale ? (
                    <Button
                      aria-label={t('plugins.editor.reloadAria', {
                        target: editorLabel,
                      })}
                      color="inherit"
                      onClick={() => onReload().catch(console.error)}
                      size="small"
                    >
                      {t('plugins.editor.reload')}
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
              <LoadingButton loading={true}>
                {t('plugins.editor.loading')}
              </LoadingButton>
            ) : document == null ? (
              <Button onClick={() => loadDocument().catch(console.error)}>
                {t('plugins.editor.retry')}
              </Button>
            ) : (
              <>
                <TextField
                  fullWidth={true}
                  inputProps={{
                    'aria-label': t('plugins.editor.editorAria', {
                      format: editorFormat,
                      target: editorLabel,
                    }),
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
                      ? t('plugins.editor.saveHint.managed')
                      : t('plugins.editor.saveHint.mod')}
                  </Typography>
                  <Button
                    aria-label={t('plugins.editor.cancelAria', {
                      target: editorLabel,
                    })}
                    disabled={isSaving}
                    onClick={onCancel}
                  >
                    {t('plugins.action.cancel')}
                  </Button>
                  <LoadingButton
                    aria-label={t('plugins.editor.saveAria', {
                      target: editorLabel,
                    })}
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
                    {t('plugins.editor.save')}
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
  const { t } = useTranslation();
  const filesID = useId();
  const { hasUnsavedEdits } = useD2RLoaderPluginManager();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const sourceLabel =
    group.sourceType === 'managed'
      ? t('plugins.group.managed', { source: group.sourceName })
      : t('plugins.group.mod', { source: group.sourceName });
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
          label={t('plugins.group.fileCount', { count: group.items.length })}
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
          aria-label={t(
            isExpanded ? 'plugins.group.hideAria' : 'plugins.group.showAria',
            { source: sourceLabel },
          )}
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
          {t(isExpanded ? 'plugins.action.hide' : 'plugins.action.show')}
        </Button>
      </Stack>
      <Collapse in={isExpanded} timeout="auto" unmountOnExit={true}>
        <Box
          aria-label={t('plugins.group.filesAria', { source: sourceLabel })}
          id={filesID}
          role="region"
        >
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

function packageDetails(
  packageInfo: D2RLoaderPluginPackageSummary,
  t: TFunction,
): string {
  const details = [
    t('plugins.package.count.plugins', {
      count: packageInfo.pluginFiles.length,
    }),
    t('plugins.package.count.patches', {
      count: packageInfo.patchFiles.length,
    }),
  ];
  if (packageInfo.configFiles.length > 0) {
    details.push(
      t('plugins.package.count.configs', {
        count: packageInfo.configFiles.length,
      }),
    );
  }
  if (packageInfo.dataFiles.length > 0) {
    details.push(
      t('plugins.package.count.data', { count: packageInfo.dataFiles.length }),
    );
  }
  if (packageInfo.unmappedFiles.length > 0) {
    details.push(
      t('plugins.package.count.preserved', {
        count: packageInfo.unmappedFiles.length,
      }),
    );
  }
  return details.join(' • ');
}

function PackageTargets({
  packageInfo,
}: {
  packageInfo: D2RLoaderPluginPackageSummary;
}): JSX.Element {
  const { t } = useTranslation();
  const groups = [
    ['plugins.category.plugins', 'd2rloader', packageInfo.pluginFiles],
    ['plugins.category.patches', 'd2rloader', packageInfo.patchFiles],
    ['plugins.category.configs', 'd2rloader', packageInfo.configFiles],
    ['plugins.package.target.modData', 'MPQ data', packageInfo.dataFiles],
    ['plugins.package.target.preserved', 'storage', packageInfo.unmappedFiles],
  ] as const;
  return (
    <Stack spacing={0.5}>
      {groups.map(([label, root, files]) =>
        files.length === 0 ? null : (
          <Typography
            key={label}
            color={
              label === 'plugins.package.target.preserved'
                ? 'warning.main'
                : 'text.secondary'
            }
            sx={{ overflowWrap: 'anywhere' }}
            variant="caption"
          >
            {t(label)}: {files.map((file) => `${root}/${file}`).join(', ')}
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
  const { t } = useTranslation();
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
          {t('plugins.package.delete.confirm', { package: packageName })}
        </DialogContentText>
        <br />
        <DialogContentText>
          {t('plugins.package.delete.description')}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('plugins.action.cancel')}</Button>
        <Button color="error" onClick={onConfirm} variant="contained">
          {t('plugins.action.delete')}
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
  const { t } = useTranslation();
  const [openDialog] = useDialog(
    <PackageDeleteDialog onDelete={onDelete} packageName={packageName} />,
  );
  return (
    <Tooltip
      title={t('plugins.package.delete.tooltip', { package: packageName })}
    >
      <span>
        <IconButton
          aria-label={t('plugins.package.delete.tooltip', {
            package: packageName,
          })}
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
  const { t } = useTranslation();
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
            {packageDetails(packageInfo, t)}
          </Typography>
        </Box>
        <Button
          aria-controls={detailsID}
          aria-expanded={showDetails}
          aria-label={t(
            showDetails
              ? 'plugins.package.details.hideAria'
              : 'plugins.package.details.showAria',
            { package: packageInfo.name },
          )}
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
          {t('plugins.package.details.action')}
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
          aria-label={t('plugins.package.targetsAria', {
            package: packageInfo.name,
          })}
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
  const { t } = useTranslation();
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
        title: t('plugins.toast.openStorageFailed'),
        description: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }, [inventory.managedRoot, showToast, t]);

  const onDeletePackage = useCallback(
    async (packageName: string) => {
      try {
        await deletePackage(packageName);
        showToast({
          duration: 4000,
          severity: 'success',
          title: t('plugins.toast.deleted', { package: packageName }),
        });
      } catch (caught) {
        showToast({
          severity: 'error',
          title: t('plugins.toast.deleteFailed', { package: packageName }),
          description:
            caught instanceof Error ? caught.message : String(caught),
        });
      }
    },
    [deletePackage, showToast, t],
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
      ? t('plugins.category.plugins')
      : fileCategory === 'patches'
        ? t('plugins.category.patches')
        : t('plugins.category.configs');
  const categoryEmptyText =
    normalizedSearch !== '' || sourceFilter !== 'all'
      ? t('plugins.empty.filtered')
      : fileCategory === 'plugins'
        ? t('plugins.empty.plugins')
        : fileCategory === 'patches'
          ? t('plugins.empty.patches')
          : t('plugins.empty.configs');
  const isPackageActionDisabled = hasUnsavedEdits || isInstalling || isMutating;
  const isEditorActionDisabled = isInstalling || isMutating;
  const workspaceStatus =
    error != null
      ? { color: 'error' as const, label: t('plugins.status.scanFailed') }
      : inventory.conflicts.length > 0
        ? { color: 'error' as const, label: t('plugins.status.conflicts') }
        : !isInventoryCurrent
          ? {
              color: 'warning' as const,
              label: t('plugins.status.refreshRequired'),
            }
          : isLoading
            ? { color: 'info' as const, label: t('plugins.status.scanning') }
            : { color: 'success' as const, label: t('plugins.status.ready') };

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
                <Typography variant="h5">{t('plugins.title')}</Typography>
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
                {t('plugins.description')}
              </Typography>
            </Box>
            <Stack
              direction={{ sm: 'row', xs: 'column' }}
              spacing={1}
              sx={{ flexShrink: 0, width: { md: 'auto', xs: '100%' } }}
            >
              <Button
                disabled={inventory.managedRoot === '' || isMutating}
                onClick={() => onOpenManagedRoot().catch(console.error)}
                startIcon={<FolderOpen />}
                sx={{ width: { sm: 'auto', xs: '100%' } }}
                variant="outlined"
              >
                {t('plugins.action.openStorage')}
              </Button>
              <LoadingButton
                disabled={hasUnsavedEdits || isMutating}
                loading={isLoading || isMutating}
                onClick={() => refresh().catch(console.error)}
                startIcon={<Refresh />}
                sx={{ width: { sm: 'auto', xs: '100%' } }}
                variant="contained"
              >
                {t('plugins.action.refresh')}
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
                {t('plugins.import.title')}
              </Typography>
              <Typography color="text.secondary" variant="caption">
                {t('plugins.import.description')}
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
              description: t('plugins.summary.plugins.description'),
              label: t('plugins.summary.plugins.label'),
            },
            {
              count: inventory.patches.length,
              description: t('plugins.summary.patches.description'),
              label: t('plugins.summary.patches.label'),
            },
            {
              count: inventory.configs.length,
              description: t('plugins.summary.configs.description'),
              label: t('plugins.summary.configs.label'),
            },
            {
              count: totalFileCount,
              description: t('plugins.summary.sources', { count: sourceCount }),
              label: t('plugins.summary.all.label'),
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
          {t('plugins.securityWarning')}
        </Alert>

        {error != null ? (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error.message}
          </Alert>
        ) : null}
        {hasUnsavedEdits ? (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {t('plugins.unsavedWarning')}
          </Alert>
        ) : null}
        {!isInventoryCurrent ? (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {t('plugins.refreshWarning')}
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
            aria-label={t('plugins.workspace.aria')}
            onChange={(_event, value) =>
              setWorkspaceView(value as 'files' | 'packages')
            }
            value={workspaceView}
          >
            <Tab
              label={t('plugins.workspace.files', { count: totalFileCount })}
              value="files"
            />
            <Tab
              disabled={hasUnsavedEdits}
              label={t('plugins.workspace.packages', {
                count: inventory.packages.length,
              })}
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
                    inputProps={{ 'aria-label': t('plugins.search.aria') }}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('plugins.search.placeholder')}
                    size="small"
                    value={searchQuery}
                  />
                  <ToggleButtonGroup
                    aria-label={t('plugins.sourceFilter.aria')}
                    exclusive={true}
                    onChange={(_event, value: typeof sourceFilter | null) => {
                      if (value != null) setSourceFilter(value);
                    }}
                    size="small"
                    value={sourceFilter}
                  >
                    <ToggleButton disabled={hasUnsavedEdits} value="all">
                      {t('plugins.sourceFilter.all')}
                    </ToggleButton>
                    <ToggleButton disabled={hasUnsavedEdits} value="managed">
                      D2RMM
                    </ToggleButton>
                    <ToggleButton disabled={hasUnsavedEdits} value="mod">
                      {t('plugins.sourceFilter.mods')}
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Stack>

                <Tabs
                  aria-label={t('plugins.category.aria')}
                  onChange={(_event, value) =>
                    setFileCategory(value as 'plugins' | 'patches' | 'configs')
                  }
                  sx={{ mt: 1.5 }}
                  value={fileCategory}
                  variant="scrollable"
                >
                  <Tab
                    disabled={hasUnsavedEdits && fileCategory !== 'plugins'}
                    label={`${t('plugins.category.plugins')} · ${inventory.plugins.length}`}
                    value="plugins"
                  />
                  <Tab
                    disabled={hasUnsavedEdits && fileCategory !== 'patches'}
                    label={`${t('plugins.category.patches')} · ${inventory.patches.length}`}
                    value="patches"
                  />
                  <Tab
                    disabled={hasUnsavedEdits && fileCategory !== 'configs'}
                    label={`${t('plugins.category.configs')} · ${inventory.configs.length}`}
                    value="configs"
                  />
                </Tabs>
                <Typography
                  color="text.secondary"
                  sx={{ mt: 1 }}
                  variant="caption"
                >
                  {t('plugins.category.showing', {
                    category: categoryTitle,
                    shown: visibleItems.length,
                    sources: new Set(
                      visibleItems.map(
                        (item) => `${item.sourceType}:${item.sourceName}`,
                      ),
                    ).size,
                    total: categoryItems.length,
                  })}
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
                {t('plugins.package.help')}
              </Alert>
              {inventory.packages.length === 0 ? (
                <Paper sx={{ p: 3, textAlign: 'center' }} variant="outlined">
                  <Typography sx={{ fontWeight: 600 }}>
                    {t('plugins.package.empty.title')}
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    {t('plugins.package.empty.description')}
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
