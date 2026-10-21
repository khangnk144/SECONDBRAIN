/**
 * Server-sent events parser shared by every provider (WHATWG "event stream" rules): lines end in
 * `\r\n`, `\n` or `\r` – also when the `\r` and `\n` arrive in different chunks; several `data:`
 * lines join with `\n`; lines starting with `:` are comments; a blank line dispatches the event.
 * Bytes are decoded as a stream, so a multi-byte character split across chunks stays intact.
 * Unlike a browser, an event still pending when the stream ends is dispatched (a provider that
 * closes without the final blank line still delivers its last chunk, usually the usage).
 */

export interface SseMessage {
  /** The `event:` field, or null when the event had none. */
  event: string | null;
  data: string;
}

export async function* parseSse(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder('utf-8');
  let partial = '';
  let pendingCr = false;
  let event: string | null = null;
  let data: string[] = [];

  /** Applies one complete line; returns a message when the line dispatches one. */
  const handleLine = (line: string): SseMessage | null => {
    if (line === '') {
      const message = data.length > 0 ? { event, data: data.join('\n') } : null;
      event = null;
      data = [];
      return message;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    return null;
  };

  /** Splits decoded text into lines, carrying an unfinished line to the next chunk. */
  function* feed(text: string): Generator<SseMessage> {
    if (text === '') return;
    let start = 0;
    if (pendingCr && text.charCodeAt(0) === 10) start = 1; // the `\n` of a `\r\n` split in two
    pendingCr = false;
    for (let i = start; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code !== 10 && code !== 13) continue;
      const message = handleLine(partial + text.slice(start, i));
      partial = '';
      if (message) yield message;
      if (code === 13) {
        if (i + 1 < text.length) {
          if (text.charCodeAt(i + 1) === 10) i += 1;
        } else {
          pendingCr = true;
        }
      }
      start = i + 1;
    }
    partial += text.slice(start);
  }

  for await (const chunk of chunks) yield* feed(decoder.decode(chunk, { stream: true }));
  yield* feed(decoder.decode());
  if (partial !== '') {
    const message = handleLine(partial);
    partial = '';
    if (message) yield message;
  }
  const last = handleLine('');
  if (last) yield last;
}
