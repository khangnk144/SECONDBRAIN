import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAppPaths } from '../src/config/app-paths.js';
import {
  DEFAULT_UI_SETTINGS,
  loadOrCreateGlobalSettings,
  normalizeSettings,
} from '../src/config/global-settings.js';
import { authHeaders, createTestApp, makeTempDir, removeDir } from './helpers/test-environment.js';

describe('Global settings file', () => {
  let home: string;
  let file: string;
  beforeEach(() => {
    home = makeTempDir();
    file = resolveAppPaths(home).settingsFile;
  });
  afterEach(() => removeDir(home));

  it('is created once with defaults and a token, under <home>/.secondbrain/', async () => {
    expect(file).toBe(path.join(home, '.secondbrain', 'settings.json'));
    const first = await loadOrCreateGlobalSettings(file);
    expect(first.created).toBe(true);
    expect(first.settings).toMatchObject({
      version: 1,
      port: 4747,
      vaultPath: null,
      ui: DEFAULT_UI_SETTINGS,
    });
    expect(first.settings.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.parse(readFileSync(file, 'utf8')).sessionToken).toBe(first.settings.sessionToken);
  });

  it('keeps the same token across restarts and leaves no temp files behind', async () => {
    const first = await loadOrCreateGlobalSettings(file);
    const before = readFileSync(file, 'utf8');
    const second = await loadOrCreateGlobalSettings(file);
    expect(second.created).toBe(false);
    expect(second.settings.sessionToken).toBe(first.settings.sessionToken);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('preserves unknown keys and user choices, repairing only invalid fields', async () => {
    await loadOrCreateGlobalSettings(file);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(
      file,
      JSON.stringify({
        ...saved,
        port: 'abc',
        futureKey: { a: 1 },
        ui: { ...saved.ui, palette: 'oai-huong', theme: 'neon' },
      }),
    );
    const { settings } = await loadOrCreateGlobalSettings(file);
    expect(settings.port).toBe(4747);
    expect(settings.futureKey).toEqual({ a: 1 });
    expect(settings.ui.palette).toBe('oai-huong');
    expect(settings.ui.theme).toBe('dark');
    expect(settings.sessionToken).toBe(saved.sessionToken);
  });

  it('keeps a copy of a corrupt file before writing defaults', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{ this is not json');
    const result = await loadOrCreateGlobalSettings(file);
    expect(result.corruptBackup).toBeDefined();
    expect(existsSync(result.corruptBackup!)).toBe(true);
    expect(readFileSync(result.corruptBackup!, 'utf8')).toBe('{ this is not json');
    expect(result.settings.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('GET /api/settings', () => {
  it('keeps port and ui as before and never returns the token or other keys', async () => {
    const handle = await createTestApp(4786);
    (handle.settings as Record<string, unknown>).anthropicApiKey = 'sk-secret-value';
    await handle.app.ready();
    const res = await handle.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: authHeaders(4786),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ port: 4786, ui: DEFAULT_UI_SETTINGS });
    expect(Object.keys(res.json()).sort()).toEqual([
      'ai',
      'configuredPort',
      'port',
      'reminders',
      'restartRequired',
      'system',
      'ui',
      'vault',
    ]);
    expect(res.json().vault).toBeNull(); // API-only build without a vault
    expect(res.body).not.toContain(handle.settings.sessionToken);
    expect(res.body).not.toContain('sk-secret-value');
    expect(Object.keys(res.json().ui).sort()).toEqual([
      'fontSize',
      'language',
      'name',
      'palette',
      'theme',
    ]);
    await handle.cleanup();
  });
});

describe('Global settings sections for reminders, run at login and AI', () => {
  it('fills defaults for a file written before these sections existed', () => {
    const settings = normalizeSettings({});
    expect(settings.reminders).toEqual({ time: '08:00' });
    expect(settings.system).toEqual({ runAtLogin: false });
    expect(settings.ai).toEqual({
      provider: 'anthropic',
      apiKeys: {},
      chatModel: null,
      embeddingModel: null,
      folders: null,
      enabled: false,
      embeddings: false,
    });
  });

  it('keeps valid values and unknown keys, repairs invalid ones', () => {
    const settings = normalizeSettings({
      reminders: { time: '24:00', snooze: 5 },
      system: { runAtLogin: 'yes', tray: true },
      ai: {
        provider: 'openai',
        apiKeys: { openai: 'sk-test-1234567890abcd', gemini: 42, mistral: 'm-key' },
        chatModel: '  ',
        embeddingModel: 'text-embedding-3-small',
        folders: ['2 Areas', 7],
        enabled: true,
        futureFlag: 'x',
      },
    });
    expect(settings.reminders).toEqual({ time: '08:00', snooze: 5 });
    expect(settings.system).toEqual({ runAtLogin: false, tray: true });
    expect(settings.ai).toMatchObject({
      provider: 'openai',
      apiKeys: { openai: 'sk-test-1234567890abcd', mistral: 'm-key' },
      chatModel: null,
      embeddingModel: 'text-embedding-3-small',
      folders: ['2 Areas'],
      enabled: true,
      embeddings: false,
      futureFlag: 'x',
    });
    expect(normalizeSettings({ reminders: { time: '07:30' } }).reminders.time).toBe('07:30');
  });
});
