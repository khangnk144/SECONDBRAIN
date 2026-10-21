import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';

type MessageId = string | number;

interface LooseMessage {
  id?: unknown;
  method?: unknown;
  params?: { name?: unknown };
  result?: { isError?: unknown; structuredContent?: { code?: unknown } };
  error?: unknown;
}

const isId = (value: unknown): value is MessageId =>
  typeof value === 'string' || typeof value === 'number';

/** OK, the tool's error code, or what the SDK refused (bad arguments, unknown tool). */
function outcomeOf(message: LooseMessage): string {
  if (message.error !== undefined) return 'RPC_ERROR';
  if (message.result?.isError !== true) return 'OK';
  const code = message.result.structuredContent?.code;
  return typeof code === 'string' && /^[A-Z_]{2,40}$/.test(code) ? code : 'INVALID_REQUEST';
}

/**
 * One log line per tool call – tool name, outcome code, duration – and nothing else (SPEC §5
 * Logs: no arguments, paths or content). Watches the transport, so calls the SDK refuses before
 * a handler runs are logged too. Install after `server.connect(transport)`.
 */
export function logToolCalls(transport: Transport, logger: AppLogger): void {
  const pending = new Map<MessageId, { name: string; started: number }>();
  const receive = transport.onmessage;
  transport.onmessage = ((message: LooseMessage, extra?: unknown) => {
    if (message.method === 'tools/call' && isId(message.id)) {
      const name = message.params?.name;
      pending.set(message.id, {
        name: typeof name === 'string' && /^[a-z_]{1,64}$/.test(name) ? name : 'unknown-tool',
        started: performance.now(),
      });
    }
    (receive as ((m: unknown, e?: unknown) => void) | undefined)?.(message, extra);
  }) as Transport['onmessage'];
  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    const loose = message as LooseMessage;
    const call = isId(loose.id) ? pending.get(loose.id) : undefined;
    if (call && isId(loose.id)) {
      pending.delete(loose.id);
      const ms = Math.round(performance.now() - call.started);
      logger.info(`MCP ${call.name} ${outcomeOf(loose)} ${ms} ms`);
    }
    return send(message, options);
  };
}
