/**
 * The Windows toast as data: a `ToastGeneric` XML document with protocol activation (a click
 * opens the deep link in the default browser, no process has to stay alive) and the Windows
 * PowerShell 5.1 script that shows it through WinRT. User text never reaches the script as code:
 * every text is XML-escaped and the whole XML travels base64-encoded inside a string literal.
 */
import path from 'node:path';
import type { ToastContent } from './reminder-messages.js';

/**
 * The app has no AppUserModelID of its own (no installer, no Start-menu shortcut), so toasts
 * are sent under Windows PowerShell's, which every Windows 10/11 install registers.
 */
export const POWERSHELL_APP_ID =
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';

// Characters XML 1.0 cannot hold at all (LoadXml would reject the whole toast), lone surrogates.
const XML_INVALID =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function xmlEscape(text: string): string {
  return text
    .replace(XML_INVALID, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildToastXml(toast: ToastContent): string {
  return (
    `<toast activationType="protocol" launch="${xmlEscape(toast.link)}">` +
    '<visual><binding template="ToastGeneric">' +
    `<text>${xmlEscape(toast.title.normalize('NFC'))}</text>` +
    `<text>${xmlEscape(toast.body.normalize('NFC'))}</text>` +
    '</binding></visual>' +
    '</toast>'
  );
}

/** PowerShell script that loads the XML and shows it; exit 0 only when `Show` succeeded. */
export function buildToastScript(xml: string, appId: string = POWERSHELL_APP_ID): string {
  if (appId.includes("'")) throw new Error('The AppUserModelID cannot contain a quote.');
  const payload = Buffer.from(xml, 'utf8').toString('base64');
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]',
    '  $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]',
    `  $text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}'))`,
    '  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '  $doc.LoadXml($text)',
    '  $toast = [Windows.UI.Notifications.ToastNotification]::new($doc)',
    `  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${appId}').Show($toast)`,
    '  exit 0',
    '} catch {',
    '  exit 1',
    '}',
  ].join('\r\n');
}

/** `-EncodedCommand` takes the script as base64 of its UTF-16LE bytes (no quoting issues). */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/** Windows PowerShell 5.1 by absolute path, so a `powershell.exe` earlier on PATH is never used. */
export function windowsPowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = env.SystemRoot ?? env.windir ?? 'C:\\Windows';
  return path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function powerShellToastInvocation(
  toast: ToastContent,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  const encoded = encodePowerShellCommand(buildToastScript(buildToastXml(toast)));
  return {
    command: windowsPowerShellPath(env),
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encoded,
    ],
  };
}
