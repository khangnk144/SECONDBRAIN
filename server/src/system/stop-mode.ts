/**
 * `--stop` (F29.1): asks this home's server to shut down through `POST /api/shutdown` with the
 * session token from settings.json (no Origin header: a local tool, like the launcher's stop),
 * then waits until `/api/health` stops answering. Never kills a process: a server that does not
 * answer is left alone and reported (exit 1).
 */
import { readBridgeTarget } from '../mcp/bridge-server.js';
import { findOwnServer, healthOf } from './own-server.js';

export interface StopModeOptions {
  home: string;
  portOverride?: number;
  fetch?: typeof fetch;
  alive?: (pid: number) => boolean;
  /** How long to wait for the server to go away (default 15 s). */
  timeoutMs?: number;
  pollMs?: number;
  print?: (line: string) => void;
}

export const STOP_OK = 0;
export const STOP_FAILED = 1;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runStopMode(options: StopModeOptions): Promise<number> {
  const fetchImpl = options.fetch ?? fetch;
  const print = options.print ?? ((line: string) => console.log(line));
  const own = await findOwnServer({ ...options, fetch: fetchImpl });
  if (own.kind === 'none') {
    print('Second Brain is not running.');
    return STOP_OK;
  }
  if (own.kind === 'other') {
    print(`The Second Brain on port ${own.port} belongs to another folder; it was not stopped.`);
    return STOP_FAILED;
  }
  const { token } = await readBridgeTarget(options.home);
  if (!token) {
    print('No session token in .secondbrain/settings.json; cannot ask the server to stop.');
    return STOP_FAILED;
  }
  try {
    const response = await fetchImpl(`http://127.0.0.1:${own.port}/api/shutdown`, {
      method: 'POST',
      headers: { 'x-sb-token': token, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 202) {
      print(`The server refused to stop (HTTP ${response.status}).`);
      return STOP_FAILED;
    }
  } catch {
    print('The server did not answer the stop request.');
    return STOP_FAILED;
  }
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    if (!(await healthOf(own.port, fetchImpl))) {
      print('Second Brain stopped.');
      return STOP_OK;
    }
    await sleep(options.pollMs ?? 250);
  }
  print('Second Brain is still running after the stop request.');
  return STOP_FAILED;
}
