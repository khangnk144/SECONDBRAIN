<#
  Second Brain launcher (Windows PowerShell 5.1+).

  start-second-brain.ps1          Start the app (or just open it if it is already running).
  start-second-brain.ps1 stop     Stop the background server (graceful, then only our own node process).
  start-second-brain.ps1 login    Start the server at Windows sign-in (start-hidden.vbs): no browser,
                                  no console, silent when it already runs; problems go to
                                  <home>\.secondbrain\logs\launcher.log and one message box.

  Folder layout: <home>\app\launcher\start-second-brain.ps1, global state in <home>\.secondbrain\.
  Exit code 0 = success, 1 = something went wrong (the .cmd wrapper then keeps the window open).
#>
param([string]$Action = 'start')

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# $HOME and $PID are automatic variables in PowerShell, so different names are used here.
$LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $LauncherDir
$SbHome = Split-Path -Parent $AppDir
$StateDir = Join-Path $SbHome '.secondbrain'
$SettingsFile = Join-Path $StateDir 'settings.json'
$ServerInfoFile = Join-Path $StateDir 'server.json'
$LockFile = Join-Path $StateDir 'launcher.lock'
$LogFile = Join-Path $StateDir 'logs/server.log'
$LauncherLogFile = Join-Path $StateDir 'logs/launcher.log'
$LauncherLogMaxBytes = 1MB
$MinNodeVersion = [Version]'22.12.0'
$DefaultPort = 4747
$ExitPortBusy = 2
$LockMaxAgeMinutes = 15
$OtherLauncherWaitSeconds = 600
$AppTitle = 'Second Brain'
$LoginMode = ($Action -eq 'login')
# Forward slashes work on Windows too; the platform check lets the script be smoke-tested elsewhere.
$OnWindows = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
$NpmCommand = if ($OnWindows) { 'npm.cmd' } else { 'npm' }

function Write-Step([string]$Message) { Write-Host "  $Message" }
function Write-Problem([string]$Message) { Write-Host ''; Write-Host "  $Message" -ForegroundColor Yellow }

