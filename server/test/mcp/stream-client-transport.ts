import { PassThrough } from 'node:stream';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * The client half of a stdio connection in memory: what Claude Desktop does with the bridge
 * process's stdin/stdout, without a process. `stdin`/`stdout` are handed to the bridge.
 */
export class StreamClientTransport implements Transport {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  /** Everything the bridge wrote to stdout, verbatim (protocol messages only). */
  readonly stdoutText: string[] = [];
  readonly stderrText: string[] = [];
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private readonly buffer = new ReadBuffer();

  constructor() {
    this.stderr.on('data', (chunk: Buffer) => this.stderrText.push(chunk.toString('utf8')));
    this.stdout.on('data', (chunk: Buffer) => {
      this.stdoutText.push(chunk.toString('utf8'));
      this.buffer.append(chunk);
      for (let message = this.buffer.readMessage(); message; message = this.buffer.readMessage()) {
        this.onmessage?.(message);
      }
    });
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.stdin.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    this.stdin.end();
    this.onclose?.();
  }
}
