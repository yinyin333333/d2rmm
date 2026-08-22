import {
  useInstallationOperation,
  useInstallationProgress,
  useIsInstalling,
} from 'renderer/react/context/InstallContext';
import { Box, LinearProgress, Tab, Typography } from '@mui/material';

export default function InstallationProgressBar() {
  const [isInstalling] = useIsInstalling();
  const [installationProgress] = useInstallationProgress();
  const { operation } = useInstallationOperation();

  if (!isInstalling) {
    return null;
  }

  const statusText =
    operation.progress == null
      ? operation.label
      : `${operation.label} ${installationProgress.toFixed(0)}%`;

  return (
    <>
      <Box sx={{ flex: 1 }}>
        <LinearProgress
          aria-label={operation.label}
          value={operation.progress == null ? undefined : installationProgress}
          variant={operation.progress == null ? 'indeterminate' : 'determinate'}
        />
      </Box>
      <Tab
        aria-label={statusText}
        disabled={true}
        label={
          <Typography
            component="span"
            noWrap={true}
            sx={{ display: 'block', maxWidth: 240 }}
            title={statusText}
          >
            {statusText}
          </Typography>
        }
      />
    </>
  );
}