# Appends one line to launcher.log (UTF-8 without BOM, rotated at 1 MB); never fails the launcher.
function Write-LauncherLog([string]$Message) {
  try {
    $logDir = Split-Path -Parent $LauncherLogFile
    if (-not (Test-Path -LiteralPath $logDir)) { $null = New-Item -ItemType Directory -Force -Path $logDir }
    $existing = Get-Item -Force -LiteralPath $LauncherLogFile -ErrorAction SilentlyContinue
    if ($null -ne $existing -and $existing.Length -gt $LauncherLogMaxBytes) {
      Move-Item -Force -LiteralPath $LauncherLogFile -Destination "$LauncherLogFile.1"
    }
    $line = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + " [$Action] $Message" + [Environment]::NewLine
    [System.IO.File]::AppendAllText($LauncherLogFile, $line, (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
}

# A message box in front of other windows (the login launcher has no console to write to).
function Show-MessageBox([string]$Message) {
  if (-not $OnWindows) {
    Write-Host "  [hộp thoại] $Message"
    return
  }
  $owner = $null
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $null = [System.Windows.Forms.MessageBox]::Show($owner, $Message, $AppTitle,
      [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
  } catch {
    Write-LauncherLog "The message box could not be shown: $($_.Exception.Message)"
  } finally {
    if ($null -ne $owner) { $owner.Dispose() }
  }
}

# Every failure ends here: console text (start/stop), launcher.log, and in login mode (or when
# -Dialog asks for it) exactly one message box, then exit 1.
function Stop-WithProblem([string]$Message, [string]$Hint = '', [switch]$Dialog, [switch]$WithLog) {
  Write-Problem $Message
  if ($Hint) { Write-Step $Hint }
  if ($WithLog -and -not $LoginMode) { Show-LogTail }
  Write-LauncherLog ("$Message $Hint").Trim()
  if ($LoginMode -or $Dialog) {
    $text = $Message
    if ($Hint) { $text += [Environment]::NewLine + [Environment]::NewLine + $Hint }
    Show-MessageBox $text
  }
  exit 1
}

function Get-JsonProperty($Object, [string]$Name) {
  if ($null -eq $Object) { return $null }
  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop) { return $null }
  return $prop.Value
}

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try { return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Get-AppPort {
  $port = Get-JsonProperty (Read-JsonFile $SettingsFile) 'port'
  if ($port -is [int] -or $port -is [long]) {
    if ($port -ge 1 -and $port -le 65535) { return [int]$port }
  }
  return $DefaultPort
}

function Test-AppHealth([int]$Port) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2 -UseBasicParsing
    return ((Get-JsonProperty $health 'app') -eq 'second-brain')
  } catch {
    return $false
  }
}

# The installed app (PWA) is a Start menu shortcut named "Second Brain" that starts the browser
# with --app-id. Edge also writes --app-url; a shortcut installed for another port is skipped.
function Find-InstalledAppShortcut([int]$Port) {
  if (-not $OnWindows -or -not $env:APPDATA) { return $null }
  $programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  $candidates = @(
    (Join-Path $programs 'Second Brain.lnk'),
    (Join-Path $programs 'Chrome Apps\Second Brain.lnk'),
    (Join-Path $programs 'Edge Apps\Second Brain.lnk')
  )
  $shell = $null
  foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    try {
      if ($null -eq $shell) { $shell = New-Object -ComObject WScript.Shell }
      $arguments = [string]$shell.CreateShortcut($candidate).Arguments
    } catch {
      continue
    }
    if ($arguments -notmatch '--app-id=') { continue }
    if ($arguments -match '--app-url=("?)(http://[^"\s]+)') {
      if (-not $Matches[2].StartsWith("http://localhost:$Port/")) { continue }
    } elseif ($Port -ne $DefaultPort) {
      # Chrome's shortcut names no URL: after a port change it may still open the old address,
      # so only the browser is sure to reach the app.
      continue
    }
    return $candidate
  }
  return $null
}

# Opens the installed app if there is one (a second launch focuses its open window, manifest
# launch_handler "focus-existing"), else the default browser. The login action never opens anything.
function Open-App([int]$Port) {
  if ($LoginMode) { return }
  $url = "http://localhost:$Port/"
  $shortcut = Find-InstalledAppShortcut $Port
  try {
    if ($null -ne $shortcut) { Start-Process -FilePath $shortcut } else { Start-Process $url }
  } catch {
    Write-Step "Mở $url trong trình duyệt để dùng app."
  }
}

function Assert-Node {
  $hint = 'Cài Node.js 24 LTS tại https://nodejs.org rồi bấm đúp lại "Mở Second Brain".'
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $node) {
    Stop-WithProblem 'Chưa tìm thấy Node.js trên máy.' $hint
  }
  $raw = (& node -v).Trim().TrimStart('v')
  $clean = ($raw -split '-')[0]
  $version = $null
  if (-not [Version]::TryParse($clean, [ref]$version) -or $version -lt $MinNodeVersion) {
    Stop-WithProblem "Node.js $raw đã cũ, app cần bản $MinNodeVersion trở lên." $hint
  }
  return $node.Source
}

function Test-BuildNeeded {
  $serverEntry = Join-Path $AppDir 'server/dist/index.js'
  $webEntry = Join-Path $AppDir 'web/dist/index.html'
  if (-not (Test-Path -LiteralPath $serverEntry) -or -not (Test-Path -LiteralPath $webEntry)) { return $true }
  $builtAt = @((Get-Item -Force -LiteralPath $serverEntry).LastWriteTimeUtc, (Get-Item -Force -LiteralPath $webEntry).LastWriteTimeUtc) |
    Sort-Object | Select-Object -First 1
  $sources = @()
  foreach ($dir in @('server/src', 'web/src', 'web/public')) {
    $full = Join-Path $AppDir $dir
    if (Test-Path -LiteralPath $full) { $sources += Get-ChildItem -Force -LiteralPath $full -Recurse -File }
  }
  foreach ($file in @('web/index.html', 'web/vite.config.ts', 'web/vite-plugin-service-worker.ts', 'package-lock.json')) {
    $full = Join-Path $AppDir $file
    if (Test-Path -LiteralPath $full) { $sources += Get-Item -Force -LiteralPath $full }
  }
  $newer = $sources | Where-Object { $_.LastWriteTimeUtc -gt $builtAt } | Select-Object -First 1
  return ($null -ne $newer)
}

