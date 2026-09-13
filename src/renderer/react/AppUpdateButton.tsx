import type { AppUpdateStatus } from 'bridge/AppUpdaterAPI';
import AppUpdaterAPI from 'renderer/AppUpdaterAPI';
import { drainForUpdate, resumeAfterUpdateFailure } from 'renderer/IPC';
import { flushUpdateState } from 'renderer/UpdateBarrier';
import {
  useIsInstalling,
  useInstallationOperation,
} from 'renderer/react/context/InstallContext';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Typography,
} from '@mui/material';

export default function AppUpdateButton(): JSX.Element | null {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [isInstalling] = useIsInstalling();
  const { tryStartOperation, finishOperation } = useInstallationOperation();
  useEffect(() => {
    AppUpdaterAPI.status().then(setStatus).catch(console.error);
  }, []);
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(() => {
      AppUpdaterAPI.status().then(setStatus).catch(console.error);
    }, 500);
    return () => clearInterval(timer);
  }, [busy]);
  if (!status?.supported) return null;
  const check = async () => {
    setOpen(true);
    setBusy(true);
    setError('');
    try {
      setStatus(await AppUpdaterAPI.check());
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    const token = tryStartOperation(t('appUpdate.title'));
    if (token == null) return;
    flushSync(() => {
      setBusy(true);
      setError('');
    });
    try {
      await flushUpdateState();
      await AppUpdaterAPI.prepare();
      await flushUpdateState();
      await drainForUpdate();
      flushSync(() => {});
      await flushUpdateState();
      await AppUpdaterAPI.install();
    } catch (failure) {
      await AppUpdaterAPI.cancel().catch(console.error);
      resumeAfterUpdateFailure();
      setError(String(failure));
      setBusy(false);
      finishOperation(token);
    }
  };
  return (
    <>
      <Button
        disabled={busy || isInstalling}
        onClick={() => {
          void check();
        }}
      >
        {t('appUpdate.title')}
      </Button>
      <Dialog
        disableEscapeKeyDown={busy}
        fullWidth={true}
        onClose={busy ? undefined : () => setOpen(false)}
        open={open}
      >
        <DialogTitle>{t('appUpdate.title')}</DialogTitle>
        <DialogContent>
          <Typography>{t('appUpdate.description')}</Typography>
          <Typography sx={{ my: 2 }}>
            {t(`appUpdate.phase.${status.phase}`, {
              defaultValue: status.phase,
              version: status.version,
            })}
          </Typography>
          {busy && (
            <LinearProgress
              value={status.progress ?? 0}
              variant={
                status.progress == null ? 'indeterminate' : 'determinate'
              }
            />
          )}
          {error && (
            <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>
              {error}
            </Alert>
          )}
          {status.log && (
            <Typography sx={{ mt: 2, overflowWrap: 'anywhere' }}>
              {t('appUpdate.log', { path: status.log })}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setOpen(false)}>
            {t('appUpdate.close')}
          </Button>
          {status.version && (
            <Button
              disabled={busy || isInstalling}
              onClick={() => {
                void install();
              }}
            >
              {t('appUpdate.install', { version: status.version })}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
