param([Parameter(Mandatory=$true)][string]$Plan, [switch]$Headless, [switch]$Recover, [int]$FailAfterFile = -1, [int]$FailAfterInstall = -1, [int]$CrashAfterInstall = -1)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$utf8 = New-Object System.Text.UTF8Encoding($false)
$job = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
$work = Split-Path -Parent $Plan
$log = Join-Path $work 'update.log'
$status = Join-Path $work 'status.json'
$lock = Join-Path $job.root '.d2rmm-update-lock'
$journalPath = Join-Path $work 'journal.json'
$manifestName = '.d2rmm-program.json'
$handles = @()
$locks = @()
$journal = @()
$ownsLock = $false
$committed = $false
$authorized = $false
function Report([string]$phase, [string]$message) {
  [IO.File]::AppendAllText($log, "$(Get-Date -Format o) [$phase] $message`r`n", $utf8)
  [IO.File]::WriteAllText($status, (@{phase=$phase; message=$message; log=$log} | ConvertTo-Json -Compress), $utf8)
  if (!$Headless) { $label.Text = $message; [Windows.Forms.Application]::DoEvents() }
}
function SafePath([string]$root, [string]$name) {
  if ($name.Length -gt 220 -or $name -match '[\\<>:"|?*\x00-\x1f]' -or
      ($name.Split('/') | Where-Object { !$_ -or $_ -match '[. ]$' -or $_ -match '^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)' })) { throw "Unsafe path: $name" }
  $current = [IO.Path]::GetFullPath($root)
  # Check ancestors too: a junction containing the installation is not supported.
  $ancestor = $current
  while ($ancestor) {
    if ([IO.Directory]::Exists($ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Linked path: $ancestor" }
    $ancestor = Split-Path -Parent $ancestor
  }
  foreach ($segment in $name.Split('/')) {
    $current = Join-Path $current $segment
    if (Test-Path -LiteralPath $current) {
      if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked path: $current" }
    }
  }
  return $current
}
function ProgramName([string]$name) {
  return $name -cmatch '^(resources|locales|tools)/' -or $name -cmatch '^(D2RMM Custom\.exe|LICENSE(?:\.electron\.txt|S\.chromium\.html)?|version|types\.d\.ts|tsconfig\.json|vk_swiftshader_icd\.json|[a-zA-Z0-9_-]+\.(dll|pak|dat|bin))$'
}
function ReadManifest([string]$root, [string]$version) {
  $value = Get-Content -LiteralPath (SafePath $root $manifestName) -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($value.format -ne 1 -or $value.product -cne 'D2RMM Custom' -or $value.platform -cne 'win32' -or
      $value.arch -cne $job.arch -or $value.version -cne $version -or $version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid manifest identity' }
  $seen = @{}
  foreach ($file in $value.files) {
    $null = SafePath $root $file.path
    if (!(ProgramName $file.path) -or $seen.ContainsKey($file.path) -or $file.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $file.size -lt 0) { throw 'Invalid manifest file' }
    $seen[$file.path] = $true
  }
  foreach ($required in @('D2RMM Custom.exe','resources/app.asar','resources/updater.ps1','resources/updater-launcher.exe')) {
    if (!$seen.ContainsKey($required)) { throw "Missing $required" }
  }
  return $value
}
function CheckFile([string]$root, $file) {
  $target = SafePath $root $file.path
  $info = Get-Item -LiteralPath $target -Force
  $hasher = [Security.Cryptography.SHA256]::Create()
  $inputStream = [IO.File]::OpenRead($target)
  try { $hash = [BitConverter]::ToString($hasher.ComputeHash($inputStream)).Replace('-','').ToLowerInvariant() }
  finally { $inputStream.Dispose(); $hasher.Dispose() }
  if ($info.PSIsContainer -or $info.Length -ne $file.size -or $hash -cne $file.sha256) { throw "File changed or corrupt: $target" }
}
function SaveJournal {
  $temporary = "$journalPath.tmp"
  [IO.File]::WriteAllText($temporary, (ConvertTo-Json -InputObject @($script:journal) -Depth 5), $utf8)
  if ([IO.File]::Exists($journalPath)) { [IO.File]::Replace($temporary, $journalPath, "$journalPath.previous") }
  else { [IO.File]::Move($temporary, $journalPath) }
}
function Rollback {
  Report 'restoring' 'Restoring the previous program files...'
  for ($i = $script:journal.Count - 1; $i -ge 0; $i--) {
    $entry = $script:journal[$i]
    $target = SafePath $job.root $entry.name
    $backup = SafePath (Join-Path $work 'backup') $entry.name
    if ([IO.File]::Exists($backup)) {
      if ([IO.File]::Exists($target)) { [IO.File]::Delete($target) }
      if ([IO.Directory]::Exists($target)) { RemoveEmptyDirectories $target }
      [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
      [IO.File]::Move($backup, $target)
    } elseif (!$entry.existed -and [IO.File]::Exists($target)) { [IO.File]::Delete($target) }
  }
}
function RemoveEmptyDirectories([string]$directory) {
  foreach ($entry in Get-ChildItem -LiteralPath $directory -Force) {
    if (!$entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Nonempty program directory: $directory" }
    RemoveEmptyDirectories $entry.FullName
  }
  [IO.Directory]::Delete($directory)
}
function CheckOwnedDirectory([string]$directory) {
  foreach ($entry in Get-ChildItem -LiteralPath $directory -Force) {
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked destination: $($entry.FullName)" }
    if ($entry.PSIsContainer) { CheckOwnedDirectory $entry.FullName }
    else {
      $relative = $entry.FullName.Substring($job.root.Length + 1).Replace('\','/')
      if (!$oldNames.ContainsKey($relative)) { throw "Unowned destination exists: $($entry.FullName)" }
    }
  }
}
function RemoveOwnedTree([string]$directory) {
  if (!(Test-Path -LiteralPath $directory)) { return }
  foreach ($entry in Get-ChildItem -LiteralPath $directory -Force) {
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing linked cleanup path: $($entry.FullName)" }
    if ($entry.PSIsContainer) { RemoveOwnedTree $entry.FullName }
    else { [IO.File]::Delete($entry.FullName) }
  }
  [IO.Directory]::Delete($directory)
}
if (!$Headless) {
  Add-Type -AssemblyName System.Windows.Forms
  $form = New-Object Windows.Forms.Form
  $form.Text = 'D2RMM Custom Update'; $form.Width = 640; $form.Height = 180
  $form.ControlBox = $false; $form.StartPosition = 'CenterScreen'
  $label = New-Object Windows.Forms.Label; $label.Dock = 'Fill'; $label.Padding = 20
  $form.Controls.Add($label); $form.Show()
}
try {
  $null = SafePath $job.root $manifestName
  $null = SafePath $work 'backup'
  if ($Recover) {
    if ((Get-Content -LiteralPath $lock -Raw -Encoding UTF8) -cne $Plan) { throw 'Recovery does not own the installation lock' }
    $ownsLock = $true
    $journal = Get-Content -LiteralPath $journalPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $oldManifestRoot = $job.root
    if ([IO.File]::Exists((Join-Path (Join-Path $work 'backup') $manifestName))) { $oldManifestRoot = Join-Path $work 'backup' }
    $recoveryOld = ReadManifest $oldManifestRoot $job.oldVersion
    $recoveryNew = ReadManifest $job.stage $job.version
    $oldOwned = @{}; $newOwned = @{}; $journalNames = @{}
    foreach ($file in $recoveryOld.files) { $oldOwned[$file.path] = $true }
    foreach ($file in $recoveryNew.files) { $newOwned[$file.path] = $true }
    foreach ($entry in $journal) {
      if ((!(ProgramName $entry.name) -and $entry.name -cne $manifestName) -or
          $journalNames.ContainsKey($entry.name) -or $entry.existed -isnot [bool] -or
          ($entry.existed -and !$oldOwned.ContainsKey($entry.name) -and $entry.name -cne $manifestName) -or
          (!$entry.existed -and (!$newOwned.ContainsKey($entry.name) -or $oldOwned.ContainsKey($entry.name)))) { throw 'Invalid recovery journal path or ownership' }
      $journalNames[$entry.name] = $true
    }
    Rollback
    Remove-Item -LiteralPath $lock
    $ownsLock = $false
    Report 'restored' 'Previous program restored. You may start D2RMM again.'
  } else {
    # Open process handles BEFORE acknowledging readiness, preventing PID reuse races.
    foreach ($processID in $job.pids) {
      $tracked = [Diagnostics.Process]::GetProcessById($processID)
      $null = $tracked.Handle
      $handles += $tracked
    }
    $lockStream = [IO.File]::Open($lock, 'CreateNew', 'Write', 'None')
    $ownsLock = $true
    $bytes = $utf8.GetBytes($Plan); $lockStream.Write($bytes, 0, $bytes.Length); $lockStream.Dispose()
    Report 'ready' 'Updater ready. Waiting for settings to finish and D2RMM to close...'
    [IO.File]::WriteAllText((Join-Path $work 'ready'), 'ready', $utf8)
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    while (!(Test-Path -LiteralPath (Join-Path $work 'authorize'))) {
      if ((Test-Path -LiteralPath (Join-Path $work 'cancel')) -or [DateTime]::UtcNow -gt $deadline) { throw 'Update was not authorized; program unchanged' }
      Start-Sleep -Milliseconds 100
    }
    Report 'waiting' 'Waiting for all D2RMM processes to exit...'
    $authorized = $true
    foreach ($tracked in $handles) { if (!$tracked.WaitForExit(60000)) { throw 'D2RMM is still running; program unchanged' } }
    $old = ReadManifest $job.root $job.oldVersion
    $new = ReadManifest $job.stage $job.version
    $oldNames = @{}; $newNames = @{}
    foreach ($file in $old.files) { CheckFile $job.root $file; $oldNames[$file.path] = $file }
    foreach ($file in $new.files) {
      CheckFile $job.stage $file; $newNames[$file.path] = $file
      $target = SafePath $job.root $file.path
      if ([IO.Directory]::Exists($target)) { CheckOwnedDirectory $target }
      elseif (!$oldNames.ContainsKey($file.path) -and [IO.File]::Exists($target)) { throw "Unowned destination exists: $target" }
      $ancestor = Split-Path -Parent $target
      while ($ancestor -ine $job.root) {
        $relative = $ancestor.Substring($job.root.Length + 1).Replace('\','/')
        if ([IO.File]::Exists($ancestor) -and !$oldNames.ContainsKey($relative)) { throw "Unowned parent file: $ancestor" }
        $ancestor = Split-Path -Parent $ancestor
      }
    }
    $requiredBytes = ($new.files | Measure-Object -Property size -Sum).Sum + 8388608
    $volume = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($job.root))
    if ($volume.AvailableFreeSpace -lt $requiredBytes) { throw 'Not enough free space to install the new program while retaining the rollback copy.' }
    # Probe every existing destination for locks before the first rename.
    foreach ($name in @($oldNames.Keys) + @($manifestName)) {
      $locks += [IO.File]::Open((SafePath $job.root $name), 'Open', 'ReadWrite', 'None')
    }
    foreach ($stream in $locks) { $stream.Dispose() }; $locks = @()
    Report 'applying' 'Installing program files. Your mods, plugins and settings are preserved...'
    # Executable is removed first and installed last, preventing launches of a mixed version.
    $names = @('D2RMM Custom.exe') + @($oldNames.Keys | Sort-Object | Where-Object { $_ -cne 'D2RMM Custom.exe' }) + @($manifestName)
    foreach ($name in $names) {
      if ($journal.Count -eq $FailAfterFile) { throw 'Injected file replacement failure' }
      $target = SafePath $job.root $name
      $backup = SafePath (Join-Path $work 'backup') $name
      $existed = [IO.File]::Exists($target)
      $journal += @{name=$name; existed=$existed}; SaveJournal
      if ($existed) {
        [IO.Directory]::CreateDirectory((Split-Path -Parent $backup)) | Out-Null
        [IO.File]::Move($target, $backup)
      }
    }
    # All old files are staged before installing any new file. This permits
    # owned file/directory transitions while leaving every unknown file alone.
    $installNames = @($newNames.Keys | Sort-Object | Where-Object { $_ -cne 'D2RMM Custom.exe' }) + @($manifestName,'D2RMM Custom.exe')
    $installedCount = 0
    foreach ($name in $installNames) {
      $target = SafePath $job.root $name
      if (!$oldNames.ContainsKey($name) -and $name -cne $manifestName) {
        $journal += @{name=$name; existed=$false}; SaveJournal
      }
      if ([IO.Directory]::Exists($target)) { RemoveEmptyDirectories $target }
      [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
      [IO.File]::Copy((SafePath $job.stage $name), $target, $false)
      $installedCount++
      if ($Headless -and $installedCount -eq $FailAfterInstall) { throw 'Injected file replacement failure' }
      if ($Headless -and $installedCount -eq $CrashAfterInstall) { [Environment]::Exit(99) }
    }
    foreach ($file in $new.files) { CheckFile $job.root $file }
    $committed = $true
    Remove-Item -LiteralPath $lock
    $ownsLock = $false
    Report 'restarting' 'Update installed. Restarting D2RMM...'
    $restart = New-Object Diagnostics.ProcessStartInfo
    $restart.FileName = Join-Path $job.root 'D2RMM Custom.exe'
    $restart.WorkingDirectory = $job.cwd
    $restart.UseShellExecute = $false
    $restart.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
    $ack = Join-Path $work 'restarted.json'
    $restart.EnvironmentVariables['D2RMM_UPDATE_ACK'] = $ack
    $started = [Diagnostics.Process]::Start($restart)
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while (!(Test-Path -LiteralPath $ack)) {
      if ($started.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw 'Updated program did not confirm startup. See d2rmm.log. The new version remains installed.' }
      Start-Sleep -Milliseconds 100
      if (!$Headless) { [Windows.Forms.Application]::DoEvents() }
    }
    $confirmation = Get-Content -LiteralPath $ack -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($confirmation.version -cne $job.version -or $confirmation.userData -ine $job.userData) { throw 'Restarted version or settings location differs from the expected installation.' }
    Report 'complete' 'Update complete.'
    foreach ($name in @('backup','stage')) { RemoveOwnedTree (SafePath $work $name) }
    if ([IO.File]::Exists((Join-Path $work 'release.zip'))) { [IO.File]::Delete((Join-Path $work 'release.zip')) }
  }
} catch {
  $failure = $_.Exception.ToString()
  # An unreadable/corrupt recovery journal must never unlock a partial install.
  if ($Recover) { $ownsLock = $false }
  foreach ($stream in $locks) { $stream.Dispose() }; $locks = @()
  if (!$Recover -and !$committed -and $journal.Count -gt 0) {
    try { Rollback } catch { $failure += "`r`nRESTORE FAILED: $($_.Exception). Run updater.ps1 -Plan `"$Plan`" -Recover"; $ownsLock = $false }
  }
  if ($ownsLock) { Remove-Item -LiteralPath $lock -ErrorAction SilentlyContinue }
  Report 'failed' "$failure`r`nLog: $log"
  if (!$Headless -and $authorized) { [Windows.Forms.MessageBox]::Show("$failure`r`n`r`nLog: $log", 'D2RMM update failed') | Out-Null }
  exit 1
} finally {
  foreach ($tracked in $handles) { $tracked.Dispose() }
  if (!$Headless) { $form.Close() }
}
