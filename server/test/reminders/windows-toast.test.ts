import { describe, expect, it } from 'vitest';
import type { NotifierToaster } from '../../src/reminders/notifier-toast.js';
import { reminderToast, type ToastContent } from '../../src/reminders/reminder-messages.js';
import { POWERSHELL_APP_ID } from '../../src/reminders/toast-script.js';
import {
  createWindowsToastDeliverer,
  openUrlCommand,
  runHiddenProcess,
  type ProcessResult,
} from '../../src/reminders/windows-toast.js';
import { createMemoryLogger } from '../api/vault-test-app.js';

const TOAST: ToastContent = reminderToast(
  {
    title: 'Đồ án Giải tích',
    path: '1 Projects/Đồ án Giải tích.md',
    due: '2026-10-24',
    threshold: 3,
    overdue: false,
  },
  'vi',
  4747,
);
interface Fakes {
  runs: { command: string; args: readonly string[]; timeoutMs: number }[];
  loads: number;
  opened: string[];
  notifications: { title: string; message: string; appID: string }[];
}

function fakeDeliverer(
  platform: NodeJS.Platform,
  result: ProcessResult,
  notifier: 'ok' | 'error' | 'click' | 'missing' | 'silent' = 'ok',
) {
  const fakes: Fakes = { runs: [], loads: 0, opened: [], notifications: [] };
  const logger = createMemoryLogger();
  const toaster: NotifierToaster = {
    notify(notification, callback) {
      fakes.notifications.push(notification);
      if (notifier === 'error') callback(new Error('SnoreToast failed'));
      if (notifier === 'ok') callback(null, 'timeout', {});
      if (notifier === 'click') {
        callback(null, 'activate', { activationType: 'clicked' });
        callback(null, 'activate', { activationType: 'clicked' });
      }
      return undefined;
    },
  };
  const deliverer = createWindowsToastDeliverer({
    logger,
    platform,
    timeoutMs: 50,
    run: async (command, args, timeoutMs) => {
      fakes.runs.push({ command, args, timeoutMs });
      return result;
    },
    loadToaster: async () => {
      fakes.loads += 1;
      if (notifier === 'missing')
        throw Object.assign(new Error('nope'), { code: 'ERR_MODULE_NOT_FOUND' });
      return toaster;
    },
    openUrl: (url) => fakes.opened.push(url),
  });
  return { deliverer, fakes, logger };
}

const OK = { exitCode: 0, timedOut: false };
const EXIT_1 = { exitCode: 1, timedOut: false };

describe('toast delivery: PowerShell, then node-notifier, then failed', () => {
  it('off Windows: unsupported, no process started, no notifier loaded', async () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const { deliverer, fakes } = fakeDeliverer(platform, OK);
      expect(deliverer.supported).toBe(false);
      expect(await deliverer.deliver(TOAST)).toBe('unsupported');
      expect([fakes.runs.length, fakes.loads]).toEqual([0, 0]);
    }
  });

  it('PowerShell exit 0: shown, with a 15 s-style timeout passed and no fallback', async () => {
    const { deliverer, fakes } = fakeDeliverer('win32', OK);
    expect(deliverer.supported).toBe(true);
    expect(await deliverer.deliver(TOAST)).toBe('shown');
    expect(fakes.runs).toHaveLength(1);
    expect(fakes.runs[0]?.command.endsWith('powershell.exe')).toBe(true);
    expect(fakes.loads).toBe(0);
  });

  it.each([
    ['a non-zero exit', EXIT_1],
    ['a timeout', { exitCode: null, timedOut: true }],
    ['a spawn error', { exitCode: null, timedOut: false, errorCode: 'ENOENT' }],
  ])('%s falls back to node-notifier with the PowerShell AppUserModelID', async (_name, result) => {
    const { deliverer, fakes, logger } = fakeDeliverer('win32', result);
    expect(await deliverer.deliver(TOAST)).toBe('shown');
    expect(fakes.loads).toBe(1);
    expect(fakes.notifications).toEqual([
      { title: TOAST.title, message: TOAST.body, appID: POWERSHELL_APP_ID, wait: true },
    ]);
    expect(logger.lines.join('\n')).not.toContain('Giải');
  });

  it('both failing → failed; a missing notifier module → failed; logs carry codes only', async () => {
    const failing = fakeDeliverer('win32', EXIT_1, 'error');
    expect(await failing.deliverer.deliver(TOAST)).toBe('failed');
    const missing = fakeDeliverer('win32', EXIT_1, 'missing');
    expect(await missing.deliverer.deliver(TOAST)).toBe('failed');
    const lines = [...failing.logger.lines, ...missing.logger.lines].join('\n');
    expect(lines).toContain('exit 1');
    expect(lines).toContain('ERR_MODULE_NOT_FOUND');
    expect(lines).not.toMatch(/Giải|Còn 3 ngày|localhost/);
  });

  it('a notifier that stays open counts as shown; a click opens the deep link once', async () => {
    const silent = fakeDeliverer('win32', EXIT_1, 'silent');
    expect(await silent.deliverer.deliver(TOAST)).toBe('shown');
    const click = fakeDeliverer('win32', EXIT_1, 'click');
    expect(await click.deliverer.deliver(TOAST)).toBe('shown');
    expect(click.fakes.opened).toEqual([TOAST.link]);
  });

  it('opens links like reveal opens Explorer: argument arrays, never a shell', () => {
    expect(openUrlCommand('win32', TOAST.link)).toEqual({
      command: 'explorer.exe',
      args: [`"${TOAST.link}"`],
      windowsVerbatimArguments: true,
    });
    expect(openUrlCommand('darwin', TOAST.link)).toEqual({ command: 'open', args: [TOAST.link] });
    expect(openUrlCommand('linux', TOAST.link)).toEqual({
      command: 'xdg-open',
      args: [TOAST.link],
    });
  });
});

describe('the hidden process runner', () => {
  it('reports the exit code, a spawn error, and kills a process at its timeout', async () => {
    const node = process.execPath;
    expect(await runHiddenProcess(node, ['-e', 'process.exit(3)'], 10_000)).toEqual({
      exitCode: 3,
      timedOut: false,
    });
    const missing = await runHiddenProcess('/no/such/powershell.exe', [], 10_000);
    expect(missing).toMatchObject({ exitCode: null, errorCode: 'ENOENT' });
    const invalid = await runHiddenProcess(node, ['a\u0000b'], 10_000);
    expect(invalid).toMatchObject({ exitCode: null, errorCode: 'ERR_INVALID_ARG_VALUE' });
    const started = Date.now();
    const slow = await runHiddenProcess(node, ['-e', 'setTimeout(() => {}, 20000)'], 300);
    expect(slow).toEqual({ exitCode: null, timedOut: true });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
