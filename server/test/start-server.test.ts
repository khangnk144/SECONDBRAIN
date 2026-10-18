import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliUsageError, parseCliOptions, resolvePort } from '../src/config/cli-args.js';
import { resolveAppPaths } from '../src/config/app-paths.js';
import { startServer } from '../src/runtime/start-server.js';
import { makeFakeAppDir, makeTempDir, removeDir } from './helpers/test-environment.js';

describe('CLI options and port precedence', () => {
  it('--port beats SB_PORT beats settings.port beats 4747', () => {
    expect(resolvePort(parseCliOptions(['--port', '4781'], { SB_PORT: '4782' }), 4783)).toBe(4781);
    expect(resolvePort(parseCliOptions([], { SB_PORT: '4782' }), 4783)).toBe(4782);
    expect(resolvePort(parseCliOptions([], {}), 4783)).toBe(4783);
    expect(resolvePort(parseCliOptions([], {}), undefined)).toBe(4747);
    expect(resolvePort(parseCliOptions([], {}), 'nonsense')).toBe(4747);
  });

  it('reads --dev and --home (flag beats SB_HOME)', () => {
    expect(parseCliOptions(['--dev', '--home', 'D:\\SECONDBRAIN'], { SB_HOME: '/x' })).toEqual({
      dev: true,
      home: 'D:\\SECONDBRAIN',
      portOverride: undefined,
    });
    expect(parseCliOptions([], { SB_HOME: '/x y/Đồ án' }).home).toBe('/x y/Đồ án');
  });

  it('rejects bad ports and unknown flags with a usage error', () => {
    expect(() => parseCliOptions(['--port', '0'])).toThrow(CliUsageError);
    expect(() => parseCliOptions(['--port', '70000'])).toThrow(CliUsageError);
    expect(() => parseCliOptions(['--bogus'])).toThrow(CliUsageError);
  });

  it('defaults home to the parent of the app directory', () => {
    const paths = resolveAppPaths(undefined, '/Đồ án/SECONDBRAIN/app');
    expect(paths.homeDir).toBe('/Đồ án/SECONDBRAIN');
    expect(paths.settingsFile).toMatch(/SECONDBRAIN[\\/]\.secondbrain[\\/]settings\.json$/);
  });
});

describe('startServer single instance', () => {
  let root: string;
  beforeEach(() => {
    root = makeTempDir();
  });
  afterEach(() => removeDir(root));

  it('starts, writes server.json, and a second start reports already-running', async () => {
    const { appDir } = makeFakeAppDir(root);
    const argv = ['--home', root, '--port', '4788'];
    const first = await startServer({ argv, env: {}, appDir });
    expect(first.kind).toBe('started');
    if (first.kind !== 'started') return;
    const infoFile = resolveAppPaths(root, appDir).serverInfoFile;
    expect(JSON.parse(readFileSync(infoFile, 'utf8'))).toMatchObject({
      pid: process.pid,
      port: 4788,
    });

    const second = await startServer({ argv, env: {}, appDir });
    expect(second).toEqual({ kind: 'already-running', port: 4788 });

    await first.stop();
    expect(existsSync(infoFile)).toBe(false);
  });

  it('reports port-busy when another program holds the port', async () => {
    const { appDir } = makeFakeAppDir(root);
    const squatter = http.createServer((_req, res) => res.end('not second brain'));
    await new Promise<void>((resolve) => squatter.listen(4789, '127.0.0.1', resolve));
    try {
      const result = await startServer({
        argv: ['--home', root, '--port', '4789'],
        env: {},
        appDir,
      });
      expect(result).toEqual({ kind: 'port-busy', port: 4789 });
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
  });
});
