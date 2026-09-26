import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import CloudDoneRounded from '@mui/icons-material/CloudDoneRounded';
import ExtensionRounded from '@mui/icons-material/ExtensionRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import PaletteRounded from '@mui/icons-material/PaletteRounded';
import RocketLaunchRounded from '@mui/icons-material/RocketLaunchRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import {
  Avatar,
  Box,
  Chip,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

export type SettingsSectionId =
  | 'general'
  | 'd2rLoader'
  | 'launcher'
  | 'display'
  | 'nexus';

export type SettingsSectionTone =
  | 'default'
  | 'error'
  | 'info'
  | 'success'
  | 'warning';

export type SettingsSection = {
  description: string;
  id: SettingsSectionId;
  status: string;
  title: string;
  tone?: SettingsSectionTone;
};

type Props = {
  activeSection: SettingsSectionId;
  children: ReactNode;
  onSectionChange: (section: SettingsSectionId) => void;
  sections: readonly SettingsSection[];
};

function getSectionIcon(section: SettingsSectionId): JSX.Element {
  switch (section) {
    case 'general':
      return <SettingsRounded fontSize="small" />;
    case 'd2rLoader':
      return <ExtensionRounded fontSize="small" />;
    case 'launcher':
      return <RocketLaunchRounded fontSize="small" />;
    case 'display':
      return <PaletteRounded fontSize="small" />;
    case 'nexus':
      return <LinkRounded fontSize="small" />;
  }
}

export default function SettingsWorkspace({
  activeSection,
  children,
  onSectionChange,
  sections,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const active =
    sections.find((section) => section.id === activeSection) ?? sections[0];

  if (active == null) {
    throw new Error('SettingsWorkspace requires at least one section.');
  }

  return (
    <Box
      sx={{
        backgroundColor: 'background.default',
        height: '100%',
        overflow: 'auto',
        width: '100%',
      }}
    >
      <Box
        sx={{
          marginX: 'auto',
          maxWidth: 1440,
          paddingX: { lg: 4, sm: 2.5, xs: 1.5 },
          paddingY: { lg: 3, xs: 2 },
          width: '100%',
        }}
      >
        <Stack
          alignItems={{ sm: 'center', xs: 'flex-start' }}
          direction={{ sm: 'row', xs: 'column' }}
          justifyContent="space-between"
          spacing={2}
          sx={{ marginBottom: 2.5 }}
        >
          <Stack alignItems="center" direction="row" spacing={1.5}>
            <Avatar
              sx={{
                backgroundColor: 'primary.main',
                color: 'primary.contrastText',
                height: 44,
                width: 44,
              }}
              variant="rounded"
            >
              <TuneRounded />
            </Avatar>
            <Box>
              <Typography component="h1" fontWeight={750} variant="h5">
                {t('settings.title')}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                {t('settings.subtitle')}
              </Typography>
            </Box>
          </Stack>
          <Chip
            icon={<CloudDoneRounded />}
            label={t('settings.autosave')}
            size="small"
            variant="outlined"
          />
        </Stack>

        <Box
          sx={{
            alignItems: 'start',
            display: 'grid',
            gap: 2.5,
            gridTemplateColumns: {
              md: '280px minmax(0, 1fr)',
              xs: 'minmax(0, 1fr)',
            },
          }}
        >
          <Paper
            aria-label={t('settings.navigation.label')}
            component="nav"
            sx={{
              borderRadius: 3,
              overflowX: { md: 'hidden', xs: 'auto' },
              position: { md: 'sticky', xs: 'static' },
              top: { md: 0, xs: 'auto' },
            }}
            variant="outlined"
          >
            <List
              disablePadding={true}
              sx={{
                display: { md: 'block', xs: 'flex' },
                minWidth: { md: 0, xs: 'max-content' },
                padding: 1,
              }}
            >
              {sections.map((section) => {
                const selected = section.id === active.id;
                return (
                  <ListItemButton
                    key={section.id}
                    onClick={() => onSectionChange(section.id)}
                    selected={selected}
                    sx={{
                      alignItems: 'flex-start',
                      border: '1px solid',
                      borderColor: selected ? 'primary.main' : 'transparent',
                      borderRadius: 2,
                      marginBottom: { md: 0.5, xs: 0 },
                      marginRight: { md: 0, xs: 0.75 },
                      minWidth: { md: 'auto', xs: 236 },
                      paddingX: 1.5,
                      paddingY: 1.25,
                      transition: (theme) =>
                        theme.transitions.create([
                          'background-color',
                          'border-color',
                          'transform',
                        ]),
                      '&:hover': {
                        transform: 'translateY(-1px)',
                      },
                      '&.Mui-selected': {
                        backgroundColor: 'action.selected',
                      },
                      '&.Mui-selected:hover': {
                        backgroundColor: 'action.selected',
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        color: selected ? 'primary.main' : 'text.secondary',
                        marginTop: 0.25,
                        minWidth: 38,
                      }}
                    >
                      {getSectionIcon(section.id)}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography
                          component="span"
                          fontWeight={selected ? 700 : 600}
                          variant="body2"
                        >
                          {section.title}
                        </Typography>
                      }
                      secondary={
                        <Stack
                          alignItems="flex-start"
                          component="span"
                          spacing={0.75}
                          sx={{ marginTop: 0.25 }}
                        >
                          <Typography
                            color="text.secondary"
                            component="span"
                            variant="caption"
                          >
                            {section.description}
                          </Typography>
                          <Chip
                            color={section.tone ?? 'default'}
                            label={section.status}
                            size="small"
                            sx={{ height: 22 }}
                            variant={selected ? 'filled' : 'outlined'}
                          />
                        </Stack>
                      }
                      secondaryTypographyProps={{ component: 'div' }}
                      sx={{ margin: 0 }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Paper>

          <Paper
            sx={{
              borderRadius: 3,
              minWidth: 0,
              overflow: 'hidden',
            }}
            variant="outlined"
          >
            <Stack
              alignItems={{ sm: 'center', xs: 'flex-start' }}
              direction={{ sm: 'row', xs: 'column' }}
              justifyContent="space-between"
              spacing={1.5}
              sx={{
                borderBottom: '1px solid',
                borderColor: 'divider',
                paddingX: { sm: 3, xs: 2 },
                paddingY: 2.25,
              }}
            >
              <Stack alignItems="center" direction="row" spacing={1.25}>
                <Avatar
                  sx={{
                    backgroundColor: 'action.selected',
                    color: 'primary.main',
                    height: 36,
                    width: 36,
                  }}
                  variant="rounded"
                >
                  {getSectionIcon(active.id)}
                </Avatar>
                <Box>
                  <Typography component="h2" fontWeight={750} variant="h6">
                    {active.title}
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    {active.description}
                  </Typography>
                </Box>
              </Stack>
              <Chip
                color={active.tone ?? 'default'}
                label={active.status}
                size="small"
                variant="outlined"
              />
            </Stack>
            {children}
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}
