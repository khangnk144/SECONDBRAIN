// A second Second Brain server for the opt-in performance specs: its own temporary home (never the
// owner's vault, never port 4747), started on port 4798 once the vault folder is filled.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';

export const PERF_PORT = 4798;
export const PERF_ORIGIN = `http://localhost:${PERF_PORT}`;

export interface PerfServer {
  home: string;
  vaultDir: string;
  /** Starts the server and waits until it answers (vault opened, cold index built). */
  start(): Promise<number>;
  stop(): void;
}

export function perfServer(): PerfServer {
  const home = mkdtempSync(path.join(tmpdir(), 'sb perf Đồ án '));
  let child: ChildProcess | null = null;
  return {
    home,
    vaultDir: path.join(home, 'vault'),
    async start() {
      const started = Date.now();
      child = spawn('node', ['server/dist/index.js', '--port', String(PERF_PORT), '--home', home], {
        stdio: 'ignore',
      });
      await expect
        .poll(
          async () => {
            try {
              return (await fetch(`${PERF_ORIGIN}/api/health`)).ok;
            } catch {
              return false;
            }
          },
          { timeout: 300_000, intervals: [500] },
        )
        .toBe(true);
      return Date.now() - started;
    },
    stop() {
      child?.kill();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

export const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!);
};

export const stats = (values: number[]) => ({
  n: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  max: Math.round(Math.max(...values)),
});
