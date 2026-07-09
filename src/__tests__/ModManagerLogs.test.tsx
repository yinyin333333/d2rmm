import ModManagerLogs from 'renderer/react/ModManagerLogs';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';

const mockLogs = [
  { data: ['first'], id: 1, level: 'log', timestamp: 1 },
  { data: ['second'], id: 2, level: 'error', timestamp: 2 },
];

jest.mock('renderer/react/context/InstallContext', () => ({
  useIsInstalling: () => [false],
}));
jest.mock('renderer/react/context/LogContext', () => ({
  useLogLevels: () => [['error', 'warn', 'log', 'debug'], jest.fn()],
  useLogger: () => ({ clear: jest.fn() }),
  useLogs: () => mockLogs,
}));
jest.mock(
  'react-virtualized-auto-sizer',
  () =>
    ({
      children,
    }: {
      children: (size: { height: number; width: number }) => ReactNode;
    }) =>
      children({ height: 400, width: 600 }),
);
jest.mock('react-window', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    FixedSizeList: class extends React.Component<{
      children: (props: { index: number; style: CSSProperties }) => ReactNode;
      itemCount: number;
    }> {
      render(): ReactNode {
        return Array.from({ length: this.props.itemCount }, (_, index) =>
          this.props.children({ index, style: {} }),
        );
      }
    },
  };
});

describe('ModManagerLogs', () => {
  it('safely clears a selection removed by filtering', () => {
    render(<ModManagerLogs />);
    fireEvent.click(screen.getByText('second'));

    expect(() =>
      fireEvent.change(screen.getByPlaceholderText('Search...'), {
        target: { value: 'no match' },
      }),
    ).not.toThrow();
  });
});
