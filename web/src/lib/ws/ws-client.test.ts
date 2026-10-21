import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStore } from './connection-store';
import { clearServerEventHandlers, subscribeServerEvent } from './server-event-bus';
import type { ClientEvent } from './server-event-types';
import { serverEventsUrl, startServerEvents } from './start-server-events';
import { createWsClient, type WebSocketLike } from './ws-client';

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  open() {
    this.onopen?.(new Event('open'));
  }
  message(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
  drop() {
    this.onclose?.(new CloseEvent('close'));
  }
  close() {
    this.closed = true;
  }
}

const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1] as FakeSocket;

describe('WebSocket client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    clearServerEventHandlers();
    useConnectionStore.setState({ state: 'connecting', closedSince: null });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconnects with backoff 0.5 s → 10 s and emits resync after a reconnect', () => {
    const events: ClientEvent[] = [];
    const states: string[] = [];
    const client = createWsClient({
      url: 'ws://x/ws',
      createSocket: (url) => new FakeSocket(url),
      onEvent: (event) => events.push(event),
      onStateChange: (state) => states.push(state),
    });
    client.start();
    latest().open();
    latest().message(JSON.stringify({ type: 'hello', version: '1' }));
    expect(events).toEqual([{ type: 'hello', version: '1' }]);

    latest().drop();
    const delays = [500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000];
    for (const delay of delays) {
      const count = FakeSocket.instances.length;
      vi.advanceTimersByTime(delay - 1);
      expect(FakeSocket.instances).toHaveLength(count);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.instances).toHaveLength(count + 1);
      latest().drop();
    }
    vi.advanceTimersByTime(10_000);
    latest().open();
    expect(events[events.length - 1]).toEqual({ type: 'resync' });
    expect(states[states.length - 1]).toBe('open');

    // After a successful open the delay starts over at 0.5 s.
    latest().drop();
    const count = FakeSocket.instances.length;
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(count + 1);
    client.stop();
    expect(latest().closed).toBe(true);
  });

  it('emits resync on a first open that only worked after failed attempts, not on a clean one', () => {
    const events: ClientEvent[] = [];
    const options = {
      url: 'ws://x/ws',
      createSocket: (url: string) => new FakeSocket(url),
      onEvent: (event: ClientEvent) => events.push(event),
      onStateChange: () => {},
    };
    // The app started before the server: two refused attempts, then the server is up.
    const late = createWsClient(options);
    late.start();
    latest().drop();
    vi.advanceTimersByTime(500);
    latest().drop();
    vi.advanceTimersByTime(1_000);
    latest().open();
    expect(events).toEqual([{ type: 'resync' }]);
    late.stop();

    // The server was there from the start: nothing was missed.
    events.length = 0;
    const clean = createWsClient(options);
    clean.start();
    latest().open();
    expect(events).toEqual([]);
    clean.stop();

    // A socket that could not even be created counts as a failed attempt too.
    let refuse = true;
    const thrown = createWsClient({
      ...options,
      createSocket: (url: string) => {
        if (refuse) throw new Error('blocked');
        return new FakeSocket(url);
      },
    });
    thrown.start();
    refuse = false;
    vi.advanceTimersByTime(500);
    latest().open();
    expect(events).toEqual([{ type: 'resync' }]);
    thrown.stop();
  });

  it('ignores pongs and malformed messages; stop prevents reconnects', () => {
    const onEvent = vi.fn();
    const client = createWsClient({
      url: 'ws://x/ws',
      createSocket: (url) => new FakeSocket(url),
      onEvent,
      onStateChange: () => {},
    });
    client.start();
    latest().open();
    latest().message('pong');
    latest().message('{not json');
    latest().message(JSON.stringify({ nope: true }));
    expect(onEvent).not.toHaveBeenCalled();
    client.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('feeds the event bus and the connection store, which stays closed while retrying', () => {
    const seen: ClientEvent[] = [];
    subscribeServerEvent('*', (event) => seen.push(event));
    const renamed = vi.fn();
    subscribeServerEvent('note:renamed', renamed);
    const stop = startServerEvents('tok en', { createSocket: (url) => new FakeSocket(url) });
    expect(latest().url).toContain('/ws?token=tok%20en');
    latest().open();
    expect(useConnectionStore.getState().state).toBe('open');
    latest().message(
      JSON.stringify({ type: 'note:renamed', path: 'b.md', oldPath: 'a.md', revision: 'r' }),
    );
    expect(renamed).toHaveBeenCalledWith(expect.objectContaining({ oldPath: 'a.md' }));

    vi.setSystemTime(new Date(2026, 9, 19, 10, 0, 0));
    latest().drop();
    const closedSince = useConnectionStore.getState().closedSince;
    expect(useConnectionStore.getState().state).toBe('closed');
    vi.advanceTimersByTime(500);
    expect(useConnectionStore.getState()).toMatchObject({ state: 'closed', closedSince });
    latest().open();
    expect(useConnectionStore.getState()).toMatchObject({ state: 'open', closedSince: null });
    expect(seen.map((e) => e.type)).toEqual(['note:renamed', 'resync']);
    stop();
  });

  it('builds the socket URL on the page origin', () => {
    const loc = { protocol: 'http:', host: 'localhost:4747' } as Location;
    expect(serverEventsUrl('abc', loc)).toBe('ws://localhost:4747/ws?token=abc');
    expect(serverEventsUrl(null, loc)).toBe('ws://localhost:4747/ws');
  });
});
