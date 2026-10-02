import type { D2RLoaderLogScope } from 'bridge/ShellAPI';
import ShellAPI from 'renderer/ShellAPI';
import { useSanitizedGamePath } from 'renderer/react/context/GamePathContext';
import { useOutputModName } from 'renderer/react/context/OutputModNameContext';
import useToast from 'renderer/react/hooks/useToast';
import { isI18nError, localizeConsoleArgs } from 'shared/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DownloadIcon from '@mui/icons-material/Download';
import {
  Button,
  CircularProgress,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';

export default function D2RLoaderLogExportButton(): JSX.Element {
  const { t } = useTranslation();
  const gamePath = useSanitizedGamePath();
  const [outputModName] = useOutputModName();
  const showToast = useToast();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);

  const exportLogs = async (scope: D2RLoaderLogScope): Promise<void> => {
    setAnchor(null);
    setBusy(true);
    try {
      const result = await ShellAPI.exportD2RLoaderLogs(
        gamePath,
        outputModName,
        scope,
      );
      if (result == null) return;
      showToast({
        severity: result.missingDirectories.length ? 'warning' : 'success',
        title: t('logs.loader.success'),
        description: result.missingDirectories.length
          ? t('logs.loader.missing', {
              path: result.path,
              directories: result.missingDirectories.join(', '),
            })
          : result.path,
        duration: 8000,
      });
    } catch (error) {
      console.error(error);
      showToast({
        severity: 'error',
        title: t('logs.loader.failed'),
        description: isI18nError(error)
          ? localizeConsoleArgs(error.__d2rmm_i18n_list, t).join('\n')
          : error instanceof Error
            ? error.message
            : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        aria-controls={anchor ? 'd2rloader-log-export-menu' : undefined}
        aria-expanded={anchor ? true : undefined}
        aria-haspopup="menu"
        disabled={busy}
        onClick={(event) => setAnchor(event.currentTarget)}
        startIcon={
          busy ? (
            <CircularProgress color="inherit" size={16} />
          ) : (
            <DownloadIcon />
          )
        }
        sx={{ ml: 1, flexShrink: 0 }}
        variant="outlined"
      >
        {t(busy ? 'logs.loader.exporting' : 'logs.loader.export')}
      </Button>
      <Menu
        anchorEl={anchor}
        id="d2rloader-log-export-menu"
        onClose={() => setAnchor(null)}
        open={anchor != null}
      >
        {(['loader', 'loader-and-mod', 'all'] as const).map((scope, index) => (
          <MenuItem key={scope} onClick={() => void exportLogs(scope)}>
            <div>
              <Typography>{`${index + 1}. ${t(`logs.loader.scope.${scope}`)}`}</Typography>
              <Typography
                color="text.secondary"
                sx={{ whiteSpace: 'normal' }}
                variant="caption"
              >
                d2rloader/logs
                {scope !== 'loader' &&
                  ` + mods/${outputModName}/d2rloader/logs`}
                {scope === 'all' && ' + d2rloader/crashes'}
              </Typography>
            </div>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
