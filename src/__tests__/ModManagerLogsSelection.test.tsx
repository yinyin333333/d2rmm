import ModManagerLogs from 'renderer/react/ModManagerLogs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockClear = jest.fn();
const mockSetLevels = jest.fn();
const mockLogs = [
  { data: ['first log'], id: 1, level: 'log', timestamp: 1 },
  { data: ['second log'], id: 2, level: 'warn', timestamp: 2 },
];

jest.mock('renderer/react/context/InstallContext', () => ({
  useIsInstalling: () => [false],
}));
jest.mock('renderer/react/context/LogContext', () => ({
  useLogLevels: () => [['error', 'warn', 'log', 'debug'], mockSetLevels],
  useLogger: () => ({ clear: mockClear }),
  useLogs: () => mockLogs,
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({
    children,
  }: {
    children: (size: { height: number; width: number }) => React.ReactNode;
  }) => children({ height: 400, width: 600 }),
}));
jest.mock('react-window', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    FixedSizeList: React.forwardRef(
      (
        {
          children,
          itemCount,
        }: {
          children: (props: {
            index: number;
            style: React.CSSProperties;
          }) => React.ReactNode;
          itemCount: number;
        },
        _ref,
      ) => (
        <div>
          {Array.from({ length: itemCount }, (_, index) =>
            children({ index, style: {} }),
          )}
        </div>
      ),
    ),
  };
});
jest.mock('@mui/material', () => {
  const actual = jest.requireActual('@mui/material');
  return {
    ...actual,
    Drawer: ({
      children,
      open,
    }: {
      children: React.ReactNode;
      open: boolean;
    }) => (open ? <aside>{children}</aside> : null),
  };
});

describe('ModManagerLogs drawer selection', () => {
  it('keeps selection tied to log ID and closes when filtering it out', async () => {
    render(<ModManagerLogs />);
    fireEvent.click(screen.getByText('first log'));
    expect(screen.getAllByText('first log')).toHaveLength(2);

    fireEvent.change(screen.getByPlaceholderText('logs.search'), {
      target: { value: 'second' },
    });

    await waitFor(() =>
      expect(screen.getAllByText('second log')).toHaveLength(1),
    );
    expect(screen.queryByText('first log')).toBeNull();
  });
});
