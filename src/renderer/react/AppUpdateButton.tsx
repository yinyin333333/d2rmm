import type { AppUpdateStatus } from 'bridge/AppUpdaterAPI';
import AppUpdaterAPI from 'renderer/AppUpdaterAPI';
import { drainForUpdate, resumeAfterUpdateFailure } from 'renderer/IPC';
import { flushUpdateState } from 'renderer/UpdateBarrier';
import {
  useIsInstalling,
  useInstallationOperation,
} from 'renderer/react/context/InstallContext';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import SystemUpdateAltRounded from '@mui/icons-material/SystemUpdateAltRounded';
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
  const [handoff, setHandoff] = useState(false);
  const cancelled = useRef(false);
  const pollGeneration = useRef(0);
  const polling = useRef(false);
  const [error, setError] = useState('');
  const [isInstalling] = useIsInstalling();
  const { tryStartOperation, finishOperation } = useInstallationOperation();
  useEffect(() => {
    AppUpdaterAPI.status().then(setStatus).catch(console.error);
  }, []);
  useEffect(() => {
    if (!busy) return undefined;
    const generation = pollGeneration.current;
    let active = true;
    let pending = false;
    const timer = setInterval(() => {
      if (!polling.current || pending) return;
      pending = true;
      AppUpdaterAPI.status()
        .then((latest) => {
          if (
            active &&
            polling.current &&
            generation === pollGeneration.current
          )
            setStatus(latest);
        })
        .catch(console.error)
        .finally(() => {
          pending = false;
        });
    }, 500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [busy]);
  if (!status?.supported) return null;
  const check = async () => {
    cancelled.current = false;
    pollGeneration.current += 1;
    polling.current = true;
    setOpen(true);
    setBusy(true);
    setError('');
    try {
      setStatus(await AppUpdaterAPI.check());
    } catch (failure) {
      polling.current = false;
      pollGeneration.current += 1;
      const latest = await AppUpdaterAPI.status().catch(() => null);
      if (latest != null) setStatus(latest);
      setError(String(failure));
    } finally {
      polling.current = false;
      pollGeneration.current += 1;
      setBusy(false);
    }
  };
  const install = async () => {
    const token = tryStartOperation(t('appUpdate.title'));
    if (token == null) return;
    cancelled.current = false;
    pollGeneration.current += 1;
    polling.current = true;
    flushSync(() => {
      setBusy(true);
      setError('');
    });
    try {
      await flushUpdateState();
      if (cancelled.current) throw new Error('Update cancelled.');
      await AppUpdaterAPI.prepare();
      if (cancelled.current) throw new Error('Update cancelled.');
      setHandoff(true);
      await flushUpdateState();
      await drainForUpdate();
      flushSync(() => {});
      await flushUpdateState();
      await AppUpdaterAPI.install();
    } catch (failure) {
      polling.current = false;
      pollGeneration.current += 1;
      await AppUpdaterAPI.cancel().catch(console.error);
      resumeAfterUpdateFailure();
      setError(String(failure));
      const latest = await AppUpdaterAPI.status().catch(() => null);
      if (latest != null) setStatus(latest);
      if (latest?.cleanupError != null) {
        setError(latest.cleanupError);
        setOpen(true);
      }
      setBusy(false);
      setHandoff(false);
      finishOperation(token);
    }
  };
  const close = async () => {
    if (handoff) return;
    cancelled.current = true;
    // Close before awaiting IPC so a late acknowledgement cannot hide a
    // cleanup error that the preparation failure handler has just displayed.
    setOpen(false);
    try {
      await AppUpdaterAPI.cancel();
    } catch (failure) {
      setError(String(failure));
      setOpen(true);
    }
  };
  return (
    <>
      <Button
        disabled={busy || isInstalling}
        onClick={() => {
          void check();
        }}
        startIcon={<SystemUpdateAltRounded />}
        sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}
      >
        {t('appUpdate.title')}
      </Button>
      <Dialog
        disableEscapeKeyDown={handoff}
        fullWidth={true}
        onClose={() => {
          void close();
        }}
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
          <Button
            disabled={handoff}
            onClick={() => {
              void close();
            }}
          >
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
