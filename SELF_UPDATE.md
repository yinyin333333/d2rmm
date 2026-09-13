# D2RMM Custom self-update

The **Update D2RMM** button checks `yinyin333333/d2rmm` only when clicked. It
selects the newest canonical numeric version, including GitHub prereleases
(the repository publishes its current version as a prerelease). Releases marked
`#alias`, drafts, older versions, and assets with different names are excluded.
The confirmation identifies the version and explains the restart.

Self-update is available only in packaged Windows x64 builds. macOS, Linux and
development builds retain their existing functionality without an apply button.
The first version containing this updater must be installed manually; it cannot
update an older installation that has no program ownership manifest.

## Preserved data

Only files in `.d2rmm-program.json` are replaced or removed. The manifest is
generated **after** Windows resource editing/signing and before ZIP wrapping.
The final ZIP is extracted and verified again by `afterAllArtifactBuild`.

The complete `mods`, `d2rloader`, legacy `d2rloader-packages`, `Local Storage`,
other Electron user-data files, `config.json`, and both
`ENABLE_LOCAL_PREFERENCES` / `ENABLE_GLOBAL_PREFERENCES` flags are excluded.
Game installations and saves are never update destinations. Unknown files are
preserved, including unknown files inside program directories. If a new program
file would collide with an unknown file, the update fails before replacement.
Shipped `mods/config-schema.json` remains unchanged during an update.

The updater flushes registered renderer settings, including pending color edits
and mod configuration writes. Unsaved plugin JSON edits and active plugin
mutations block applying the update. Renderer IPC drains before new requests are
blocked; Electron storage is flushed before normal shutdown. A helper startup
handshake precedes quitting. The independent PowerShell process holds handles
to the main process, Electron subprocesses and workers and waits for actual exit.

## Applying and failures

The ZIP, manifest identity/version/architecture, paths, file sizes, SHA-256
hashes, embedded ASAR package version and PE architecture are verified before
program replacement. GitHub's asset size and SHA-256 digest (when supplied) are
also checked. Updates use HTTPS; this does not add a separate code-signing trust
system. ASAR byte operations use Electron `original-fs` without changing the
global ASAR setting.

The packaged C# GUI launcher starts Windows PowerShell 5.1 independently; no
globally installed Node is required. Windows packaging compiles the launcher
with the Windows .NET Framework compiler. The GUI launcher detaches from
Electron, holds PowerShell's output handles and waits for its completion.
Direct detached PowerShell invocation is intentionally avoided: on Windows
PowerShell 5.1 it can exit zero without executing its script. UTF-8 is explicit
for plans, manifests and journals. Links and
reparse points are refused in update paths. Before replacement, the helper
checks file ownership, destination/ancestor collisions, available disk space
and exclusive access to existing files. It moves only old owned files to a
journaled backup, creates new directories, and installs the executable last.
Owned file/directory shape changes are supported; directories containing
unknown files are not removed. Ordinary mid-apply failures restore old files.

The helper displays progress and failure details after D2RMM closes. Logs are
in the installation's `.d2rmm-update-<random>` directory: `download.log`,
`launcher.log`, `helper.log`, `update.log`, and `status.json`. A successful restart must confirm
the expected application version and the same user-data location after renderer
initialization. The updater then deletes its ZIP, staged files and backup.
Small diagnostic files are retained. On failed validation or failed restart,
staged files/backups are retained for diagnosis; these directories may require
manual cleanup after the failure is resolved.

For an abrupt interruption, `.d2rmm-update-lock` blocks another application
startup and contains the exact `plan.json` path. Close any updater window and
ensure D2RMM is stopped, then run the **copied** helper in that job directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "<job>\updater.ps1" -Plan "<job>\plan.json" -Recover
```

Recovery touches only journaled program files. Do not delete the lock or backup
before recovery completes. File locks, permissions, disk failures or antivirus
interference can still prevent replacement/restoration; the error includes the
log and recovery location. No folder-wide installation deletion is performed.

## Verification

`npm run verify` includes isolated actual Windows PowerShell apply tests
(skipped on non-Windows), ZIP validation, version selection and packaging-hook
tests. The Windows tests cover actual exit waiting, new/removed program files,
byte preservation, file/directory transitions, rollback, abrupt interruption
recovery, restart acknowledgement and UTF-8 paths.

The actual packaged archive can also be verified in a real Electron main
process (not Node compatibility mode):

```text
node .erb/scripts/test-update-electron.js <electron.exe> <unpacked-application-root> <Windows-ZIP>
```

This requires explicit completion and revalidates all archive bytes through
the same production validator. It catches ASAR virtualization and large-stream
problems that small Node-only fixtures cannot detect.

For a full packaged-app check, `node .erb/scripts/test-update-live.js
<unpacked-root> <Windows-ZIP> <new-output-directory>` creates a separate older
fixture and clicks the real update controls through its local debugger. GitHub
transport is replaced with the supplied ZIP; the production download,
validation, shutdown, launcher, apply and restart paths run unchanged. It
checks persisted order/enabled/settings, plugin and mod bytes and the actual
new application version, then closes the test application. This test creates
temporary application/updater windows; it never uses the user's installation.