function Test-InstallNeeded {
  # npm keeps a copy of the lockfile in node_modules; an older copy means dependencies changed.
  $installed = Join-Path $AppDir 'node_modules/.package-lock.json'
  $lockfile = Join-Path $AppDir 'package-lock.json'
  if (-not (Test-Path -LiteralPath $installed)) { return $true }
  if (-not (Test-Path -LiteralPath $lockfile)) { return $false }
  return ((Get-Item -Force -LiteralPath $lockfile).LastWriteTimeUtc -gt (Get-Item -Force -LiteralPath $installed).LastWriteTimeUtc)
}

function Invoke-Npm([string[]]$NpmArgs, [string]$What) {
  Write-Step $What
  Write-LauncherLog $What
  Push-Location -LiteralPath $AppDir
  try {
    & $NpmCommand @NpmArgs
    if ($LASTEXITCODE -ne 0) { throw "npm $($NpmArgs -join ' ') thất bại (mã $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }
}

function Show-LogTail {
  if (Test-Path -LiteralPath $LogFile) {
    Write-Step "Vài dòng cuối của nhật ký ($LogFile):"
    Get-Content -LiteralPath $LogFile -Tail 20 -Encoding UTF8 | ForEach-Object { Write-Host "    $_" }
  }
}

function Test-ProcessAlive([int]$ProcessId) {
  return ($null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue))
}

# Name of the program listening on the port (for the "port busy" message), or $null.
function Get-PortOwnerName([int]$Port) {
  if (-not $OnWindows) { return $null }
  $ownerPid = $null
  try {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($null -ne $listener) { $ownerPid = [int]$listener.OwningProcess }
  } catch { }
  if ($null -eq $ownerPid) {
    # Without the NetTCPIP module: netstat. A listening socket has no remote end (0.0.0.0:0 or
    # [::]:0); matching that instead of the state word works in every Windows language.
    try {
      $pattern = '^\s*TCP\s+\S+:' + $Port + '\s+(0\.0\.0\.0:0|\[::\]:0)\s+\S+\s+(\d+)\s*$'
      foreach ($line in @(& netstat.exe -ano -p TCP) + @(& netstat.exe -ano -p TCPv6)) {
        if ($line -match $pattern) { $ownerPid = [int]$Matches[2]; break }
      }
    } catch { }
  }
  if ($null -eq $ownerPid -or $ownerPid -le 0) { return $null }
  $process = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  $name = $null
  try { $name = [string]$process.Description } catch { }
  if ([string]::IsNullOrWhiteSpace($name)) { $name = $process.ProcessName }
  return $name
}

function Get-PortBusyMessage([int]$Port, $OwnerName) {
  $who = 'một chương trình khác'
  if (-not [string]::IsNullOrWhiteSpace($OwnerName)) { $who = $OwnerName }
  return "Cổng $Port đang bị $who dùng. Đóng chương trình đó, hoặc đổi cổng trong Cài đặt của Second Brain rồi mở lại."
}

# Takes <home>\.secondbrain\launcher.lock. Returns $true when we hold it, $false when another
# launcher (alive, lock younger than 15 min) is already installing/building/starting.
function Enter-LauncherLock {
  if (-not (Test-Path -LiteralPath $StateDir)) { $null = New-Item -ItemType Directory -Force -Path $StateDir }
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    try {
      $stream = [System.IO.File]::Open($LockFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
      try {
        $text = '{"pid":' + $PID + ',"startedAt":"' + (Get-Date).ToUniversalTime().ToString('o') + '"}'
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
        $stream.Write($bytes, 0, $bytes.Length)
      } finally {
        $stream.Dispose()
      }
      return $true
    } catch [System.IO.IOException] {
      $lock = Read-JsonFile $LockFile
      $ownerPid = Get-JsonProperty $lock 'pid'
      $item = Get-Item -Force -LiteralPath $LockFile -ErrorAction SilentlyContinue
      $fresh = ($null -ne $item) -and ($item.LastWriteTimeUtc -gt (Get-Date).ToUniversalTime().AddMinutes(-$LockMaxAgeMinutes))
      $alive = ($null -ne $ownerPid) -and (Test-ProcessAlive ([int]$ownerPid))
      if ($fresh -and $alive) { return $false }
      # Left behind by a launcher that crashed or was closed: take it over.
      Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
    }
  }
  throw 'Không tạo được launcher.lock.'
}

function Exit-LauncherLock {
  $lock = Read-JsonFile $LockFile
  if ((Get-JsonProperty $lock 'pid') -eq $PID) {
    Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
  }
}

function Wait-ForOtherLauncher {
  Write-Step 'Second Brain đang khởi động ở một cửa sổ khác, chờ chút nhé…'
  $port = Get-AppPort
  $deadline = (Get-Date).AddSeconds($OtherLauncherWaitSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-AppHealth $port) {
      Write-Step "Đã sẵn sàng: http://localhost:$port/"
      Open-App $port
      return
    }
    if (-not (Test-Path -LiteralPath $LockFile)) {
      $port = Get-AppPort
      if (Test-AppHealth $port) { continue }
      Stop-WithProblem 'Cửa sổ kia đã dừng mà app chưa chạy. Bấm đúp lại "Mở Second Brain" để thử lại.'
    }
    Start-Sleep -Seconds 2
  }
  Stop-WithProblem 'Chờ quá lâu mà app chưa chạy. Đóng các cửa sổ "Mở Second Brain" rồi thử lại.'
}

