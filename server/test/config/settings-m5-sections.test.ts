import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UI_SETTINGS,
  normalizeSettings,
  storedSecretValues,
} from '../../src/config/global-settings.js';
import { defaultBackupFolder, isSafeRemoteUrl } from '../../src/config/settings-sections-m5.js';

const TOKEN = 'ghp_GITHUBSECRET000000000000000000000000';
const BOT = '7012345678:AAH-TELEGRAMSECRET1111111111111111111';
const PASSWORD = 'abcd efgh ijkl mnop';

describe('ui.style (F35.1)', () => {
  it('(F35.1) defaults to bento when missing or invalid, keeps calm', () => {
    expect(DEFAULT_UI_SETTINGS.style).toBe('bento');
    expect(normalizeSettings({}).ui.style).toBe('bento');
    expect(normalizeSettings({ ui: { style: 'neon' } }).ui.style).toBe('bento');
    expect(normalizeSettings({ ui: { style: 42 } }).ui.style).toBe('bento');
    expect(normalizeSettings({ ui: { style: 'calm', theme: 'light' } }).ui).toMatchObject({
      style: 'calm',
      theme: 'light',
    });
  });
});

describe('M5 settings sections: defaults', () => {
  it('fills system.tray, backup and notify for a file written before M5', () => {
    const settings = normalizeSettings({});
    expect(settings.system).toEqual({ runAtLogin: false, tray: true });
    expect(settings.backup).toEqual({
      schedule: { enabled: false, folder: null, time: '21:00', keep: 14 },
      github: { enabled: false, remoteUrl: null, branch: 'main' },
    });
    expect(settings.notify).toEqual({
      telegram: { enabled: false, chatId: null },
      email: {
        enabled: false,
        host: null,
        port: 587,
        security: 'starttls',
        user: null,
        from: null,
        to: null,
      },
    });
    expect(storedSecretValues(settings)).toEqual([]);
  });

  it('the default backup folder is <home>/Backups (spaces and Vietnamese letters kept)', () => {
    const home = path.join('D:', 'Học kỳ 1', 'SECONDBRAIN');
    expect(defaultBackupFolder(home)).toBe(path.join(home, 'Backups'));
  });
});

describe('M5 settings sections: stored values', () => {
  const folder = path.resolve('Sao lưu', 'Đồ án');
  const raw = {
    system: { runAtLogin: true, tray: false, future: 1 },
    backup: {
      future: 'x',
      schedule: { enabled: true, folder, time: '06:30', keep: 30, extra: [1] },
      github: {
        enabled: true,
        remoteUrl: 'https://github.com/khangnie/second-brain-backup.git',
        branch: 'backup/main',
        token: TOKEN,
      },
    },
    notify: {
      telegram: { enabled: true, chatId: '-1001234567', botToken: BOT, lang: 'vi' },
      email: {
        enabled: true,
        host: 'smtp.gmail.com',
        port: 465,
        security: 'tls',
        user: 'khangnie@gmail.com',
        from: 'khangnie@gmail.com',
        to: 'nhi@truong.edu.vn',
        password: PASSWORD,
      },
    },
  };

  it('keeps valid values, secrets and unknown keys at every level', () => {
    const settings = normalizeSettings(structuredClone(raw));
    expect(settings.system).toEqual({ runAtLogin: true, tray: false, future: 1 });
    expect(settings.backup).toEqual(raw.backup);
    expect(settings.notify).toEqual(raw.notify);
    expect(storedSecretValues(settings).sort()).toEqual([BOT, PASSWORD, TOKEN].sort());
  });

  it('repairs invalid fields with defaults and drops empty secrets', () => {
    const settings = normalizeSettings({
      system: { tray: 'no' },
      backup: {
        schedule: { enabled: 'yes', folder: 'relative/folder', time: '25:00', keep: 2 },
        github: {
          enabled: 1,
          remoteUrl: 'https://user:secret@github.com/x/y.git',
          branch: '-delete',
          token: '',
        },
      },
      notify: {
        telegram: { chatId: 'not a chat', botToken: 7 },
        email: {
          host: 'smtp gmail',
          port: 0,
          security: 'ssl',
          user: '  ',
          from: 'not-an-address',
          to: 'Nhi <nhi@x.vn>',
          password: '',
        },
      },
    });
    expect(settings.system.tray).toBe(true);
    expect(settings.backup).toEqual({
      schedule: { enabled: false, folder: null, time: '21:00', keep: 14 },
      github: { enabled: false, remoteUrl: null, branch: 'main' },
    });
    expect(settings.notify.telegram).toEqual({ enabled: false, chatId: null });
    expect(settings.notify.email).toEqual({
      enabled: false,
      host: null,
      port: 587,
      security: 'starttls',
      user: null,
      from: null,
      to: null,
    });
    expect(normalizeSettings({ backup: { schedule: { keep: 61 } } }).backup.schedule.keep).toBe(14);
    expect(normalizeSettings({ backup: { schedule: { keep: 3 } } }).backup.schedule.keep).toBe(3);
    expect(
      normalizeSettings({ notify: { telegram: { chatId: '@lop_k66' } } }).notify.telegram,
    ).toMatchObject({ chatId: '@lop_k66' });
  });

  it.each([
    ['https://github.com/a/b.git', true],
    ['https://gitlab.example.vn/nhóm/kho', true],
    ['http://github.com/a/b.git', false],
    ['git@github.com:a/b.git', false],
    ['file:///tmp/repo.git', false],
    ['https://ghp_x@github.com/a/b.git', false],
    ['https://a:b@github.com/a/b.git', false],
    ['https://github.com/a b', false],
    ['', false],
  ])('remote URL %s is accepted: %s', (url, ok) => {
    expect(isSafeRemoteUrl(url)).toBe(ok);
  });
});
