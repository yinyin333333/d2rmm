import type { SaveBackupSettings } from 'renderer/react/context/SaveBackupSettingsContext';
import {
  SaveBackupSettingsContextProvider,
  useSaveBackupSettings,
} from 'renderer/react/context/SaveBackupSettingsContext';
import {
  getSaveBackupDelayMilliseconds,
  SaveBackupScheduler,
  SAVE_BACKUP_INTERVAL_MILLISECONDS,
  SAVE_BACKUP_LAST_SUCCESS_STORAGE_KEY,
} from 'renderer/react/hooks/useSaveBackupScheduler';
import '@testing-library/jest-dom';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

const mockCreateSaveBackup = jest.fn();
const mockShowToast = jest.fn();
let mockSavesPath = 'C:\\Saves\\D2RMM';

jest.mock('renderer/BridgeAPI', () => ({
  __esModule: true,
  default: {
    createSaveBackup: (...args: unknown[]) => mockCreateSaveBackup(...args),
  },
}));

jest.mock('renderer/react/context/SavesPathContext', () => ({
  useFinalSavesPath: () => mockSavesPath,
}));

jest.mock('renderer/react/hooks/useToast', () => ({
  __esModule: true,
  default: () => mockShowToast,
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

let setSettingsForTest: React.Dispatch<
  React.SetStateAction<SaveBackupSettings>
> = () => undefined;

function SettingsProbe(): null {
  const [, setSettings] = useSaveBackupSettings();
  setSettingsForTest = setSettings;
  return null;
}

function Harness({ savesPath = mockSavesPath }: { savesPath?: string }) {
  mockSavesPath = savesPath;
  return (
    <SaveBackupSettingsContextProvider>
      <SettingsProbe />
      <SaveBackupScheduler />
    </SaveBackupSettingsContextProvider>
  );
}

async function flushBackupPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('save backup scheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-01T05:30:05.123Z'));
    localStorage.clear();
    mockCreateSaveBackup.mockReset().mockResolvedValue('snapshot');
    mockShowToast.mockReset();
    setSettingsForTest = () => undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs immediately when the last success is missing or overdue', async () => {
    localStorage.setItem(
      'save-backup-settings',
      JSON.stringify({ enabled: true, intervalMinutes: 60 }),
    );
    localStorage.setItem(
      SAVE_BACKUP_LAST_SUCCESS_STORAGE_KEY,
      JSON.stringify({
        savesPath: mockSavesPath,
        timestamp: Date.now() - SAVE_BACKUP_INTERVAL_MILLISECONDS - 1,
      }),
    );

    render(<Harness />);
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });
    await flushBackupPromises();

    expect(mockCreateSaveBackup).toHaveBeenCalledTimes(1);
    expect(mockCreateSaveBackup).toHaveBeenCalledWith(mockSavesPath);
    expect(
      JSON.parse(
        localStorage.getItem(SAVE_BACKUP_LAST_SUCCESS_STORAGE_KEY) ?? '{}',
      ),
    ).toMatchObject({
      savesPath: mockSavesPath,
      timestamp: expect.any(Number),
    });
  });

  it('waits for the remaining interval and never overlaps executions', async () => {
    let resolveBackup: (() => void) | null = null;
    mockCreateSaveBackup.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveBackup = resolve;
        }),
    );
    localStorage.setItem(
      'save-backup-settings',
      JSON.stringify({ enabled: true, intervalMinutes: 1 }),
    );
    localStorage.setItem(
      SAVE_BACKUP_LAST_SUCCESS_STORAGE_KEY,
      JSON.stringify({ savesPath: mockSavesPath, timestamp: Date.now() }),
    );

    render(<Harness />);
    act(() => {
      jest.advanceTimersByTime(SAVE_BACKUP_INTERVAL_MILLISECONDS - 1);
    });
    expect(mockCreateSaveBackup).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(mockCreateSaveBackup).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(SAVE_BACKUP_INTERVAL_MILLISECONDS * 2);
    });
    expect(mockCreateSaveBackup).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveBackup?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      jest.advanceTimersByTime(SAVE_BACKUP_INTERVAL_MILLISECONDS);
    });
    await flushBackupPromises();
    expect(mockCreateSaveBackup).toHaveBeenCalledTimes(2);
  });

  it('cancels the old path and immediately schedules the new path', async () => {
    localStorage.setItem(
      'save-backup-settings',
      JSON.stringify({ enabled: true, intervalMinutes: 60 }),
    );
    localStorage.setItem(
      SAVE_BACKUP_LAST_SUCCESS_STORAGE_KEY,
      JSON.stringify({ savesPath: mockSavesPath, timestamp: Date.now() }),
    );

    const view = render(<Harness />);
    const oldSavesPath = mockSavesPath;
    const newSavesPath = 'D:\\Saves\\D2RMM';
    view.rerender(<Harness savesPath={newSavesPath} />);
    await act(async () => {
      jest.advanceTimersByTime(0);
      await Promise.resolve();
    });
    await flushBackupPromises();

    expect(mockCreateSaveBackup).toHaveBeenCalledTimes(1);
    expect(mockCreateSaveBackup).toHaveBeenCalledWith(newSavesPath);
    expect(mockCreateSaveBackup).not.toHaveBeenCalledWith(oldSavesPath);
  });

  it('cancels timers when disabled and reschedules after an interval change', async () => {
    const initialTime = Date.now();
    localStorage.setItem(
      'save-backup-settings',
      JSON.stringify({ enabled: true, intervalMinutes: 60 }),
    );
    localStorage.setItem(
      SAVE_BACKUP_LAST_SUCCESS_STORAGE_KEY,
      JSON.stringify({ savesPath: mockSavesPath, timestamp: Date.now() }),
    );

    render(<Harness />);
    act(() => {
      setSettingsForTest((settings) => ({ ...settings, enabled: false }));
      jest.advanceTimersByTime(SAVE_BACKUP_INTERVAL_MILLISECONDS * 2);
    });
    expect(mockCreateSaveBackup).not.toHaveBeenCalled();

    jest.setSystemTime(initialTime);
    act(() => {
      setSettingsForTest(() => ({ enabled: true, intervalMinutes: 2 }));
    });
    act(() => {
      jest.advanceTimersByTime(SAVE_BACKUP_INTERVAL_MILLISECONDS * 2 - 1);
    });
    expect(mockCreateSaveBackup).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await waitFor(() => expect(mockCreateSaveBackup).toHaveBeenCalledTimes(1));
  });

  it('shows an error and keeps the next interval after a failed backup', async () => {
    mockCreateSaveBackup
      .mockRejectedValueOnce(new Error('backup failed'))
      .mockResolvedValueOnce('snapshot');
    localStorage.setItem(
      'save-backup-settings',
      JSON.stringify({ enabled: true, intervalMinutes: 1 }),
    );

    render(<Harness />);
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCreateSaveBackup).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'backup failed',
        severity: 'error',
        title: 'settings.general.saveBackup.toast.failed',
      }),
    );

    await act(async () => {
      jest.advanceTimersByTime(SAVE_BACKUP_INTERVAL_MILLISECONDS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCreateSaveBackup).toHaveBeenCalledTimes(2);
  });

  it('calculates an immediate delay for a changed or overdue path', () => {
    const now = 1_000_000;
    expect(
      getSaveBackupDelayMilliseconds(
        now,
        { savesPath: 'old', timestamp: now },
        'new',
        60,
      ),
    ).toBe(0);
    expect(
      getSaveBackupDelayMilliseconds(
        now,
        { savesPath: 'same', timestamp: now - 60 * 60 * 1000 },
        'same',
        60,
      ),
    ).toBe(0);
  });
});
