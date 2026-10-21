import { describe, expect, it } from 'vitest';
import { parseSse, type SseMessage } from '../../../src/ai/providers/sse-parser.js';
import { byteChunks } from './provider-test-kit.js';

const encoder = new TextEncoder();

async function parse(chunks: readonly (string | Uint8Array)[]): Promise<SseMessage[]> {
  async function* source() {
    for (const chunk of chunks) yield typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
  }
  const out: SseMessage[] = [];
  for await (const message of parseSse(source())) out.push(message);
  return out;
}

describe('SSE parser shared by the providers', () => {
  const stream =
    ': keep-alive comment\r\n' +
    'event: message_start\r\n' +
    'data: {"a":1}\r\n' +
    '\r\n' +
    'data: first line\n' +
    'data: second line\n' +
    '\n' +
    'data:no-space\r' +
    '\r' +
    'id: 7\nretry: 1000\ndata: [DONE]\n\n';
  const expected: SseMessage[] = [
    { event: 'message_start', data: '{"a":1}' },
    { event: null, data: 'first line\nsecond line' },
    { event: null, data: 'no-space' },
    { event: null, data: '[DONE]' },
  ];

  it('parses CRLF, LF and CR line ends, multi-line data, comments and unknown fields', async () => {
    expect(await parse([stream])).toEqual(expected);
  });

  it('gives the same messages whatever the chunk boundaries (every byte split)', async () => {
    for (const size of [1, 2, 3, 5, 7, 13]) {
      expect(await parse(byteChunks(stream, size)), `chunks of ${size}`).toEqual(expected);
    }
  });

  it('keeps a CRLF split between two chunks as one line end', async () => {
    expect(await parse(['data: x\r', '\n\r', '\ndata: y\r\n\r\n'])).toEqual([
      { event: null, data: 'x' },
      { event: null, data: 'y' },
    ]);
  });

  it('keeps Vietnamese characters intact when their bytes are split across chunks', async () => {
    const text = 'data: {"t":"Đại số tuyến tính – chương 3, ma trận ể ữ 😀"}\n\n';
    for (const size of [1, 2, 3, 4]) {
      const [message] = await parse(byteChunks(text, size));
      expect(JSON.parse(message!.data).t).toBe('Đại số tuyến tính – chương 3, ma trận ể ữ 😀');
    }
  });

  it('dispatches an event still pending when the stream ends, and ignores empty events', async () => {
    expect(await parse(['event: ping\n\n', 'data: last'])).toEqual([{ event: null, data: 'last' }]);
    expect(await parse(['data: last\n'])).toEqual([{ event: null, data: 'last' }]);
    expect(await parse([''])).toEqual([]);
  });
});