function Start-SecondBrain {
  $port = Get-AppPort
  if (Test-AppHealth $port) {
    # At sign-in the app may already run (started by hand): nothing to do, nothing to show.
    if ($LoginMode) { return }
    Write-Step 'Second Brain đang chạy, mở app…'
    Open-App $port
    return
  }
  if (-not (Enter-LauncherLock)) {
    # Another launcher is starting the server and reports its own problems.
    if ($LoginMode) { return }
    Wait-ForOtherLauncher
    return
  }
  try {
    # A launcher that held the lock until now may have just started the server.
    if (Test-AppHealth $port) {
      if (-not $LoginMode) { Open-App $port }
      return
    }
    Start-SecondBrainLocked
  } finally {
    Exit-LauncherLock
  }
}

# Install, build and start; runs while holding launcher.lock so two double-clicks never build twice.
function Start-SecondBrainLocked {
  $nodePath = Assert-Node
  if (Test-InstallNeeded) {
    Invoke-Npm @('install', '--no-fund', '--no-audit') 'Đang cài thư viện cho app (lần đầu mất vài phút)…'
  }
  if (Test-BuildNeeded) {
    Invoke-Npm @('run', 'build') 'Đang chuẩn bị bản mới của app…'
  }
  Write-Step 'Đang khởi động máy chủ…'
  # Relative entry path + working directory keeps spaces and Vietnamese letters out of the argument list.
  $startArgs = @{ FilePath = $nodePath; ArgumentList = @('server/dist/index.js'); WorkingDirectory = $AppDir; PassThru = $true }
  if ($OnWindows) { $startArgs['WindowStyle'] = 'Hidden' }
  $server = Start-Process @startArgs
  $null = $server.Handle # keeps the handle open so ExitCode stays readable after the process ends
  $port = Get-AppPort
  for ($i = 0; $i -lt 60; $i++) {
    if (Test-AppHealth $port) {
      Write-Step "Đã sẵn sàng: http://localhost:$port/"
      Write-LauncherLog "Server ready on port $port."
      Open-App $port
      return
    }
    if ($server.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  if ($server.HasExited -and $server.ExitCode -eq $ExitPortBusy) {
    # Always a dialog: the console window may close before anyone reads it.
    Stop-WithProblem (Get-PortBusyMessage $port (Get-PortOwnerName $port)) -Dialog
  }
  $hint = "Xem nhật ký: $LogFile"
  if ($server.HasExited) {
    Stop-WithProblem "Máy chủ dừng ngay khi khởi động (mã $($server.ExitCode))." $hint -WithLog
  }
  Stop-WithProblem "Máy chủ chưa trả lời sau 30 giây (cổng $port)." $hint -WithLog
}

function Get-SessionToken {
  $token = Get-JsonProperty (Read-JsonFile $SettingsFile) 'sessionToken'
  if ($token -is [string] -and $token.Length -gt 0) { return $token }
  return $null
}

function Wait-AppStopped([int]$Port, [int]$Seconds) {
  for ($i = 0; $i -lt ($Seconds * 2); $i++) {
    if (-not (Test-AppHealth $Port)) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# Asks the server to shut itself down (saves state, removes server.json). No Origin header is sent.
function Request-GracefulShutdown([int]$Port) {
  $token = Get-SessionToken
  if ($null -eq $token) { return $false }
  try {
    $null = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/shutdown" -Headers @{ 'X-SB-Token' = $token } -ContentType 'application/json' -Body '{}' -TimeoutSec 3 -UseBasicParsing
  } catch {
    return $false
  }
  return (Wait-AppStopped $Port 10)
}

function Get-ProcessCommandLine([int]$ProcessId) {
  try {
    if ($OnWindows) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
      if ($null -eq $proc) { return $null }
      return [string]$proc.CommandLine
    }
    $cmdline = "/proc/$ProcessId/cmdline"
    if (Test-Path -LiteralPath $cmdline) { return ((Get-Content -LiteralPath $cmdline -Raw) -replace "`0", ' ') }
  } catch { }
  return $null
}

# Our server is "node ... server\dist\index.js", or the single executable started as a server
# ("Second Brain.exe", "second-brain" on Linux: the exe process runs the server itself, F29.1);
# its --mcp-stdio bridge and --stop helper are not servers. Anything else with a reused PID is
# left alone.
function Test-IsOurServer([int]$ProcessId) {
  $commandLine = Get-ProcessCommandLine $ProcessId
  if ($null -eq $commandLine) { return $false }
  if ($commandLine -match 'server[\\/]dist[\\/]index\.js') { return $true }
  $isExe = $commandLine -match '^\s*"?([^"]*[\\/])?(Second Brain\.exe|second-brain)"?(\s|$)'
  return ($isExe -and ($commandLine -notmatch '\s--(mcp-stdio|stop)(\s|$)'))
}

function Stop-SecondBrain {
  $port = Get-AppPort
  $running = Test-AppHealth $port
  if ($running -and (Request-GracefulShutdown $port)) {
    Remove-Item -LiteralPath $ServerInfoFile -Force -ErrorAction SilentlyContinue
    Write-Step 'Đã tắt Second Brain.'
    return
  }

  $serverPid = Get-JsonProperty (Read-JsonFile $ServerInfoFile) 'pid'
  $process = $null
  if ($null -ne $serverPid) { $process = Get-Process -Id ([int]$serverPid) -ErrorAction SilentlyContinue }
  if ($null -eq $process) {
    Remove-Item -LiteralPath $ServerInfoFile -Force -ErrorAction SilentlyContinue
    if ($running) {
      Stop-WithProblem 'Second Brain đang chạy nhưng không tắt được qua app và không biết tiến trình nào. Khởi động lại máy để chắc chắn.'
    }
    Write-Step 'Second Brain không chạy.'
    return
  }
  if (-not (Test-IsOurServer $process.Id)) {
    Remove-Item -LiteralPath $ServerInfoFile -Force -ErrorAction SilentlyContinue
    if ($running) {
      Stop-WithProblem "Tiến trình $($process.Id) không phải máy chủ Second Brain nên mình không tắt nó."
    }
    Write-Step 'Second Brain không chạy (bỏ qua thông tin cũ, không đụng tới app khác).'
    return
  }
  # The server did not answer the shutdown request: stop that exact process.
  Stop-Process -Id $process.Id -Force
  try { $process.WaitForExit(5000) | Out-Null } catch { }
  Remove-Item -LiteralPath $ServerInfoFile -Force -ErrorAction SilentlyContinue
  Write-Step 'Đã tắt Second Brain (buộc dừng vì máy chủ không trả lời).'
}

try {
  switch ($Action.ToLowerInvariant()) {
    'start' { Start-SecondBrain }
    'login' { Start-SecondBrain }
    'stop' { Stop-SecondBrain }
    default {
      Write-Problem "Không hiểu lệnh '$Action'. Dùng: start, stop hoặc login."
      exit 1
    }
  }
  exit 0
} catch {
  Stop-WithProblem "Có lỗi: $($_.Exception.Message)" -WithLog
}
