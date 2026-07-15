import type {
  D2RLoaderConfig,
  D2RLoaderConfigValue,
  D2RLoaderTomlSetting,
} from 'bridge/BridgeAPI';
import { getBaseSavesPath } from 'renderer/AppInfoAPI';
import BridgeAPI from 'renderer/BridgeAPI';
import ShellAPI from 'renderer/ShellAPI';
import type { D2RLoaderSettingsState } from 'renderer/react/context/D2RLoaderSettingsContext';
import { useD2RLoaderSettings } from 'renderer/react/context/D2RLoaderSettingsContext';
import { useExtraGameLaunchArgs } from 'renderer/react/context/ExtraGameLaunchArgsContext';
import {
  useGamePath,
  useSanitizedGamePath,
} from 'renderer/react/context/GamePathContext';
import { useIsPreExtractedData } from 'renderer/react/context/IsPreExtractedDataContext';
import { useNormalizeCRLFOnInstall } from 'renderer/react/context/NormalizeCRLFOnInstallContext';
import { useOutputModName } from 'renderer/react/context/OutputModNameContext';
import { useOutputPath } from 'renderer/react/context/OutputPathContext';
import { usePreExtractedDataPath } from 'renderer/react/context/PreExtractedDataPathContext';
import {
  useDefaultSavesPath,
  useFinalSavesPath,
  useSavesPath,
} from 'renderer/react/context/SavesPathContext';
import { IThemeMode, useThemeMode } from 'renderer/react/context/ThemeContext';
import useNexusAuthState from 'renderer/react/context/hooks/useNexusAuthState';
import { useAsyncMemo } from 'renderer/react/hooks/useAsyncMemo';
import { useIsFocused } from 'renderer/react/hooks/useIsFocused';
import DirectoryField from 'renderer/react/mmsettings/DirectoryField';
import InstallBeforeRunSettings from 'renderer/react/mmsettings/InstallBeforeRunSettings';
import SettingsWorkspace, {
  type SettingsSection,
  type SettingsSectionId,
} from 'renderer/react/mmsettings/SettingsWorkspace';
import {
  SEED_ARG,
  getSeedValue,
  hasExtraArg,
  normalizeLaunchArgs,
  parseExtraArgsText,
  removeSeedArg,
  setExtraArgEnabled,
  setSeedValue,
} from 'renderer/react/utils/launchArgs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  LinearProgress,
  Link,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  styled,
} from '@mui/material';

async function getIsValidGamePath(path: string): Promise<boolean> {
  const files = await BridgeAPI.readDirectory(path);
  return files.find(({ name }) => name === 'D2R.exe') != null;
}

async function getIsValidPreExtractedDataPath(path: string): Promise<boolean> {
  const files = await BridgeAPI.readDirectory(path);
  // search for the "global" folder
  return files.find(({ name }) => name === 'global') != null;
}

const StyledAccordion = styled(Accordion)(() => ({
  backgroundColor: 'transparent',
  boxShadow: 'none',
  margin: 0,
  '&.Mui-expanded': {
    margin: 0,
  },
  '&:before': {
    display: 'none',
  },
  '&[hidden]': {
    display: 'none',
  },
}));

const StyledAccordionSummary = styled(AccordionSummary)(() => ({
  display: 'none',
}));

const StyledAccordionDetails = styled(AccordionDetails)(({ theme }) => ({
  margin: '0 auto',
  maxWidth: 1040,
  padding: theme.spacing(3),
  width: '100%',
  '& .MuiAlert-root': {
    borderRadius: theme.shape.borderRadius * 2,
  },
  '& .MuiListItemButton-root': {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius * 2,
    marginTop: theme.spacing(1),
    transition: theme.transitions.create([
      'background-color',
      'border-color',
      'transform',
    ]),
  },
  '& .MuiListItemButton-root:hover': {
    borderColor: theme.palette.primary.main,
    transform: 'translateY(-1px)',
  },
  '& > .MuiDivider-root': {
    marginBottom: theme.spacing(1.5),
    marginTop: theme.spacing(3),
  },
  [theme.breakpoints.down('sm')]: {
    padding: theme.spacing(2),
  },
}));

type Props = Record<string, never>;

