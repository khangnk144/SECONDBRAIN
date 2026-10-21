import { describe, expect, it } from 'vitest';
import { reminderToast, type ToastContent } from '../../src/reminders/reminder-messages.js';
import {
  buildToastScript,
  buildToastXml,
  encodePowerShellCommand,
  POWERSHELL_APP_ID,
  powerShellToastInvocation,
  xmlEscape,
} from '../../src/reminders/toast-script.js';

const PATH = '1 Projects/Đồ án Giải tích.md';
const TOAST: ToastContent = reminderToast(
  {
    title: 'Đồ án <Giải> & "tích" \'2\'',
    path: PATH,
    due: '2026-10-24',
    threshold: 3,
    overdue: false,
  },
  'vi',
  4747,
);

/** The XML a script carries, decoded from its base64 literal. */
function xmlOf(script: string): string {
  const b64 = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(script)?.[1] ?? '';
  return Buffer.from(b64, 'base64').toString('utf8');
}

describe('toast XML and PowerShell command', () => {
  it('escapes every XML special character and drops characters XML cannot hold', () => {
    expect(xmlEscape(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;');
    expect(xmlEscape('a\u0000b\u001Fc\uD800d')).toBe('abcd');
    const xml = buildToastXml(TOAST);
    expect(xml).toContain(
      '<text>Còn 3 ngày: Đồ án &lt;Giải&gt; &amp; &quot;tích&quot; &apos;2&apos;</text>',
    );
    expect(xml).toMatch(/^<toast activationType="protocol" launch="[^"<>]+">/);
    expect(xml).toContain('<binding template="ToastGeneric">');
  });

  it('protocol launch is the note deep link with the path percent-encoded', () => {
    expect(buildToastXml(TOAST)).toContain(
      'launch="http://localhost:4747/#/note?path=1%20Projects%2F%C4%90%E1%BB%93%20%C3%A1n%20Gi%E1%BA%A3i%20t%C3%ADch.md"',
    );
  });

  it('writes Vietnamese titles as NFC whether the note text was NFC or NFD', () => {
    const nfd = { ...TOAST, title: 'Còn 1 ngày: Đồ án Giải tích'.normalize('NFD') };
    const xml = buildToastXml(nfd);
    expect(xml).toContain('<text>Còn 1 ngày: Đồ án Giải tích</text>');
    expect(xml).toBe(xml.normalize('NFC'));
  });

  it('the encoded command decodes back to the script, which carries the XML untouched', () => {
    const xml = buildToastXml(TOAST);
    const script = buildToastScript(xml);
    expect(xmlOf(script)).toBe(xml);
    // No user text reaches the script as code: only the base64 literal varies.
    expect(script).not.toContain('Giải');
    expect(script).toContain(`CreateToastNotifier('${POWERSHELL_APP_ID}')`);
    const encoded = encodePowerShellCommand(script);
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(script);

    const { command, args } = powerShellToastInvocation(TOAST, { SystemRoot: 'C:\\Windows' });
    expect(command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(args.slice(0, 5)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
    ]);
    expect(Buffer.from(args[5]!, 'base64').toString('utf16le')).toBe(script);
  });

  it('uses Windows PowerShell’s AppUserModelID', () => {
    expect(POWERSHELL_APP_ID).toBe(
      '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
  });
});
