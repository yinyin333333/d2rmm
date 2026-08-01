import ToastContext, {
  IToastContext,
  ToastContextProvider,
} from 'renderer/react/context/ToastContext';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import * as Material from '@mui/material';

jest.mock('@mui/material', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const snackbarMounts = jest.fn();
  return {
    __snackbarMounts: snackbarMounts,
    Alert: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    AlertTitle: ({ children }: { children: React.ReactNode }) => (
      <strong>{children}</strong>
    ),
    Button: ({
      children,
      onClick,
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button onClick={onClick}>{children}</button>
    ),
    Snackbar: ({
      children,
      onClose,
      open,
    }: {
      children: React.ReactNode;
      onClose: () => void;
      open: boolean;
    }) => {
      React.useEffect(() => snackbarMounts(), []);
      return (
        <div>
          {open ? children : null}
          <button aria-label="dismiss toast" onClick={onClose} />
        </div>
      );
    },
  };
});

let toastContext: IToastContext | null = null;

function Probe(): null {
  toastContext = useContext(ToastContext);
  return null;
}

describe('queued toast duration lifecycle', () => {
  it('remounts Snackbar when the queue head changes at the same duration', () => {
    const snackbarMounts = (
      Material as unknown as { __snackbarMounts: jest.Mock }
    ).__snackbarMounts;
    render(
      <ToastContextProvider>
        <Probe />
      </ToastContextProvider>,
    );
    snackbarMounts.mockClear();

    act(() => {
      toastContext?.showToast({
        duration: 5000,
        severity: 'info',
        title: 'first',
      });
      toastContext?.showToast({
        duration: 5000,
        severity: 'info',
        title: 'second',
      });
    });
    expect(snackbarMounts).toHaveBeenCalledTimes(1);
    expect(screen.getByText('first')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'dismiss toast' }));

    expect(snackbarMounts).toHaveBeenCalledTimes(2);
    expect(screen.getByText('second')).toBeTruthy();
  });
});
