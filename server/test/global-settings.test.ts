import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAppPaths } from '../src/config/app-paths.js';
import { DEFAULT_UI_SETTINGS, loadOrCreateGlobalSettings } from '../src/config/global-settings.js';
import { toPublicSettings } from '../src/api/settings-route.js';
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
  it('returns port and ui only, never the token or other keys', async () => {
    const handle = await createTestApp(4786);
    (handle.settings as Record<string, unknown>).anthropicApiKey = 'sk-secret-value';
    await handle.app.ready();
    const res = await handle.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: authHeaders(4786),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ port: 4786, ui: DEFAULT_UI_SETTINGS });
    expect(res.body).not.toContain(handle.settings.sessionToken);
    expect(res.body).not.toContain('sk-secret-value');
    expect(Object.keys(toPublicSettings(handle.settings, 4786).ui).sort()).toEqual([
      'fontSize',
      'language',
      'name',
      'palette',
      'theme',
    ]);
    await handle.cleanup();
  });
});
