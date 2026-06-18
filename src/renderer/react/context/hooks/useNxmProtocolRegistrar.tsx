import NxmProtocolAPI from 'renderer/NxmProtocolAPI';
import {
  useDialog,
  useDialogContext,
} from 'renderer/react/context/DialogContext';
import useAsyncCallback from 'renderer/react/hooks/useAsyncCallback';
import useSavedState from 'renderer/react/hooks/useSavedState';
import deferUntilAfterFirstPaint from 'renderer/utils/deferUntilAfterFirstPaint';
import { tl } from 'shared/i18n';
import { startupMark, startupMeasure } from 'shared/startupProfiler';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

function RegistrarDialog({
  onAgree,
  onDisagree: onDiagreeFromProps,
}: {
  onAgree: () => void;
  onDisagree: () => void;
}) {
  const { t } = useTranslation();
  const { close: onClose, isOpen } = useDialogContext();

  const onDisagree = useCallback(() => {
    onDiagreeFromProps();
    onClose();
  }, [onClose, onDiagreeFromProps]);

  return (
    <Dialog onClose={onClose} open={isOpen}>
      <DialogTitle>{t('nxm.dialog.title')}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t('nxm.dialog.content')}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDisagree}>{t('nxm.dialog.disagree')}</Button>
        <Button autoFocus={true} onClick={onAgree}>
          {t('nxm.dialog.agree')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function useNxmProtocolRegistrar(): [
  isRegistered: boolean,
  register: () => void,
  unregister: () => void,
] {
  const [isRejected, setIsRejected] = useSavedState(
    'nxm-selection-rejected',
    false,
    (map) => JSON.stringify(map),
    (str) => JSON.parse(str),
  );

  const [isRegistered, setIsRegistered] = useState(false);

  const onRegister = useAsyncCallback(async () => {
    setIsRejected(false);
    const success = await NxmProtocolAPI.register();
    setIsRegistered(success);
    if (!success) {
      console.error(tl('nxm.register.failed'));
    }
  }, [setIsRejected]);

  const onUnregister = useAsyncCallback(async () => {
    setIsRejected(false);
    const success = await NxmProtocolAPI.unregister();
    setIsRegistered(!success);
    if (!success) {
      console.error(tl('nxm.unregister.failed'));
    }
  }, [setIsRejected]);

  const onAgree = useAsyncCallback(async () => {
    setIsRejected(false);
    await onRegister();
  }, [onRegister, setIsRejected]);

  const onDisagree = useCallback(() => {
    setIsRejected(true);
  }, [setIsRejected]);

  const [showRegistrarDialog] = useDialog(
    <RegistrarDialog onAgree={onAgree} onDisagree={onDisagree} />,
  );

  const isInitialCheckDone = useRef(false);
  useEffect(() => {
    if (isInitialCheckDone.current) {
      return;
    }
    isInitialCheckDone.current = true;
    startupMark(
      'renderer',
      'NxmProtocolAPI.getIsRegistered scheduled after first paint',
    );
    let isMounted = true;
    const cancel = deferUntilAfterFirstPaint(() => {
      startupMark('renderer', 'NxmProtocolAPI.getIsRegistered deferred start');
      (async () => {
        const isRegisteredNew = await startupMeasure(
          'renderer',
          'NxmProtocolAPI.getIsRegistered',
          NxmProtocolAPI.getIsRegistered,
        );
        if (!isMounted) {
          return;
        }
        setIsRegistered(isRegisteredNew);
        startupMark(
          'renderer',
          `NxmProtocolAPI.getIsRegistered completed: ${String(isRegisteredNew)}`,
        );
        if (!isRejected && !isRegisteredNew) {
          showRegistrarDialog();
        }
      })()
        .then()
        .catch(console.error);
    });
    return () => {
      isMounted = false;
      cancel();
    };
  }, [isRejected, showRegistrarDialog]);

  return [isRegistered, onRegister, onUnregister];
}
