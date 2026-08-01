import ShellAPI from 'renderer/ShellAPI';
import 'renderer/css/App.css';
import D2RLoaderDownloadButton from 'renderer/react/D2RLoaderDownloadButton';
import ErrorBoundary from 'renderer/react/ErrorBoundary';
import InstallationProgressBar from 'renderer/react/InstallationProgressBar';
import ModManagerLogs from 'renderer/react/ModManagerLogs';
import ModManagerPlugins from 'renderer/react/ModManagerPlugins';
import ModManagerSettings from 'renderer/react/ModManagerSettings';
import { D2RLoaderPluginContextProvider } from 'renderer/react/context/D2RLoaderPluginContext';
import { D2RLoaderSettingsContextProvider } from 'renderer/react/context/D2RLoaderSettingsContext';
import {
  DialogManagerContextProvider,
  DialogRenderer,
} from 'renderer/react/context/DialogContext';
import { ExtraGameLaunchArgsContextProvider } from 'renderer/react/context/ExtraGameLaunchArgsContext';
import { GamePathContextProvider } from 'renderer/react/context/GamePathContext';
import { InstallBeforeRunContextProvider } from 'renderer/react/context/InstallBeforeRunContext';
import { InstallContextProvider } from 'renderer/react/context/InstallContext';
import { IsPreExtractedDataContextProvider } from 'renderer/react/context/IsPreExtractedDataContext';
import { LogsProvider } from 'renderer/react/context/LogContext';
import { ModsContextProvider } from 'renderer/react/context/ModsContext';
import { NexusModsContextProvider } from 'renderer/react/context/NexusModsContext';
import { NormalizeCRLFOnInstallContextProvider } from 'renderer/react/context/NormalizeCRLFOnInstallContext';
import { OutputModNameContextProvider } from 'renderer/react/context/OutputModNameContext';
import { OutputPathContextProvider } from 'renderer/react/context/OutputPathContext';
import { PreExtractedDataPathContextProvider } from 'renderer/react/context/PreExtractedDataPathContext';
import { SaveBackupSettingsContextProvider } from 'renderer/react/context/SaveBackupSettingsContext';
import { SavesPathContextProvider } from 'renderer/react/context/SavesPathContext';
import { SessionContextProvider } from 'renderer/react/context/SessionContext';
import {
  TabContextProvider,
  useTabState,
} from 'renderer/react/context/TabContext';
import ThemeContextProvider from 'renderer/react/context/ThemeContext';
import { ToastContextProvider } from 'renderer/react/context/ToastContext';
import { UpdatesContextProvider } from 'renderer/react/context/UpdatesContext';
import useD2RLoaderPluginDropZone from 'renderer/react/hooks/useD2RLoaderPluginDropZone';
import useModDropZone from 'renderer/react/hooks/useModDropZone';
import { SaveBackupScheduler } from 'renderer/react/hooks/useSaveBackupScheduler';
import ModList from 'renderer/react/modlist/ModList';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import TabContext, {
  getPanelId,
  getTabId,
  useTabContext,
} from '@mui/lab/TabContext';
import TabList from '@mui/lab/TabList';
import TabPanel from '@mui/lab/TabPanel';
import { Box, Button, Divider, Tab, Typography } from '@mui/material';

const DISCORD_INVITE_URL = 'https://discord.gg/eEHT2kcBMf';

function TabPanelBox({
  children,
  value,
}: {
  children: React.ReactNode;
  value: string;
}): JSX.Element {
  return (
    <TabPanel sx={{ height: '100%', position: 'relative' }} value={value}>
      <Box
        sx={{
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          left: 0,
          position: 'absolute',
          right: 0,
          top: 0,
        }}
      >
        {children}
      </Box>
    </TabPanel>
  );
}