const LAUNCH_ARG_OPTIONS = [
  {
    arg: '-ns',
    description: 'settings.launcher.arg.noSound.description',
    label: 'settings.launcher.arg.noSound',
  },
  {
    arg: '-w',
    description: 'settings.launcher.arg.window.description',
    label: 'settings.launcher.arg.window',
  },
  {
    arg: '-skiplogovideo',
    description: 'settings.launcher.arg.skipIntro.description',
    label: 'settings.launcher.arg.skipIntro',
  },
  {
    arg: '-enablerespec',
    description: 'settings.launcher.arg.respec.description',
    label: 'settings.launcher.arg.respec',
  },
  {
    arg: '-resetofflinemaps',
    description: 'settings.launcher.arg.resetMaps.description',
    label: 'settings.launcher.arg.resetMaps',
  },
] as const;

function formatD2RLoaderTomlLabel(key: string): string {
  const label = key.replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getD2RLoaderTomlNumberBounds(setting: D2RLoaderTomlSetting): {
  min?: number;
  max?: number;
} {
  if (
    setting.section === 'd2rcore.stash' &&
    setting.key === 'add_shared_tabs'
  ) {
    return { min: 0 };
  }

  if (
    setting.section === 'd2rcore.stash' &&
    setting.key === 'set_materials_limit'
  ) {
    return { min: 99, max: 255 };
  }

  return {};
}

function isEditableD2RLoaderTomlSetting(
  setting: D2RLoaderTomlSetting,
): boolean {
  return (
    setting.section !== 'd2rcore.fonts' &&
    setting.id !== 'd2rloader.default_mod' &&
    setting.valueType !== 'raw'
  );
}

export default function ModManagerSettings(_props: Props): JSX.Element {
  const { t } = useTranslation();
  const [extraArgs, setExtraArgs] = useExtraGameLaunchArgs();
  const [isSeedEditorEnabled, setIsSeedEditorEnabled] = useState(() =>
    hasExtraArg(extraArgs, SEED_ARG),
  );
  const [d2rLoaderConfig, setD2RLoaderConfig] =
    useState<D2RLoaderConfig | null>(null);
  const [isD2RLoaderConfigLoading, setIsD2RLoaderConfigLoading] =
    useState(false);
  const [d2rLoaderSearch, setD2RLoaderSearch] = useState('');
  const [d2rLoaderTomlInputValues, setD2RLoaderTomlInputValues] = useState<
    Record<string, string>
  >({});
  const [normalizeOutputCRLF, setNormalizeOutputCRLF] =
    useNormalizeCRLFOnInstall();
  const [d2rLoaderSettings, setD2RLoaderSettings] = useD2RLoaderSettings();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() =>
    d2rLoaderSettings.useD2RLoader ? 'd2rLoader' : 'general',
  );
  const [rawGamePath, setRawGamePath] = useGamePath();
  const gamePath = useSanitizedGamePath();
  const [isPreExtractedData, setIsPreExtractedData] = useIsPreExtractedData();
  const [preExtractedDataPath, setPreExtractedDataPath] =
    usePreExtractedDataPath();
  const [outputModName, setOutputModName] = useOutputModName();
  const mergedPath = useOutputPath();
  const outputPath = mergedPath;
  const [savesPath, setSavesPath] = useSavesPath();
  const baseSavesPath = getBaseSavesPath();
  const defaultSavesPath = useDefaultSavesPath();
  const finalSavesPath = useFinalSavesPath();
  const [isSavesPathFocused, onSavesPathFocus, onSavesPathBlur] =
    useIsFocused();

  const [themeMode, setThemeMode] = useThemeMode();

  const dataSource = isPreExtractedData ? 'directory' : 'casc';
  const normalizedExtraArgs = normalizeLaunchArgs(extraArgs);
  const seedValue = getSeedValue(extraArgs);
  const isSeedInputEnabled = isSeedEditorEnabled || seedValue !== '';

  const setD2RLoaderSetting = useCallback(
    <TKey extends keyof D2RLoaderSettingsState>(
      key: TKey,
      value: D2RLoaderSettingsState[TKey],
    ) => {
      setD2RLoaderSettings((settings) => ({
        ...settings,
        [key]: value,
      }));
    },
    [setD2RLoaderSettings],
  );

  const setD2RLoaderTomlSetting = useCallback(
    (id: string, value: D2RLoaderConfigValue) => {
      setD2RLoaderSettings((settings) => ({
        ...settings,
        tomlSettings: {
          ...(settings.tomlSettings ?? {}),
          [id]: value,
        },
      }));
    },
    [setD2RLoaderSettings],
  );

  const getD2RLoaderTomlSettingValue = useCallback(
    (setting: D2RLoaderTomlSetting): D2RLoaderConfigValue =>
      d2rLoaderSettings.tomlSettings?.[setting.id] ?? setting.value,
    [d2rLoaderSettings.tomlSettings],
  );

  useEffect(() => {
    let isMounted = true;
    setIsD2RLoaderConfigLoading(true);
    BridgeAPI.readD2RLoaderConfig(gamePath)
      .then((config) => {
        if (!isMounted) {
          return;
        }

        setD2RLoaderConfig(config);
        if (config?.format === 'toml') {
          const settingIDs = new Set(
            config.settings
              .filter(isEditableD2RLoaderTomlSetting)
              .map(({ id }) => id),
          );
          setD2RLoaderSettings((settings) => {
            const tomlSettings = Object.fromEntries(
              Object.entries(settings.tomlSettings ?? {}).filter(([id]) =>
                settingIDs.has(id),
              ),
            );
            return { ...settings, tomlSettings };
          });
        }
      })
      .catch((error) => {
        console.error(error);
        if (isMounted) {
          setD2RLoaderConfig(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsD2RLoaderConfigLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [gamePath, setD2RLoaderSettings]);

  const d2rLoaderTomlSections = useMemo(() => {
    if (d2rLoaderConfig?.format !== 'toml') {
      return [];
    }

    const sections: Array<{
      section: string;
      settings: D2RLoaderTomlSetting[];
    }> = [];

    for (const setting of d2rLoaderConfig.settings.filter(
      isEditableD2RLoaderTomlSetting,
    )) {
      let section = sections.find((entry) => entry.section === setting.section);
      if (section == null) {
        section = { section: setting.section, settings: [] };
        sections.push(section);
      }
      section.settings.push(setting);
    }

    return sections;
  }, [d2rLoaderConfig]);

  const filteredD2RLoaderTomlSections = useMemo(() => {
    const query = d2rLoaderSearch.trim().toLowerCase();
    if (query === '') {
      return d2rLoaderTomlSections;
    }

    return d2rLoaderTomlSections
      .map(({ section, settings }) => ({
        section,
        settings: settings.filter((setting) =>
          [
            section,
            setting.id,
            setting.key,
            formatD2RLoaderTomlLabel(setting.key),
            setting.description,
          ].some((value) => value.toLowerCase().includes(query)),
        ),
      }))
      .filter(({ settings }) => settings.length > 0);
  }, [d2rLoaderSearch, d2rLoaderTomlSections]);

  const isValidGamePath =
    useAsyncMemo(useCallback(() => getIsValidGamePath(gamePath), [gamePath])) ??
    true;

  const isValidPreExtractedDataPath =
    useAsyncMemo(
      useCallback(
        () =>
          dataSource === 'directory'
            ? getIsValidPreExtractedDataPath(preExtractedDataPath)
            : Promise.resolve(true),
        [dataSource, preExtractedDataPath],
      ),
    ) ?? true;

  const isIdenticalInputAndOutput =
    preExtractedDataPath.toLowerCase() === outputPath.toLowerCase();

  const {
    nexusApiState,
    nexusAuthState,
    nexusSignIn,
    nexusSignOut,
    isRegisteredAsNxmProtocolHandler,
    registerAsNxmProtocolHandler,
    unregisterAsNxmProtocolHandler,
  } = useNexusAuthState();

  const generalNeedsAttention =
    !isValidGamePath ||
    outputModName.trim() === '' ||
    (dataSource === 'directory' &&
      (!isValidPreExtractedDataPath || isIdenticalInputAndOutput));
  const d2rLoaderSectionStatus: Pick<
    SettingsSection,
    'status' | 'tone'
  > = isD2RLoaderConfigLoading
    ? { status: t('settings.status.checking'), tone: 'info' }
    : !d2rLoaderSettings.useD2RLoader
      ? { status: t('settings.status.disabled'), tone: 'default' }
      : d2rLoaderConfig == null
        ? { status: t('settings.status.needsAttention'), tone: 'warning' }
        : { status: t('settings.status.enabled'), tone: 'success' };
  const isNexusReady =
    nexusAuthState.apiKey != null && isRegisteredAsNxmProtocolHandler;
  const settingsSections: readonly SettingsSection[] = [
    {
      description: t('settings.general.summary'),
      id: 'general',
      status: t(
        generalNeedsAttention
          ? 'settings.status.needsAttention'
          : 'settings.status.ready',
      ),
      title: t('settings.general.title'),
      tone: generalNeedsAttention ? 'error' : 'success',
    },
    {
      description: t('settings.d2rLoader.summary'),
      id: 'd2rLoader',
      ...d2rLoaderSectionStatus,
      title: t('settings.d2rLoader.title'),
    },
    {
      description: t('settings.launcher.summary'),
      id: 'launcher',
      status:
        normalizedExtraArgs.length === 0
          ? t('settings.status.default')
          : t('settings.status.custom', {
              count: normalizedExtraArgs.length,
            }),
      title: t('settings.launcher.title'),
      tone: normalizedExtraArgs.length === 0 ? 'default' : 'info',
    },
    {
      description: t('settings.display.summary'),
      id: 'display',
      status: t(`settings.display.theme.${themeMode}`),
      title: t('settings.display.title'),
      tone: 'info',
    },
    {
      description: t('settings.nexus.summary'),
      id: 'nexus',
      status: isNexusReady
        ? t('settings.status.connected')
        : nexusAuthState.apiKey == null
          ? t('settings.status.notConnected')
          : t('settings.status.needsAttention'),
      title: t('settings.nexus.title'),
      tone: isNexusReady ? 'success' : 'warning',
    },
  ];

  const renderD2RLoaderTomlSetting = (
    setting: D2RLoaderTomlSetting,
  ): JSX.Element => {
    const value = getD2RLoaderTomlSettingValue(setting);
    const label = formatD2RLoaderTomlLabel(setting.key);
    const description = setting.description || setting.id;

    if (setting.valueType === 'boolean') {
      const checked = value === true;
      return (
        <ListItemButton
          key={setting.id}
          disabled={!d2rLoaderSettings.useD2RLoader}
          onClick={() => setD2RLoaderTomlSetting(setting.id, !checked)}
        >
          <ListItemIcon>
            <Checkbox
              checked={checked}
              disabled={!d2rLoaderSettings.useD2RLoader}
              disableRipple={true}
              edge="start"
              inputProps={{
                'aria-labelledby': `d2r-loader-toml-${setting.id}`,
              }}
              tabIndex={-1}
            />
          </ListItemIcon>
          <ListItemText
            id={`d2r-loader-toml-${setting.id}`}
            primary={label}
            secondary={description}
          />
        </ListItemButton>
      );
    }

    if (setting.valueType === 'integer' || setting.valueType === 'float') {
      const inputValue = d2rLoaderTomlInputValues[setting.id] ?? String(value);
      return (
        <TextField
          key={setting.id}
          disabled={!d2rLoaderSettings.useD2RLoader}
          fullWidth={true}
          helperText={description}
          inputProps={getD2RLoaderTomlNumberBounds(setting)}
          label={label}
          onBlur={() => {
            setD2RLoaderTomlInputValues((inputValues) => {
              const nextInputValues = { ...inputValues };
              delete nextInputValues[setting.id];
              return nextInputValues;
            });
          }}
          onChange={(event) => {
            const { value: nextInputValue } = event.target;
            setD2RLoaderTomlInputValues((inputValues) => ({
              ...inputValues,
              [setting.id]: nextInputValue,
            }));

            if (nextInputValue.trim() === '') {
              return;
            }

            const parsedValue = Number(nextInputValue);
            if (Number.isFinite(parsedValue)) {
              setD2RLoaderTomlSetting(setting.id, parsedValue);
            }
          }}
          sx={{ marginTop: 1 }}
          type="number"
          value={inputValue}
          variant="filled"
        />
      );
    }

    return (
      <TextField
        key={setting.id}
        disabled={!d2rLoaderSettings.useD2RLoader}
        fullWidth={true}
        helperText={description}
        label={label}
        onChange={(event) =>
          setD2RLoaderTomlSetting(setting.id, event.target.value)
        }
        sx={{ marginTop: 1 }}
        value={String(value)}
        variant="filled"
      />
    );
  };

  return (
    <SettingsWorkspace
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      sections={settingsSections}
    >
      <StyledAccordion
        disableGutters={true}
        elevation={0}
        expanded={true}
        hidden={activeSection !== 'general'}
        square={true}
      >
        <StyledAccordionSummary
          aria-controls="general-content"
          id="general-header"
        >
          <Typography sx={{ marginLeft: 1 }}>
            {t('settings.general.title')}
          </Typography>
        </StyledAccordionSummary>
        <StyledAccordionDetails id="general-content">
          <DirectoryField
            browseLabel={t('settings.action.browse')}
            description={t('settings.general.gameDir.description')}
            error={!isValidGamePath}
            helperText={
              isValidGamePath ? null : t('settings.general.gameDir.error')
            }
            label={t('settings.general.gameDir.label')}
            onChange={setRawGamePath}
            selectingLabel={t('settings.action.selecting')}
            value={rawGamePath}
          />
          <Divider sx={{ marginTop: 2, marginBottom: 1 }} />
          <Typography color="text.secondary" variant="subtitle2">
            {t('settings.general.dataSource.description')}
          </Typography>
          <TextField
            fullWidth={true}
            label={t('settings.general.dataSource.label')}
            onChange={(event) =>
              setIsPreExtractedData(event.target.value === 'directory')
            }
            select={true}
            value={dataSource}
            variant="filled"
          >
            <MenuItem value="casc">
              {t('settings.general.dataSource.casc')}
            </MenuItem>
            <MenuItem value="directory">
              {t('settings.general.dataSource.directory')}
            </MenuItem>
          </TextField>
          {dataSource === 'directory' ? (
            <>
              <Divider sx={{ marginTop: 2, marginBottom: 1 }} />
              <DirectoryField
                browseLabel={t('settings.action.browse')}
                description={t('settings.general.dataDir.description')}
                error={!isValidPreExtractedDataPath}
                helperText={
                  isValidPreExtractedDataPath
                    ? null
                    : t('settings.general.dataDir.error')
                }
                label={t('settings.general.dataDir.label')}
                onChange={setPreExtractedDataPath}
                selectingLabel={t('settings.action.selecting')}
                value={preExtractedDataPath}
              />
              {isIdenticalInputAndOutput ? (
                <Alert severity="error">
                  {t('settings.general.dataDir.sameAsOutput', {
                    path: outputPath,
                  })}
                </Alert>
              ) : null}
            </>
          ) : null}
          <Divider sx={{ marginTop: 2, marginBottom: 1 }} />
          <Typography color="text.secondary" variant="subtitle2">
            {t('settings.general.outputModName.description')}
          </Typography>
          <TextField
            fullWidth={true}
            label={t('settings.general.outputModName.label')}
            onChange={(event) =>
              setOutputModName(
                event.target.value.replace(/[^a-zA-Z0-9-_]/g, ''),
              )
            }
            value={outputModName}
            variant="filled"
          />
          {outputModName.trim() === '' ? (
            <Alert severity="warning">
              <Typography>
                {t('settings.general.outputModName.empty')}
              </Typography>
            </Alert>
          ) : null}
          <Divider sx={{ marginTop: 2, marginBottom: 1 }} />
          <DirectoryField
            browseFrom={finalSavesPath}
            browseLabel={t('settings.action.browse')}
            description={t('settings.general.savesPath.description')}
            label={t('settings.general.savesPath.label')}
            onBlur={onSavesPathBlur}
            onChange={setSavesPath}
            onFocus={onSavesPathFocus}
            placeholder={defaultSavesPath}
            selectingLabel={t('settings.action.selecting')}
            value={isSavesPathFocused ? savesPath : finalSavesPath}
          />
          {!finalSavesPath.startsWith(baseSavesPath) ? (
            <Alert severity="warning">
              <Typography>
                {t('settings.general.savesPath.outsideBase', {
                  path: baseSavesPath,
                })}{' '}
                <Link
                  href="#"
                  onClick={() => {
                    ShellAPI.showItemInFolder(baseSavesPath).catch(
                      console.error,
                    );
                  }}
                >
                  {baseSavesPath}\
                </Link>
                &rdquo;. Are you sure this is right?
              </Typography>
            </Alert>
          ) : null}
          <Divider sx={{ marginTop: 2, marginBottom: 1 }} />
          <Alert severity="info" sx={{ marginTop: 2 }}>
            <Typography color="text.secondary" variant="subtitle2">
              {
                t('settings.general.outputPath.info', { path: '\x00' }).split(
                  '\x00',
                )[0]
              }
              <Link
                href="#"
                onClick={() => {
                  ShellAPI.showItemInFolder(outputPath).catch(console.error);
                }}
              >
                {outputPath}
              </Link>
              {
                t('settings.general.outputPath.info', { path: '\x00' }).split(
                  '\x00',
                )[1]
              }
            </Typography>
          </Alert>
          <Alert severity="info" sx={{ marginTop: 1 }}>
            <Typography color="text.secondary" variant="subtitle2">
              {
                t('settings.general.savesLocation.info', {
                  path: '\x00',
                }).split('\x00')[0]
              }
              <Link
                href="#"
                onClick={() => {
                  ShellAPI.showItemInFolder(finalSavesPath).catch(
                    console.error,
                  );
                }}
              >
                {finalSavesPath}
              </Link>
              {
                t('settings.general.savesLocation.info', {
                  path: '\x00',
                }).split('\x00')[1]
              }
            </Typography>
          </Alert>
          <InstallBeforeRunSettings />
          <Divider sx={{ marginTop: 2, marginBottom: 1 }} />
          <Typography color="text.secondary" variant="subtitle2">
            {t('settings.general.normalizeCRLFOnInstall.description')}
          </Typography>
          <Switch
            checked={normalizeOutputCRLF}
            onChange={(_event, checked) => setNormalizeOutputCRLF(checked)}
          />
        </StyledAccordionDetails>
      </StyledAccordion>
      <StyledAccordion
        disableGutters={true}
        elevation={0}
        expanded={true}
        hidden={activeSection !== 'launcher'}
        square={true}
      >
        <StyledAccordionSummary
          aria-controls="launcher-content"
          id="launcher-header"
        >
          <Typography sx={{ marginLeft: 1 }}>
            {t('settings.launcher.title')}
          </Typography>
        </StyledAccordionSummary>
        <StyledAccordionDetails id="launcher-content">
          <Typography color="text.secondary" variant="subtitle2">
            {t('settings.launcher.description')}
          </Typography>
          <TextField
            fullWidth={true}
            label={t('settings.launcher.extraArgs.label')}
            onChange={(event) => {
              const parsedArgs = parseExtraArgsText(event.target.value);
              setExtraArgs(parsedArgs);
              setIsSeedEditorEnabled(hasExtraArg(parsedArgs, SEED_ARG));
            }}
            value={normalizedExtraArgs.join(' ')}
            variant="filled"
          />
          {LAUNCH_ARG_OPTIONS.map(({ arg, description, label }) => (
            <ListItemButton
              key={arg}
              onClick={() => {
                setExtraArgs((args) =>
                  setExtraArgEnabled(args, arg, !hasExtraArg(args, arg)),
                );
              }}
            >
              <ListItemIcon>
                <Checkbox
                  checked={hasExtraArg(normalizedExtraArgs, arg)}
                  disableRipple={true}
                  edge="start"
                  inputProps={{
                    'aria-labelledby': `launcher-arg-${arg}`,
                  }}
                  tabIndex={-1}
                />
              </ListItemIcon>
              <ListItemText
                id={`launcher-arg-${arg}`}
                primary={t(label)}
                secondary={`${t(description)} · ${arg}`}
              />
            </ListItemButton>
          ))}
          <ListItemButton
            onClick={() => {
              if (isSeedInputEnabled) {
                setIsSeedEditorEnabled(false);
                setExtraArgs(removeSeedArg);
              } else {
                setIsSeedEditorEnabled(true);
              }
            }}
          >
            <ListItemIcon>
              <Checkbox
                checked={isSeedInputEnabled}
                disableRipple={true}
                edge="start"
                inputProps={{
                  'aria-labelledby': 'launcher-arg-seed',
                }}
                tabIndex={-1}
              />
            </ListItemIcon>
            <ListItemText
              id="launcher-arg-seed"
              primary={t('settings.launcher.arg.seed')}
              secondary={`${t(
                'settings.launcher.arg.seed.description',
              )} · ${SEED_ARG}`}
            />
          </ListItemButton>
          <TextField
            disabled={!isSeedInputEnabled}
            fullWidth={true}
            inputProps={{
              inputMode: 'numeric',
              pattern: '[0-9]*',
            }}
            label={t('settings.launcher.arg.seedValue.label')}
            onChange={(event) => {
              setExtraArgs((args) => setSeedValue(args, event.target.value));
            }}
            value={seedValue}
            variant="filled"
          />
        </StyledAccordionDetails>
      </StyledAccordion>
      <StyledAccordion
        disableGutters={true}
        elevation={0}
        expanded={true}
        hidden={activeSection !== 'd2rLoader'}
        square={true}
      >
        <StyledAccordionSummary
          aria-controls="d2r-loader-content"
          id="d2r-loader-header"
        >
          <Typography sx={{ marginLeft: 1 }}>
            {t('settings.d2rLoader.title')}
          </Typography>
        </StyledAccordionSummary>
        <StyledAccordionDetails id="d2r-loader-content">
          <Typography color="text.secondary" variant="subtitle2">
            {t('settings.d2rLoader.description')}
          </Typography>
          <ListItemButton
            onClick={() =>
              setD2RLoaderSetting(
                'useD2RLoader',
                !d2rLoaderSettings.useD2RLoader,
              )
            }
          >
            <ListItemIcon>
              <Checkbox
                checked={d2rLoaderSettings.useD2RLoader}
                disableRipple={true}
                edge="start"
                inputProps={{
                  'aria-labelledby': 'enable-d2r-loader',
                }}
                tabIndex={-1}
              />
            </ListItemIcon>
            <ListItemText
              id="enable-d2r-loader"
              primary={t('settings.d2rLoader.useD2RLoader')}
            />
          </ListItemButton>
          {d2rLoaderSettings.useD2RLoader ? (
            isD2RLoaderConfigLoading ? (
              <LinearProgress sx={{ marginTop: 1 }} />
            ) : d2rLoaderConfig == null ? (
              <Alert severity="warning" sx={{ marginTop: 1 }}>
                <Typography>
                  {t('settings.d2rLoader.missingTomlConfig')}
                </Typography>
              </Alert>
            ) : d2rLoaderTomlSections.length === 0 ? (
              <Typography color="text.secondary" sx={{ marginTop: 1 }}>
                {t('settings.d2rLoader.noTomlSettings')}
              </Typography>
            ) : (
              <>
                <TextField
                  fullWidth={true}
                  helperText={t('settings.d2rLoader.search.helper')}
                  label={t('settings.d2rLoader.search.label')}
                  onChange={(event) => setD2RLoaderSearch(event.target.value)}
                  sx={{ marginTop: 2 }}
                  value={d2rLoaderSearch}
                  variant="outlined"
                />
                {filteredD2RLoaderTomlSections.length === 0 ? (
                  <Alert severity="info" sx={{ marginTop: 2 }}>
                    {t('settings.d2rLoader.search.noResults', {
                      query: d2rLoaderSearch.trim(),
                    })}
                  </Alert>
                ) : (
                  filteredD2RLoaderTomlSections.map(
                    ({ section, settings }, sectionIndex) => (
                      <Box key={section} sx={{ marginTop: sectionIndex ? 2 : 1 }}>
                        {sectionIndex === 0 ? null : (
                          <Divider sx={{ marginTop: 2, marginBottom: 1 }} />
                        )}
                        <Stack alignItems="center" direction="row" spacing={1}>
                          <Typography
                            color="text.secondary"
                            fontWeight={700}
                            variant="subtitle2"
                          >
                            {section}
                          </Typography>
                          <Chip
                            label={settings.length}
                            size="small"
                            variant="outlined"
                          />
                        </Stack>
                        {settings.map(renderD2RLoaderTomlSetting)}
                      </Box>
                    ),
                  )
                )}
              </>
            )
          ) : null}
        </StyledAccordionDetails>
      </StyledAccordion>
      <StyledAccordion
        disableGutters={true}
        elevation={0}
        expanded={true}
        hidden={activeSection !== 'display'}
        square={true}
      >
        <StyledAccordionSummary
          aria-controls="display-content"
          id="display-header"
        >
          <Typography sx={{ marginLeft: 1 }}>
            {t('settings.display.title')}
          </Typography>
        </StyledAccordionSummary>
        <StyledAccordionDetails id="display-content">
          <TextField
            fullWidth={true}
            label={t('settings.display.theme.label')}
            onChange={(event) => setThemeMode(event.target.value as IThemeMode)}
            select={true}
            value={themeMode}
            variant="filled"
          >
            <MenuItem value="system">
              {t('settings.display.theme.system')}
            </MenuItem>
            <MenuItem value="light">
              {t('settings.display.theme.light')}
            </MenuItem>
            <MenuItem value="dark">{t('settings.display.theme.dark')}</MenuItem>
          </TextField>
        </StyledAccordionDetails>
      </StyledAccordion>
      <StyledAccordion
        disableGutters={true}
        elevation={0}
        expanded={true}
        hidden={activeSection !== 'nexus'}
        square={true}
      >
        <StyledAccordionSummary
          aria-controls="nexus-content"
          id="nexus-header"
        >
          <Typography sx={{ marginLeft: 1 }}>
            {t('settings.nexus.title')}
          </Typography>
        </StyledAccordionSummary>
        <StyledAccordionDetails id="nexus-content">
          <Stack spacing={2} sx={{ marginTop: 1 }}>
            {nexusAuthState.apiKey == null ? (
              <Alert severity="warning">
                <Typography>{t('settings.nexus.signedOut')}</Typography>
                <Button
                  color="warning"
                  onClick={nexusSignIn}
                  sx={{ marginTop: 1 }}
                  variant="contained"
                >
                  {t('settings.nexus.signIn')}
                </Button>
              </Alert>
            ) : (
              <Alert
                classes={{
                  root: 'MuiAlert-fullwidth',
                }}
                severity="info"
              >
                {nexusAuthState.name ? (
                  <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                    <Typography>
                      {t('settings.nexus.loggedIn', {
                        name: nexusAuthState.name,
                        email: nexusAuthState.email,
                      })}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Tooltip
                      title={
                        nexusAuthState.isPremium
                          ? undefined
                          : t('settings.nexus.free.tooltip')
                      }
                    >
                      <Chip
                        color={nexusAuthState.isPremium ? 'success' : 'warning'}
                        label={
                          nexusAuthState.isPremium
                            ? t('settings.nexus.premium')
                            : t('settings.nexus.free')
                        }
                        size="small"
                      />
                    </Tooltip>
                  </Box>
                ) : (
                  <Typography>{t('settings.nexus.loggingIn')}</Typography>
                )}
                {nexusApiState != null && (
                  <>
                    <NexusRequestLimit
                      limit={nexusApiState.dailyLimit}
                      remaining={nexusApiState.dailyRemaining}
                      reset={nexusApiState.dailyReset}
                      type="daily"
                    />
                    <NexusRequestLimit
                      limit={nexusApiState.hourlyLimit}
                      remaining={nexusApiState.hourlyRemaining}
                      reset={nexusApiState.hourlyReset}
                      type="hourly"
                    />
                  </>
                )}
                <Button
                  onClick={nexusSignOut}
                  sx={{ marginTop: 1 }}
                  variant="outlined"
                >
                  {t('settings.nexus.signOut')}
                </Button>
              </Alert>
            )}
            {isRegisteredAsNxmProtocolHandler ? (
              <Alert severity="info">
                <Typography>{t('settings.nexus.nxm.registered')}</Typography>
                <Button
                  onClick={unregisterAsNxmProtocolHandler}
                  sx={{ marginTop: 1 }}
                  variant="outlined"
                >
                  {t('settings.nexus.nxm.unregister')}
                </Button>
              </Alert>
            ) : (
              <Alert severity="warning">
                <Typography>{t('settings.nexus.nxm.notRegistered')}</Typography>
                <Button
                  color="warning"
                  onClick={registerAsNxmProtocolHandler}
                  sx={{ marginTop: 1 }}
                  variant="outlined"
                >
                  {t('settings.nexus.nxm.register')}
                </Button>
              </Alert>
            )}
          </Stack>
        </StyledAccordionDetails>
      </StyledAccordion>
    </SettingsWorkspace>
  );
}

function NexusRequestLimit({
  remaining,
  limit,
  reset,
  type,
}: {
  remaining: string;
  limit: string;
  reset: string;
  type: string;
}): JSX.Element {
  const { t } = useTranslation();
  const remainingInt = parseInt(remaining, 10);
  const limitInt = parseInt(limit, 10);
  const usedPercent = (remainingInt / limitInt) * 100;
  const resetStringForCurrentLocale = new Date(reset).toLocaleString();
  return (
    <Box sx={{ marginTop: 1 }}>
      <LinearProgress
        style={{ height: 10 }}
        value={usedPercent}
        variant="determinate"
      />
      <Box sx={{ alignItems: 'center', display: 'flex', flexDirection: 'row' }}>
        <Box>{t('settings.nexus.requests', { remaining, limit, type })}</Box>
        <Box sx={{ flex: 1 }} />
        <Box>
          {t('settings.nexus.requests.reset', {
            time: resetStringForCurrentLocale,
          })}
        </Box>
      </Box>
    </Box>
  );
}
