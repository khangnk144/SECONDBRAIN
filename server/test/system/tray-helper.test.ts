import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { VaultPluginHost } from '../../src/app-context/vault-plugins.js';
import { createSilentLogger } from '../../src/logging/rotating-file-logger.js';
import {
  createTrayHelper,
  MAX_RESTARTS_PER_HOUR,
  type TrayHelper,
} from '../../src/system/tray-helper.js';
import { TRAY_STRINGS } from '../../src/system/tray-strings.js';
import { makeSettings, makeTempDir, removeDir, TEST_TOKEN } from '../helpers/test-environment.js';

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  stdinClosed = false;
  constructor(exitOnStdinEnd: boolean) {
    super();
    this.stdin.on('finish', () => {
      this.stdinClosed = true;
      if (exitOnStdinEnd) setImmediate(() => this.emit('exit', 0));
    });
  }
  kill() {
    this.killed = true;
    setImmediate(() => this.emit('exit', null));
    return true;
  }
  /** The helper reports whether Ctrl+Alt+Q is ours. */
  status(registered: boolean) {
    this.stdout.write(`{"hotkeyRegistered":${registered}}\r\n`);
  }
}

interface Spawned {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  child: FakeChild;
}

const helpers: TrayHelper[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(helpers.splice(0).map((helper) => helper.stop()));
  dirs.splice(0).forEach(removeDir);
});

function setup(
  options: { platform?: NodeJS.Platform; exitOnStdinEnd?: boolean; now?: () => number } = {},
) {
  const appDir = path.join(makeTempDir('sb tray Khay'), 'app');
  dirs.push(path.dirname(appDir));
  mkdirSync(path.join(appDir, 'web', 'dist', 'icons'), { recursive: true });
  writeFileSync(path.join(appDir, 'web', 'dist', 'icons', 'icon-192.png'), 'png');
  const settings = makeSettings();
  const spawned: Spawned[] = [];
  const helper = createTrayHelper({
    platform: options.platform ?? 'win32',
    env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows' },
    spawn: (command, args, env) => {
      const child = new FakeChild(options.exitOnStdinEnd ?? true);
      spawned.push({ command, args, env, child });
      return child;
    },
    now: options.now,
    restartDelayMs: 1,
    watchMs: 5,
    stopTimeoutMs: 50,
    parentPid: 4321,
  });
  helpers.push(helper);
  const host = { settings: () => settings, logger: createSilentLogger(), port: 4747 };
  const begin = async () => {
    await helper.plugin.start(host as unknown as VaultPluginHost);
    helper.start({ port: 4747, appDir });
  };
  return { appDir, settings, spawned, helper, begin };
}

describe('tray helper process (F29.2)', () => {
  it('(F29.2) starts Windows PowerShell -STA hidden; token, port, texts only in the environment', async () => {
    const { appDir, spawned, helper, begin } = setup();
    await begin();
    expect(spawned).toHaveLength(1);
    const [{ command, args, env }] = spawned as [Spawned];
    expect(command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(args).toEqual(expect.arrayContaining(['-NoProfile', '-STA', '-WindowStyle', 'Hidden']));
    expect(args.at(-1)).toBe(path.join(appDir, 'launcher', 'tray', 'second-brain-tray.ps1'));
    expect(args.join(' ')).not.toContain(TEST_TOKEN);
    expect(env.SB_TOKEN).toBe(TEST_TOKEN);
    expect(env.SB_PORT).toBe('4747');
    expect(env.SB_PARENT_PID).toBe('4321');
    expect(env.SB_ICON).toBe(path.join(appDir, 'web', 'dist', 'icons', 'icon-192.png'));
    expect(env.PATH).toBe('C:\\Windows');
    // Texts travel as escaped ASCII and decode to the UI language.
    expect(/^[\x20-\x7e]*$/.test(env.SB_TRAY_STRINGS ?? '')).toBe(true);
    expect(JSON.parse(env.SB_TRAY_STRINGS ?? '{}')).toEqual(TRAY_STRINGS.vi);
    expect(helper.status()).toEqual({
      state: 'running',
      hotkey: 'Ctrl+Alt+Q',
      hotkeyRegistered: null,
    });
  });

  it('(F29.3) reads the status line: whether Ctrl+Alt+Q is registered', async () => {
    const { spawned, helper, begin } = setup();
    await begin();
    spawned[0]?.child.status(false);
    await expect.poll(() => helper.status().hotkeyRegistered).toBe(false);
  });

  it('is never started off Windows or when the switch is off', async () => {
    const linux = setup({ platform: 'linux' });
    await linux.begin();
    expect(linux.spawned).toEqual([]);
    expect(linux.helper.status().state).toBe('unsupported');
    const off = setup();
    off.settings.system = { ...off.settings.system, tray: false } as typeof off.settings.system;
    await off.begin();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(off.spawned).toEqual([]);
    expect(off.helper.status().state).toBe('off');
  });

  it('(F29.2) restarts a helper that died at most 3 times per hour, then reports failed', async () => {
    let now = 1_000_000;
    const { spawned, helper, settings, begin } = setup({ now: () => now });
    await begin();
    for (let restart = 1; restart <= MAX_RESTARTS_PER_HOUR; restart += 1) {
      spawned.at(-1)?.child.emit('exit', 1);
      await expect.poll(() => spawned.length).toBe(restart + 1);
      now += 60_000;
    }
    spawned.at(-1)?.child.emit('exit', 1);
    await expect.poll(() => helper.status().state).toBe('failed');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(spawned).toHaveLength(MAX_RESTARTS_PER_HOUR + 1);
    // Turning the switch off and on again tries once more.
    settings.system = { ...settings.system, tray: false } as typeof settings.system;
    await expect.poll(() => helper.status().state).toBe('off');
    settings.system = { ...settings.system, tray: true } as typeof settings.system;
    await expect.poll(() => spawned.length).toBe(MAX_RESTARTS_PER_HOUR + 2);
    expect(helper.status().state).toBe('running');
  });

  it('(F29.2) turning the switch off closes the helper stdin (it removes its icon), no restart', async () => {
    const { spawned, helper, settings, begin } = setup();
    await begin();
    settings.system = { ...settings.system, tray: false } as typeof settings.system;
    await expect.poll(() => spawned[0]?.child.stdinClosed).toBe(true);
    await expect.poll(() => helper.status().state).toBe('off');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.child.killed).toBe(false);
  });

  it('(F29.2) a language change restarts the helper with the new texts', async () => {
    const { spawned, settings, begin } = setup();
    await begin();
    settings.ui.language = 'en';
    await expect.poll(() => spawned.length).toBe(2);
    expect(spawned[0]?.child.stdinClosed).toBe(true);
    expect(JSON.parse(spawned[1]?.env.SB_TRAY_STRINGS ?? '{}')).toEqual(TRAY_STRINGS.en);
  });

  it('(F29.2) stops with the server: stdin closed, killed when it does not leave in time', async () => {
    const { spawned, helper, begin } = setup({ exitOnStdinEnd: false });
    await begin();
    await helper.stop();
    expect(spawned[0]?.child.stdinClosed).toBe(true);
    expect(spawned[0]?.child.killed).toBe(true);
    expect(helper.status().state).toBe('off');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(spawned).toHaveLength(1);
  });
});
