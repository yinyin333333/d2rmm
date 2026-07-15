import ShellAPI from 'renderer/ShellAPI';
import type { FocusEventHandler, ReactNode } from 'react';
import { useState } from 'react';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';

type Props = {
  browseFrom?: string;
  browseLabel: string;
  description?: ReactNode;
  error?: boolean;
  helperText?: ReactNode;
  label: string;
  onBlur?: FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  onChange: (value: string) => void;
  onFocus?: FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  placeholder?: string;
  selectingLabel: string;
  value: string;
};

export default function DirectoryField({
  browseFrom,
  browseLabel,
  description,
  error = false,
  helperText,
  label,
  onBlur,
  onChange,
  onFocus,
  placeholder,
  selectingLabel,
  value,
}: Props): JSX.Element {
  const [isSelecting, setIsSelecting] = useState(false);

  const selectDirectory = async (): Promise<void> => {
    setIsSelecting(true);
    try {
      const selectedPath = await ShellAPI.selectDirectory(browseFrom ?? value);
      if (selectedPath != null) {
        onChange(selectedPath);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSelecting(false);
    }
  };

  return (
    <Box>
      {description == null ? null : (
        <Typography color="text.secondary" variant="subtitle2">
          {description}
        </Typography>
      )}
      <Stack
        alignItems={{ sm: 'flex-start', xs: 'stretch' }}
        direction={{ sm: 'row', xs: 'column' }}
        spacing={1}
      >
        <TextField
          error={error}
          fullWidth={true}
          helperText={helperText}
          label={label}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          placeholder={placeholder}
          value={value}
          variant="filled"
        />
        <Button
          aria-label={`${browseLabel}: ${label}`}
          disabled={isSelecting}
          onClick={() => {
            void selectDirectory();
          }}
          startIcon={<FolderOpenRounded />}
          sx={{
            flexShrink: 0,
            height: 56,
            minWidth: 132,
            whiteSpace: 'nowrap',
          }}
          variant="outlined"
        >
          {isSelecting ? selectingLabel : browseLabel}
        </Button>
      </Stack>
    </Box>
  );
}