function PersistentTabPanelBox({
  children,
  value,
}: {
  children: React.ReactNode;
  value: string;
}): JSX.Element {
  const context = useTabContext();
  if (context == null) throw new Error('No TabContext provided.');
  const active = context.value === value;
  return (
    <Box
      aria-labelledby={getTabId(context, value)}
      hidden={!active}
      id={getPanelId(context, value)}
      role="tabpanel"
      sx={{ height: '100%', position: 'relative' }}
    >
      <Box
        sx={{
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          left: 0,
          position: 'absolute',
          right: 0,
          top: 0,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

function RootRoute() {
  const { t } = useTranslation();
  const [tab, setTab] = useTabState();
  const modDropZone = useModDropZone();
  const pluginDropZone = useD2RLoaderPluginDropZone();
  const dropZone = tab === 'plugins' ? pluginDropZone : modDropZone;

  return (
    <TabContext value={tab}>
      <Box
        onDragEnter={dropZone.onDragEnter}
        onDragLeave={dropZone.onDragLeave}
        onDragOver={dropZone.onDragOver}
        onDrop={dropZone.onDrop}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {dropZone.isDraggingOver && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: (theme) => theme.zIndex.modal + 1,
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
              border: '3px dashed',
              borderColor: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <Typography
              sx={{ color: 'common.white', fontWeight: 'bold' }}
              variant="h5"
            >
              {t(tab === 'plugins' ? 'plugins.dropZone' : 'app.dropZone')}
            </Typography>
          </Box>
        )}
        <Box
          sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}
        >
          <TabList onChange={(_event, value) => setTab(value)}>
            <Tab label={t('tabs.mods')} value="mods" />
            <Tab label={t('tabs.plugins')} value="plugins" />
            <Tab label={t('tabs.settings')} value="settings" />
            <Tab label={t('tabs.logs')} value="logs" />
          </TabList>
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, ml: 1 }}>
            <Button
              onClick={() => {
                ShellAPI.openExternal(DISCORD_INVITE_URL).catch(console.error);
              }}
            >
              {t('tabs.discord')}
            </Button>
            <D2RLoaderDownloadButton />
          </Box>
          <Box sx={{ flex: 1 }} />
          <InstallationProgressBar />
        </Box>
        <Divider />
        <TabPanelBox value="mods">
          <ModList />
        </TabPanelBox>
        <PersistentTabPanelBox value="plugins">
          <ModManagerPlugins />
        </PersistentTabPanelBox>
        <TabPanelBox value="settings">
          {tab === 'settings' ? <ModManagerSettings /> : null}
        </TabPanelBox>
        <TabPanelBox value="logs">
          {tab === 'logs' ? <ModManagerLogs /> : null}
        </TabPanelBox>
      </Box>
    </TabContext>
  );
}

function Content() {
  return (
    <>
      <SaveBackupScheduler />
      <Router>
        <Routes>
          <Route element={<RootRoute />} path="/" />
        </Routes>
      </Router>
      <DialogRenderer />
    </>
  );
}

// from inner to outer
const CONTEXT_PROVIDERS = [
  // installation & updates
  NexusModsContextProvider,
  UpdatesContextProvider,
  InstallContextProvider,
  // ui
  TabContextProvider,
  D2RLoaderPluginContextProvider,
  // mod data
  ModsContextProvider,
  // preferences
  D2RLoaderSettingsContextProvider,
  NormalizeCRLFOnInstallContextProvider,
  InstallBeforeRunContextProvider,
  SavesPathContextProvider,
  SaveBackupSettingsContextProvider,
  OutputPathContextProvider,
  ExtraGameLaunchArgsContextProvider,
  OutputModNameContextProvider,
  IsPreExtractedDataContextProvider,
  PreExtractedDataPathContextProvider,
  GamePathContextProvider,
  SessionContextProvider,
  // modals
  ToastContextProvider,
  DialogManagerContextProvider,
  // infrastructure
  LogsProvider,
  ThemeContextProvider,
];

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        {CONTEXT_PROVIDERS.reduce(
          (children, Provider) => (
            <Provider>{children}</Provider>
          ),
          <Content />,
        )}
      </Suspense>
    </ErrorBoundary>
  );
}
