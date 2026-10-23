<#
  Second Brain tray helper (Windows PowerShell 5.1, started with -STA by the server:
  server/src/system/tray-helper.ts). Shows the tray icon with Open / Quick capture / Quit,
  owns the global hotkey Ctrl+Alt+Q and its small capture box. One helper per server.

  Input comes from the environment only (never the command line):
    SB_TOKEN          session token for X-SB-Token (removed from the environment at once)
    SB_PORT           server port; requests go to http://127.0.0.1:<port> with the canonical
                      Origin http://localhost:<port>
    SB_PARENT_PID     the server process; the helper exits when it is gone
    SB_TRAY_STRINGS   JSON of the texts in the UI language (escaped ASCII)
    SB_ICON           icon image (.png or .ico), optional
  stdout: one status line {"hotkeyRegistered":true|false}, read by the server.
  The helper exits when its stdin closes (the server asks, or the server process ended), when
  the parent process is gone (checked every 5 s), or after "Quit".
  This file is ASCII only: every text shown comes from SB_TRAY_STRINGS.
#>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$Token = [string]$env:SB_TOKEN
$Port = [int]$env:SB_PORT
$ParentPid = [int]$env:SB_PARENT_PID
$Strings = ([string]$env:SB_TRAY_STRINGS) | ConvertFrom-Json
$IconPath = [string]$env:SB_ICON
# Programs started from here (the browser) must not inherit the token.
Remove-Item Env:SB_TOKEN -ErrorAction SilentlyContinue
$ApiBase = "http://127.0.0.1:$Port"
$Origin = "http://localhost:$Port"
$AppUrl = "http://localhost:$Port/"
$MaxCaptureChars = 20000

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// A hidden window that owns the global hotkey and raises Pressed on WM_HOTKEY.
public class SecondBrainHotkeyWindow : NativeWindow, IDisposable {
  [DllImport("user32.dll", SetLastError = true)]
  static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll", SetLastError = true)]
  static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  const int WM_HOTKEY = 0x0312;
  const int HotkeyId = 0x5342;
  public event EventHandler Pressed;
  public bool Registered { get; private set; }
  public SecondBrainHotkeyWindow() { CreateHandle(new CreateParams()); }
  public bool Register(uint modifiers, uint key) {
    Registered = RegisterHotKey(Handle, HotkeyId, modifiers, key);
    return Registered;
  }
  protected override void WndProc(ref Message m) {
    if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HotkeyId && Pressed != null) {
      Pressed(this, EventArgs.Empty);
    }
    base.WndProc(ref m);
  }
  public void Dispose() {
    if (Registered) { UnregisterHotKey(Handle, HotkeyId); Registered = false; }
    DestroyHandle();
  }
}
'@

$ModControl = 0x2
$ModAlt = 0x1
$ModNoRepeat = 0x4000
$KeyQ = 0x51

# Colors close to the app's dark tokens (--paper, --bg, --ink, --ink-2, --accent, --on-accent,
# --urgent-text, --line); this window is outside the web app, so the values are repeated here.
function New-Color([int]$R, [int]$G, [int]$B) { return [System.Drawing.Color]::FromArgb($R, $G, $B) }
$ColorPaper = New-Color 0x24 0x1d 0x2b
$ColorBg = New-Color 0x1c 0x16 0x22
$ColorInk = New-Color 0xf1 0xe9 0xf2
$ColorInk2 = New-Color 0xa5 0x95 0xac
$ColorAccent = New-Color 0xd8 0x8a 0xb6
$ColorOnAccent = New-Color 0x2a 0x1a 0x24
$ColorError = New-Color 0xff 0x9d 0xb0
$ColorLine = New-Color 0x35 0x2c 0x3c

