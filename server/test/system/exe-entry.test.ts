import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
}));
const { spawn } = await import('node:child_process');
const { defaultStartServer } = await import('../../src/mcp/bridge-server.js');

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** Files reached through static, non-type imports (dynamic `import()` is not followed). */
function staticGraph(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(
      /(?:import|export)(?!\s+type\b)[^'"]*?from\s+'(\.[^']+)'/g,
    )) {
      visit(path.resolve(path.dirname(file), (match[1] as string).replace(/\.js$/, '.ts')));
    }
  };
  visit(path.join(SRC, entry));
  return [...seen].map((file) => path.relative(SRC, file).split(path.sep).join('/')).sort();
}

const VAULT_STACK =
  /^(vault|index|reminders|git|ai|app-context|sources|ws|api|http|graph|markdown|backup|runtime)\//;

describe('exe entry stays light for --stop and --mcp-stdio (F29.1, F32.5)', () => {
  it('index.ts loads the vault stack only through import() in start mode', () => {
    const reached = staticGraph('index.ts');
    expect(reached.filter((file) => VAULT_STACK.test(file) || file.includes('watcher'))).toEqual(
      [],
    );
    const source = readFileSync(path.join(SRC, 'index.ts'), 'utf8');
    expect(source).toContain("import('./system/stop-mode.js')");
    expect(source).toContain("import('./system/mcp-stdio-mode.js')");
    expect(source).toContain("import('./system/server-mode.js')");
  });

  it('the --stop and --mcp-stdio modes reach no vault, index, watcher or job module', () => {
    for (const entry of ['system/stop-mode.ts', 'system/mcp-stdio-mode.ts']) {
      const reached = staticGraph(entry);
      expect(reached.filter((file) => VAULT_STACK.test(file) || file.includes('watcher'))).toEqual(
        [],
      );
    }
    expect(staticGraph('system/mcp-stdio-mode.ts')).toContain('mcp/mcp-bridge.ts');
  });
});

describe('the stdio bridge starts the server it needs (F29.1, F32)', () => {
  it('(F29.1) in exe mode it starts the executable itself with --login and this home', () => {
    const exePath = 'C:\\Users\\Khang\\Second Brain\\Second Brain.exe';
    defaultStartServer('D:\\SECONDBRAIN Đồ án', 'C:\\runtime\\app', 'win32', {
      SB_RUNTIME: 'exe',
      SB_EXE_PATH: exePath,
    })();
    expect(spawn).toHaveBeenLastCalledWith(
      exePath,
      ['--login', '--home', 'D:\\SECONDBRAIN Đồ án'],
      expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: true }),
    );
  });

  it('from source it keeps using the hidden launcher on Windows and node elsewhere', () => {
    defaultStartServer('/home/x', '/app', 'win32', {})();
    expect(spawn).toHaveBeenLastCalledWith(
      'wscript.exe',
      [path.join('/app', 'launcher', 'start-hidden.vbs')],
      expect.objectContaining({ windowsHide: true }),
    );
    defaultStartServer('/home/x', '/app', 'linux', {})();
    expect(spawn).toHaveBeenLastCalledWith(
      process.execPath,
      [path.join('/app', 'server', 'dist', 'index.js'), '--home', '/home/x'],
      expect.objectContaining({ detached: true }),
    );
  });
});
