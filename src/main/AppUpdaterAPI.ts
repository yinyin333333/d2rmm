import type { AppUpdateStatus, IAppUpdaterAPI } from 'bridge/AppUpdaterAPI';
import { spawn } from 'child_process';
import { app, BrowserWindow, dialog } from 'electron';
import { existsSync, promises as fs, openSync, closeSync } from 'fs';
import path from 'path';
import {
  assertNoLinks,
  downloadPackage,
  selectRelease,
  stagePackage,
  updateRequestSignal,
  validateInstallation,
  UpdateRelease,
} from './AppUpdatePackage';
import { freezeForUpdate, provideAPI, resumeAfterUpdateFailure } from './IPC';
import { fs as updateFS } from './UpdateFileSystem';
import { getLiveWorkerPids, getWorkers } from './Workers';

const root = path.dirname(process.execPath);
const supported =
  process.platform === 'win32' && process.arch === 'x64' && app.isPackaged;
let state: AppUpdateStatus = {
  supported,
  phase: 'idle',
  message: '',
  progress: null,
  version: null,
  log: null,
};
let selection: ReturnType<typeof selectRelease> = null;
let work: string | null = null;
let busy = false;
let operation: AbortController | null = null;
let cancellation: Promise<void> | null = null;
let quitting = false;
export function isAppUpdateBusy(): boolean {
  return ['starting', 'waiting'].includes(state.phase) && !quitting;
}
async function setStatus(
  phase: string,
  message = '',
  progress: number | null = null,
): Promise<void> {
  state = { ...state, phase, message, progress };
  if (work != null)
    await fs.appendFile(
      path.join(work, 'download.log'),
      `${new Date().toISOString()} ${phase}: ${message}\n`,
    );
}
function requireSupported(): void {
  if (!supported)
    throw new Error('Self-update requires the packaged Windows x64 ZIP.');
}
async function discardPreparation(directory: string): Promise<void> {
  // Detach logging before removing files; later checks must not recreate this job.
  if (work === directory) {
    work = null;
    state.log = null;
  }
  try {
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== root ||
      !path.basename(target).startsWith('.d2rmm-update-')
    )
      throw new Error('Invalid update cleanup directory.');
    await assertNoLinks(target);
    await updateFS.rm(target, { recursive: true, force: true });
  } catch (error) {
    state.message += `\nCould not remove cancelled update files: ${directory}\n${String(error)}`;
    throw new Error(state.message);
  }
}
export function blockInterruptedUpdate(): boolean {
  if (supported && existsSync(path.join(root, '.d2rmm-update-lock'))) {
    dialog.showErrorBox(
      'D2RMM update in progress',
      'An update is applying or was interrupted. Use the updater window and its log/recovery instructions before starting D2RMM.\n' +
        path.join(root, '.d2rmm-update-lock'),
    );
    app.exit(1);
    return true;
  }
  return false;
}
export function initAppUpdaterAPI(): void {
  provideAPI('AppUpdaterAPI', {
    ready: confirmUpdatedStartup,
    status: async () => state,
    cancel: async () => {
      if (quitting || ['starting', 'waiting'].includes(state.phase))
        throw new Error('Update handoff is in progress.');
      if (cancellation != null) return cancellation;
      // The renderer also calls cancel() after errors. Preserve failed jobs and
      // their diagnostics; only an explicit cancellation of live work discards it.
      if (state.phase === 'failed') return;
      const prepared =
        state.phase === 'prepared' && operation == null ? work : null;
      operation?.abort(new Error('Update cancelled before shutdown.'));
      resumeAfterUpdateFailure();
      state = {
        ...state,
        phase: 'failed',
        message: 'Update cancelled before shutdown.',
        progress: null,
      };
      // Running operations own their file handles and perform cleanup in finally.
      // Avoid racing their final log write with an independent cancellation log.
      if (operation != null) return;
      busy = true;
      try {
        if (prepared != null) {
          cancellation = discardPreparation(prepared);
          await cancellation;
        }
      } finally {
        cancellation = null;
        busy = false;
      }
    },
    check: async () => {
      requireSupported();
      if (busy) throw new Error('An update is already running.');
      busy = true;
      const controller = new AbortController();
      operation = controller;
      try {
        await setStatus('checking');
        const response = await fetch(
          'https://api.github.com/repos/yinyin333333/d2rmm/releases?per_page=100',
          {
            headers: { Accept: 'application/vnd.github+json' },
            signal: updateRequestSignal(30000, controller.signal),
          },
        );
        if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`);
        const releases = (await response.json()) as UpdateRelease[];
        controller.signal.throwIfAborted();
        selection = selectRelease(releases, app.getVersion());
        state.version = selection?.version ?? null;
        await setStatus(selection == null ? 'current' : 'available');
        controller.signal.throwIfAborted();
        return state;
      } catch (error) {
        await setStatus('failed', String(error));
        throw error;
      } finally {
        busy = false;
        operation = null;
      }
    },
    prepare: async () => {
      requireSupported();
      if (busy || selection == null)
        throw new Error('Check for an update first.');
      busy = true;
      const controller = new AbortController();
      operation = controller;
      let jobDirectory: string | null = null;
      // Previous failed jobs remain on disk, but never belong to this attempt.
      work = null;
      state.log = null;
      state.phase = 'validating';
      state.progress = null;
      try {
        await assertNoLinks(root);
        await validateInstallation(
          root,
          app.getVersion(),
          process.arch,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        jobDirectory = await fs.mkdtemp(path.join(root, '.d2rmm-update-'));
        work = jobDirectory;
        state.log = path.join(work, 'download.log');
        await setStatus('downloading');
        await downloadPackage(
          selection.asset,
          path.join(work, 'release.zip'),
          (progress) => {
            state = { ...state, progress };
          },
          controller.signal,
        );
        controller.signal.throwIfAborted();
        await setStatus('validating');
        await stagePackage(
          path.join(work, 'release.zip'),
          path.join(work, 'stage'),
          selection.version,
          process.arch,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        await setStatus('prepared');
        controller.signal.throwIfAborted();
      } catch (error) {
        await setStatus('failed', String(error));
        throw error;
      } finally {
        try {
          if (controller.signal.aborted && jobDirectory != null)
            await discardPreparation(jobDirectory);
        } finally {
          if (controller.signal.aborted || state.phase !== 'prepared')
            busy = false;
          operation = null;
        }
      }
    },
    install: async () => {
      requireSupported();
      if (
        !busy ||
        operation != null ||
        state.phase !== 'prepared' ||
        work == null ||
        selection == null
      )
        throw new Error('No validated update is ready.');
      const jobDirectory = work;
      let helper: ReturnType<typeof spawn> | null = null;
      try {
        state.phase = 'starting'; // close duplicate install admission synchronously
        freezeForUpdate();
        for (const win of BrowserWindow.getAllWindows())
          win.webContents.session.flushStorageData();
        await setStatus('starting');
        const plan = path.join(jobDirectory, 'plan.json');
        const pids = [
          ...new Set([
            process.pid,
            ...app.getAppMetrics().map(({ pid }) => pid),
            ...getLiveWorkerPids(),
          ]),
        ];
        await fs.writeFile(
          plan,
          JSON.stringify({
            root,
            stage: path.join(jobDirectory, 'stage'),
            version: selection.version,
            oldVersion: app.getVersion(),
            arch: process.arch,
            pids,
            cwd: process.cwd(),
            userData: app.getPath('userData'),
          }),
          { flag: 'wx' },
        );
        // Run the known installed helper with the OS runtime, entirely outside files being replaced.
        const script = path.join(jobDirectory, 'updater.ps1');
        await fs.copyFile(
          path.join(process.resourcesPath, 'updater.ps1'),
          script,
        );
        const launcher = path.join(jobDirectory, 'updater-launcher.exe');
        await fs.copyFile(
          path.join(process.resourcesPath, 'updater-launcher.exe'),
          launcher,
        );
        const output = openSync(path.join(jobDirectory, 'launcher.log'), 'a');
        try {
          helper = spawn(launcher, [script, plan], {
            // Detach the GUI launcher, not PowerShell's console host.
            detached: true,
            windowsHide: true,
            stdio: ['ignore', output, output],
            cwd: jobDirectory,
          });
        } finally {
          closeSync(output);
        }
        let helperError: Error | null = null;
        helper.on('error', (error) => {
          helperError = error;
        });
        helper.on('exit', (code) => {
          helperError = new Error(`Updater exited before handoff (${code}).`);
        });
        const deadline = Date.now() + 30000;
        while (!existsSync(path.join(jobDirectory, 'ready'))) {
          if (helperError != null) throw helperError;
          if (Date.now() > deadline)
            throw new Error('Updater did not start. D2RMM remains open.');
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (helperError != null) throw helperError;
        state.log = path.join(jobDirectory, 'update.log');
        await setStatus('waiting');
        await fs.writeFile(path.join(jobDirectory, 'authorize'), 'authorized', {
          flag: 'wx',
        });
        helper.unref();
        quitting = true;
        setTimeout(() => app.quit(), 100);
      } catch (error) {
        await fs
          .writeFile(path.join(jobDirectory, 'cancel'), 'cancel')
          .catch(console.error);
        // No authorization can apply files while this main process remains
        // alive. Join the failed helper before releasing its owned lock.
        if (
          helper?.pid != null &&
          helper.exitCode == null &&
          helper.signalCode == null
        ) {
          const deadline = Date.now() + 2000;
          while (
            helper.exitCode == null &&
            helper.signalCode == null &&
            Date.now() < deadline
          )
            await new Promise((resolve) => setTimeout(resolve, 50));
          if (helper.exitCode == null && helper.signalCode == null)
            helper.kill();
          const killedDeadline = Date.now() + 2000;
          while (
            helper.exitCode == null &&
            helper.signalCode == null &&
            Date.now() < killedDeadline
          )
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (
          helper != null &&
          (helper.exitCode != null || helper.signalCode != null)
        ) {
          const lock = path.join(root, '.d2rmm-update-lock');
          if (
            (await fs.readFile(lock, 'utf8').catch(() => '')) ===
            path.join(jobDirectory, 'plan.json')
          )
            await fs.unlink(lock);
        }
        resumeAfterUpdateFailure();
        busy = false;
        await setStatus(
          'failed',
          `${String(error)}\n${path.join(jobDirectory, 'update.log')}\n${path.join(jobDirectory, 'helper.log')}\n${path.join(jobDirectory, 'launcher.log')}`,
        );
        throw new Error(state.message);
      }
    },
  } as IAppUpdaterAPI);
}
export async function confirmUpdatedStartup(): Promise<void> {
  const ack = process.env.D2RMM_UPDATE_ACK;
  delete process.env.D2RMM_UPDATE_ACK;
  if (!supported || ack == null) return;
  if (getWorkers().size === 0)
    throw new Error('Updated application worker did not initialize.');
  const directory = path.dirname(ack);
  if (
    path.dirname(directory) !== root ||
    !path.basename(directory).startsWith('.d2rmm-update-') ||
    path.basename(ack) !== 'restarted.json'
  )
    return;
  await assertNoLinks(ack);
  const plan = JSON.parse(
    await fs.readFile(path.join(directory, 'plan.json'), 'utf8'),
  );
  if (plan.root !== root || plan.version !== app.getVersion()) return;
  const temporaryAck = `${ack}.tmp`;
  await fs.writeFile(
    temporaryAck,
    JSON.stringify({
      version: app.getVersion(),
      userData: app.getPath('userData'),
    }),
    { flag: 'wx' },
  );
  await fs.rename(temporaryAck, ack);
}