function Get-AppIcon {
  try {
    if ($IconPath -and (Test-Path -LiteralPath $IconPath)) {
      if ($IconPath.ToLowerInvariant().EndsWith('.ico')) { return New-Object System.Drawing.Icon($IconPath) }
      $image = New-Object System.Drawing.Bitmap($IconPath)
      $small = New-Object System.Drawing.Bitmap($image, 32, 32)
      $image.Dispose()
      return [System.Drawing.Icon]::FromHandle($small.GetHicon())
    }
  } catch { }
  return [System.Drawing.SystemIcons]::Application
}

# POSTs to the server with the token and the canonical Origin. Returns the HTTP status, or 0
# when the server did not answer.
function Invoke-SecondBrainPost([string]$Path, [string]$Json) {
  $body = [System.Text.Encoding]::UTF8.GetBytes($Json)
  $request = [System.Net.HttpWebRequest]::Create("$ApiBase$Path")
  $request.Method = 'POST'
  $request.ContentType = 'application/json; charset=utf-8'
  $request.Headers.Add('X-SB-Token', $Token)
  $request.Headers.Add('Origin', $Origin)
  $request.Proxy = $null
  $request.Timeout = 10000
  $request.ContentLength = $body.Length
  try {
    $stream = $request.GetRequestStream()
    try { $stream.Write($body, 0, $body.Length) } finally { $stream.Dispose() }
    $response = $request.GetResponse()
    $status = [int]$response.StatusCode
    $response.Close()
    return $status
  } catch [System.Net.WebException] {
    $failed = $_.Exception.Response
    if ($null -ne $failed) {
      $status = [int]$failed.StatusCode
      $failed.Close()
      return $status
    }
    return 0
  } catch {
    return 0
  }
}

# Its own window, like the .exe and the launcher: the installed app (PWA) of this port, else
# Edge or Chrome in app mode (no tabs, no address bar), else the default browser.
function Open-SecondBrain {
  try {
    $programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $shell = New-Object -ComObject WScript.Shell
    foreach ($name in @('Second Brain.lnk', 'Chrome Apps\Second Brain.lnk', 'Edge Apps\Second Brain.lnk')) {
      $link = Join-Path $programs $name
      if (-not (Test-Path -LiteralPath $link)) { continue }
      $arguments = [string]$shell.CreateShortcut($link).Arguments
      if ($arguments -notmatch '--app-id=') { continue }
      if ($arguments -match '--app-url=("?)(http://[^"\s]+)') {
        if (-not $Matches[2].StartsWith($AppUrl)) { continue }
      } elseif ($Port -ne 4747) { continue }
      Start-Process -FilePath $link
      return
    }
    $browsers = @(
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
      "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
      "${env:LOCALAPPDATA}\Microsoft\Edge\Application\msedge.exe",
      "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "${env:LOCALAPPDATA}\Google\Chrome\Application\chrome.exe"
    )
    foreach ($browser in $browsers) {
      if (Test-Path -LiteralPath $browser) {
        Start-Process -FilePath $browser -ArgumentList ('--app=' + $AppUrl)
        return
      }
    }
    Start-Process $AppUrl
  } catch {
    try { Start-Process $AppUrl } catch { }
  }
}

# The capture box is one window at a time; its controls live in script variables because the
# event handlers run later, from the message loop, in this script's scope.
$script:CaptureForm = $null
$script:CaptureText = $null
$script:CaptureStatus = $null
$script:CaptureSave = $null

function Show-CaptureError([string]$Message) {
  $script:CaptureStatus.ForeColor = $ColorError
  $script:CaptureStatus.Text = $Message
  $script:CaptureStatus.AccessibleName = $Message
}

