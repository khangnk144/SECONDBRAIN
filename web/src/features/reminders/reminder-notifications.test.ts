import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReminderEntry } from '../../lib/api/reminders-types';
import {
  CLAIM_WAIT_MS,
  createReminderNotifier,
  type ChannelLike,
  type LocksLike,
  type PermissionState,
  type ReminderNotifierDeps,
} from './reminder-notifications';
import { reminderEntry } from './reminders-test-fixtures';

/** BroadcastChannel stand-in: a message reaches every other channel on the same bus. */
function channelBus() {
  const channels = new Set<FakeChannel>();
  class FakeChannel implements ChannelLike {
    private listeners = new Set<(event: MessageEvent) => void>();
    constructor() {
      channels.add(this);
    }
    postMessage(message: unknown) {
      for (const other of channels) {
        if (other !== this) other.listeners.forEach((l) => l({ data: message } as MessageEvent));
      }
    }
    addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
      this.listeners.add(listener);
    }
    removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
      this.listeners.delete(listener);
    }
    close() {
      channels.delete(this);
    }
  }
  return () => new FakeChannel();
}

/** Web Locks stand-in: one holder per name, the others wait in line. */
function fakeLocks(): LocksLike {
  const queues = new Map<string, (() => void)[]>();
  const held = new Set<string>();
  return {
    request(name, options, callback) {
      return new Promise((resolve, reject) => {
        const grant = () => {
          held.add(name);
          // Granted asynchronously, like the browser.
          queueMicrotask(
            () =>
              void callback().then(() => {
                held.delete(name);
                resolve(undefined);
                queues.get(name)?.shift()?.();
              }),
          );
        };
        options.signal?.addEventListener('abort', () => {
          const queue = queues.get(name) ?? [];
          const index = queue.indexOf(grant);
          if (index >= 0) {
            queue.splice(index, 1);
            reject(new DOMException('aborted', 'AbortError'));
          }
        });
        if (held.has(name)) queues.set(name, [...(queues.get(name) ?? []), grant]);
        else grant();
      });
    },
  };
}

function windowDeps(
  windowId: string,
  shared: Pick<ReminderNotifierDeps, 'createChannel' | 'locks'>,
  shown: string[],
  permission: PermissionState = 'granted',
): ReminderNotifierDeps {
  return {
    windowId,
    ...shared,
    permission: () => permission,
    show: (entry) => shown.push(`${windowId}:${entry.key}`),
    open: vi.fn(),
    now: () => Date.now(),
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('one Web Notification across open windows (F17.3)', () => {
  let entry: ReminderEntry;
  beforeEach(() => {
    entry = reminderEntry();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('with Web Locks, only the window holding the lock shows it; the next one takes over', async () => {
    const shared = { locks: fakeLocks(), createChannel: channelBus() };
    const shown: string[] = [];
    const a = createReminderNotifier(windowDeps('a', shared, shown));
    const b = createReminderNotifier(windowDeps('b', shared, shown));
    await flush();
    a.handle(entry);
    b.handle(entry);
    expect(shown).toEqual([`a:${entry.key}`]);
    expect([a.isLeader(), b.isLeader()]).toEqual([true, false]);

    a.stop(); // window a closes
    await flush();
    const next = reminderEntry({ key: 'k2' });
    b.handle(next);
    expect(shown).toEqual([`a:${entry.key}`, 'b:k2']);
    b.stop();
  });

  it('without Web Locks, the earliest claim on the channel wins', async () => {
    vi.useFakeTimers();
    const shared = { locks: null, createChannel: channelBus() };
    const shown: string[] = [];
    const a = createReminderNotifier(windowDeps('a', shared, shown));
    const b = createReminderNotifier(windowDeps('b', shared, shown));
    b.handle(entry);
    vi.advanceTimersByTime(20);
    a.handle(entry);
    vi.advanceTimersByTime(CLAIM_WAIT_MS + 1);
    expect(shown).toEqual([`b:${entry.key}`]);
    // The same reminder again (a resent event) is not shown twice.
    b.handle(entry);
    vi.advanceTimersByTime(CLAIM_WAIT_MS + 1);
    expect(shown).toHaveLength(1);
    a.stop();
    b.stop();
  });

  it('nothing when the server toast was shown, or when the browser does not allow it', async () => {
    const shared = { locks: fakeLocks(), createChannel: channelBus() };
    const shown: string[] = [];
    const denied = createReminderNotifier(windowDeps('a', shared, shown, 'denied'));
    await flush();
    expect(() => denied.handle(entry)).not.toThrow();
    denied.handle(reminderEntry({ key: 'shown', toast: 'shown' }));
    expect(shown).toEqual([]);
    denied.stop();
  });

  it('a browser that throws on show() never breaks the app', async () => {
    const shared = { locks: fakeLocks(), createChannel: null };
    const deps = windowDeps('a', shared, []);
    deps.show = () => {
      throw new TypeError('Illegal constructor');
    };
    const notifier = createReminderNotifier(deps);
    await flush();
    expect(() => notifier.handle(entry)).not.toThrow();
    notifier.stop();
  });
});
