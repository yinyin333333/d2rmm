import AppUpdaterAPI from 'renderer/AppUpdaterAPI';
import { drainForUpdate } from 'renderer/IPC';
import AppUpdateButton from 'renderer/react/AppUpdateButton';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('renderer/AppUpdaterAPI', () => ({
  __esModule: true,
  default: {
    status: jest.fn(),
    check: jest.fn(),
    prepare: jest.fn(),
    install: jest.fn(),
    cancel: jest.fn(),
  },
}));
jest.mock('renderer/IPC', () => ({
  drainForUpdate: jest.fn().mockResolvedValue(undefined),
  resumeAfterUpdateFailure: jest.fn(),
}));
jest.mock('renderer/UpdateBarrier', () => ({
  flushUpdateState: jest.fn().mockResolvedValue(undefined),
}));
const mockFinish = jest.fn();
jest.mock('renderer/react/context/InstallContext', () => ({
  useIsInstalling: () => [false],
  useInstallationOperation: () => ({
    tryStartOperation: () => 'token',
    finishOperation: mockFinish,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  const status = {
    supported: true,
    phase: 'available',
    version: '1.1.0',
    message: '',
    progress: null,
    log: null,
  };
  (AppUpdaterAPI.status as jest.Mock).mockResolvedValue(status);
  (AppUpdaterAPI.check as jest.Mock).mockResolvedValue(status);
  (AppUpdaterAPI.cancel as jest.Mock).mockResolvedValue(undefined);
  (AppUpdaterAPI.install as jest.Mock).mockRejectedValue(
    new Error('fixture handoff failure'),
  );
});
async function openUpdate() {
  render(<AppUpdateButton />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'appUpdate.title' }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'appUpdate.install',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'appUpdate.install' }));
}
test('closing during preparation cancels and prevents a late completion from installing', async () => {
  let finish!: () => void;
  (AppUpdaterAPI.prepare as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await openUpdate();
  await waitFor(() => expect(AppUpdaterAPI.prepare).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'appUpdate.close' }));
  await waitFor(() => expect(AppUpdaterAPI.cancel).toHaveBeenCalled());
  await act(async () => {
    finish();
  });
  expect(AppUpdaterAPI.install).not.toHaveBeenCalled();
  expect(drainForUpdate).not.toHaveBeenCalled();
  expect(mockFinish).toHaveBeenCalledWith('token');
});
test('protects closing during the settings drain and releases it on handoff failure', async () => {
  (AppUpdaterAPI.prepare as jest.Mock).mockResolvedValueOnce(undefined);
  let finish!: () => void;
  (drainForUpdate as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await openUpdate();
  await waitFor(() => expect(drainForUpdate).toHaveBeenCalled());
  expect(
    (
      screen.getByRole('button', {
        name: 'appUpdate.close',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await act(async () => {
    finish();
  });
  expect(AppUpdaterAPI.install).toHaveBeenCalled();
  expect(
    (
      screen.getByRole('button', {
        name: 'appUpdate.close',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(mockFinish).toHaveBeenCalledWith('token');
});