function Save-Capture {
  $text = $script:CaptureText.Text
  if ([string]::IsNullOrWhiteSpace($text)) {
    Show-CaptureError $Strings.empty
    return
  }
  $script:CaptureSave.Enabled = $false
  try {
    $json = @{ text = $text } | ConvertTo-Json -Compress
    $code = Invoke-SecondBrainPost '/api/capture' $json
  } finally {
    $script:CaptureSave.Enabled = $true
  }
  if ($code -eq 201) {
    $script:Notify.ShowBalloonTip(3000, $Strings.tooltip, $Strings.saved, [System.Windows.Forms.ToolTipIcon]::Info)
    $script:CaptureForm.Close()
    return
  }
  # Failure: the text stays in the box and the reason is shown under it.
  if ($code -eq 0) {
    Show-CaptureError $Strings.offline
  } elseif ($code -eq 400 -and $text.Length -gt $MaxCaptureChars) {
    Show-CaptureError $Strings.tooLong
  } else {
    Show-CaptureError ([string]$Strings.refused).Replace('{code}', [string]$code)
  }
  $null = $script:CaptureText.Focus()
}

function Invoke-SaveCapture {
  try { Save-Capture } catch { Show-CaptureError ([string]$Strings.refused).Replace('{code}', 'ps') }
}

function Show-CaptureBox {
  if ($null -ne $script:CaptureForm -and -not $script:CaptureForm.IsDisposed) {
    $script:CaptureForm.Activate()
    return
  }
  $form = New-Object System.Windows.Forms.Form
  $form.Text = $Strings.captureTitle
  $form.Icon = $script:AppIcon
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
  $form.TopMost = $true
  $form.ClientSize = New-Object System.Drawing.Size(520, 236)
  $form.BackColor = $ColorPaper
  $form.ForeColor = $ColorInk
  $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

  $hint = New-Object System.Windows.Forms.Label
  $hint.Text = $Strings.captureHint
  $hint.ForeColor = $ColorInk2
  $hint.AutoSize = $false
  $hint.SetBounds(16, 12, 488, 22)

  $textBox = New-Object System.Windows.Forms.TextBox
  $textBox.Multiline = $true
  $textBox.AcceptsReturn = $true
  $textBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
  $textBox.BackColor = $ColorBg
  $textBox.ForeColor = $ColorInk
  $textBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
  $textBox.AccessibleName = $Strings.captureTitle
  $textBox.AccessibleDescription = $Strings.captureHint
  $textBox.SetBounds(16, 38, 488, 110)

  $status = New-Object System.Windows.Forms.Label
  $status.ForeColor = $ColorInk2
  $status.AutoSize = $false
  $status.SetBounds(16, 152, 488, 36)

  $saveButton = New-Object System.Windows.Forms.Button
  $saveButton.Text = $Strings.save
  $saveButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $saveButton.FlatAppearance.BorderColor = $ColorAccent
  $saveButton.BackColor = $ColorAccent
  $saveButton.ForeColor = $ColorOnAccent
  $saveButton.SetBounds(296, 194, 120, 30)

  $closeButton = New-Object System.Windows.Forms.Button
  $closeButton.Text = $Strings.close
  $closeButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $closeButton.FlatAppearance.BorderColor = $ColorLine
  $closeButton.ForeColor = $ColorInk
  $closeButton.SetBounds(424, 194, 80, 30)
  # Esc presses the cancel button, which closes the box (the text is not saved).
  $form.CancelButton = $closeButton

  $saveButton.add_Click({ Invoke-SaveCapture })
  $closeButton.add_Click({ $script:CaptureForm.Close() })
  # Enter saves, Shift+Enter adds a line.
  $textBox.add_KeyDown({
    param($control, $keyArgs)
    if ($keyArgs.KeyCode -eq [System.Windows.Forms.Keys]::Enter -and -not $keyArgs.Shift) {
      $keyArgs.SuppressKeyPress = $true
      Invoke-SaveCapture
    }
  })
  $form.add_Shown({ $script:CaptureForm.Activate(); $null = $script:CaptureText.Focus() })
  $form.add_FormClosed({ $script:CaptureForm = $null })

  $form.Controls.AddRange(@($hint, $textBox, $status, $saveButton, $closeButton))
  $script:CaptureForm = $form
  $script:CaptureText = $textBox
  $script:CaptureStatus = $status
  $script:CaptureSave = $saveButton
  $form.Show()
  $form.Activate()
}

