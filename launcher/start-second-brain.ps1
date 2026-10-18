<#
  Second Brain launcher (Windows PowerShell 5.1+).

  start-second-brain.ps1          Start the app (or just open it if it is already running).
  start-second-brain.ps1 stop     Stop the background server (graceful, then only our own node process).

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
$MinNodeVersion = [Version]'22.12.0'
$DefaultPort = 4747
$LockMaxAgeMinutes = 15
$OtherLauncherWaitSeconds = 600
# Forward slashes work on Windows too; the platform check lets the script be smoke-tested elsewhere.
$OnWindows = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
$NpmCommand = if ($OnWindows) { 'npm.cmd' } else { 'npm' }

function Write-Step([string]$Message) { Write-Host "  $Message" }
function Write-Problem([string]$Message) { Write-Host ''; Write-Host "  $Message" -ForegroundColor Yellow }

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

function Open-App([int]$Port) {
  Start-Process "http://localhost:$Port/"
}

function Assert-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $node) {
    Write-Problem 'Chưa tìm thấy Node.js trên máy.'
    Write-Step 'Cài Node.js 24 LTS tại https://nodejs.org rồi bấm đúp lại "Mở Second Brain".'
    exit 1
  }
  $raw = (& node -v).Trim().TrimStart('v')
  $clean = ($raw -split '-')[0]
  $version = $null
  if (-not [Version]::TryParse($clean, [ref]$version) -or $version -lt $MinNodeVersion) {
    Write-Problem "Node.js $raw đã cũ, app cần bản $MinNodeVersion trở lên."
    Write-Step 'Cài Node.js 24 LTS tại https://nodejs.org rồi bấm đúp lại "Mở Second Brain".'
    exit 1
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
  foreach ($dir in @('server/src', 'web/src')) {
    $full = Join-Path $AppDir $dir
    if (Test-Path -LiteralPath $full) { $sources += Get-ChildItem -Force -LiteralPath $full -Recurse -File }
  }
  foreach ($file in @('web/index.html', 'web/vite.config.ts', 'package-lock.json')) {
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
      Write-Problem 'Cửa sổ kia đã dừng mà app chưa chạy. Bấm đúp lại "Mở Second Brain" để thử lại.'
      exit 1
    }
    Start-Sleep -Seconds 2
  }
  Write-Problem 'Chờ quá lâu mà app chưa chạy. Đóng các cửa sổ "Mở Second Brain" rồi thử lại.'
  exit 1
}

function Start-SecondBrain {
  $port = Get-AppPort
  if (Test-AppHealth $port) {
    Write-Step 'Second Brain đang chạy, mở app…'
    Open-App $port
    return
  }
  if (-not (Enter-LauncherLock)) {
    Wait-ForOtherLauncher
    return
  }
  try {
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
      Open-App $port
      return
    }
    if ($server.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  if ($server.HasExited) {
    Write-Problem "Máy chủ dừng ngay khi khởi động (mã $($server.ExitCode))."
  } else {
    Write-Problem "Máy chủ chưa trả lời sau 30 giây (cổng $port)."
  }
  Write-Step "Nếu cổng $port đang bị app khác dùng: đóng app đó hoặc đổi cổng trong Cài đặt, rồi thử lại."
  Show-LogTail
  exit 1
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

# Our server is "node ... server\dist\index.js"; anything else with a reused PID is left alone.
function Test-IsOurServer([int]$ProcessId) {
  $commandLine = Get-ProcessCommandLine $ProcessId
  if ($null -eq $commandLine) { return $false }
  return ($commandLine -match 'server[\\/]dist[\\/]index\.js')
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
      Write-Problem 'Second Brain đang chạy nhưng không tắt được qua app và không biết tiến trình nào. Khởi động lại máy để chắc chắn.'
      exit 1
    }
    Write-Step 'Second Brain không chạy.'
    return
  }
  if (-not (Test-IsOurServer $process.Id)) {
    Remove-Item -LiteralPath $ServerInfoFile -Force -ErrorAction SilentlyContinue
    if ($running) {
      Write-Problem "Tiến trình $($process.Id) không phải máy chủ Second Brain nên mình không tắt nó."
      exit 1
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
    'stop' { Stop-SecondBrain }
    default {
      Write-Problem "Không hiểu lệnh '$Action'. Dùng: start hoặc stop."
      exit 1
    }
  }
  exit 0
} catch {
  Write-Problem "Có lỗi: $($_.Exception.Message)"
  Show-LogTail
  exit 1
}