function Request-Quit {
  $answer = [System.Windows.Forms.MessageBox]::Show($Strings.quitConfirm, $Strings.tooltip,
    [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
  $code = Invoke-SecondBrainPost '/api/shutdown' '{}'
  if ($code -eq 202) {
    Stop-Helper
    return
  }
  $null = [System.Windows.Forms.MessageBox]::Show($Strings.quitFailed, $Strings.tooltip,
    [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
}

$script:Stopped = $false
function Stop-Helper {
  if ($script:Stopped) { return }
  $script:Stopped = $true
  try { $script:Timer.Stop() } catch { }
  try { $script:Hotkey.Dispose() } catch { }
  try { $script:Notify.Visible = $false; $script:Notify.Dispose() } catch { }
  [System.Windows.Forms.Application]::Exit()
}

function Test-ParentAlive {
  return ($null -ne (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue))
}

# One helper per server port: a helper of a server that just ended may still be closing.
$mutex = New-Object System.Threading.Mutex($false, "Local\SecondBrainTray-$Port")
$owned = $false
try { $owned = $mutex.WaitOne(8000) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) {
  [Console]::Out.WriteLine('{"hotkeyRegistered":false,"duplicate":true}')
  [Console]::Out.Flush()
  exit 3
}

[System.Windows.Forms.Application]::EnableVisualStyles()
$script:AppIcon = Get-AppIcon

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add($Strings.open)
$captureItem = $menu.Items.Add($Strings.capture)
$null = $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$quitItem = $menu.Items.Add($Strings.quit)
$openItem.add_Click({ Open-SecondBrain })
$captureItem.add_Click({ try { Show-CaptureBox } catch { } })
$quitItem.add_Click({ try { Request-Quit } catch { } })

$script:Notify = New-Object System.Windows.Forms.NotifyIcon
$script:Notify.Icon = $script:AppIcon
$script:Notify.Text = $Strings.tooltip
$script:Notify.ContextMenuStrip = $menu
$script:Notify.add_MouseClick({
  param($control, $mouseArgs)
  if ($mouseArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Open-SecondBrain }
})
$script:Notify.Visible = $true

$script:Hotkey = New-Object SecondBrainHotkeyWindow
$registered = $false
try { $registered = $script:Hotkey.Register($ModControl -bor $ModAlt -bor $ModNoRepeat, $KeyQ) } catch { $registered = $false }
$script:Hotkey.add_Pressed({ try { Show-CaptureBox } catch { } })
$statusLine = '{"hotkeyRegistered":' + $(if ($registered) { 'true' } else { 'false' }) + '}'
[Console]::Out.WriteLine($statusLine)
[Console]::Out.Flush()

# Stdin reaches its end when the server closes it or its process ends: then the helper leaves.
$script:Stdin = [Console]::OpenStandardInput()
$script:StdinBuffer = New-Object byte[] 64
$script:StdinRead = $script:Stdin.ReadAsync($script:StdinBuffer, 0, 64)
$script:Ticks = 0
$script:Timer = New-Object System.Windows.Forms.Timer
$script:Timer.Interval = 1000
$script:Timer.add_Tick({
  try {
    $script:Ticks++
    if ($script:StdinRead.IsCompleted) {
      if ($script:StdinRead.IsFaulted -or $script:StdinRead.Result -le 0) { Stop-Helper; return }
      $script:StdinRead = $script:Stdin.ReadAsync($script:StdinBuffer, 0, 64)
    }
    if (($script:Ticks % 5) -eq 0 -and -not (Test-ParentAlive)) { Stop-Helper }
  } catch {
    Stop-Helper
  }
})
$script:Timer.Start()

try {
  [System.Windows.Forms.Application]::Run()
} finally {
  Stop-Helper
  try { $mutex.ReleaseMutex() } catch { }
  $mutex.Dispose()
}
exit 0
