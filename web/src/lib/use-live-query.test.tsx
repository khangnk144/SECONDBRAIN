import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_QUERY_DEBOUNCE_MS, useLiveQuery } from './use-live-query';
import { clearServerEventHandlers, emitServerEvent } from './ws/server-event-bus';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A fetcher whose every call waits for the test to answer it. */
function controlledFetcher() {
  const pending: Deferred<string>[] = [];
  const fetcher = vi.fn(() => {
    const d = deferred<string>();
    pending.push(d);
    return d.promise;
  });
  return { fetcher, pending };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useLiveQuery', () => {
  beforeEach(() => {
    clearServerEventHandlers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 19, 10, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads, then refetches once per burst of vault events after 150 ms, keeping old data', async () => {
    const { fetcher, pending } = controlledFetcher();
    const { result } = renderHook(() => useLiveQuery('today', fetcher));
    expect(result.current.status).toBe('loading');
    pending[0]!.resolve('v1');
    await flush();
    expect(result.current).toMatchObject({ data: 'v1', status: 'ready', dataKey: 'today' });

    act(() => {
      emitServerEvent({ type: 'note:changed', path: 'a.md', revision: 'r' });
      emitServerEvent({ type: 'note:renamed', path: 'b.md', oldPath: 'a.md', revision: 'r' });
      emitServerEvent({ type: 'folder:changed', path: 'x' });
      emitServerEvent({ type: 'index:progress', phase: 'index', done: 1, total: 2 });
      emitServerEvent({ type: 'hello', version: '1' });
    });
    act(() => vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS - 1));
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(fetcher).toHaveBeenCalledTimes(2);
    // Old data stays on screen while the refetch runs.
    expect(result.current).toMatchObject({ data: 'v1', status: 'ready' });
    pending[1]!.resolve('v2');
    await flush();
    expect(result.current.data).toBe('v2');

    for (const event of [
      { type: 'resync' } as const,
      { type: 'index:progress', phase: 'done', done: 2, total: 2 } as const,
      { type: 'note:deleted', path: 'b.md' } as const,
    ]) {
      act(() => emitServerEvent(event));
      act(() => vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS));
    }
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('drops a slower older response so it never overwrites a newer one', async () => {
    const { fetcher, pending } = controlledFetcher();
    const { result } = renderHook(() => useLiveQuery('tasks', fetcher));
    pending[0]!.resolve('first');
    await flush();
    await act(async () => {
      void result.current.refresh();
      void result.current.refresh();
    });
    pending[2]!.resolve('newest');
    await flush();
    pending[1]!.resolve('older');
    await flush();
    expect(result.current.data).toBe('newest');
  });

  it('refetches at local midnight (23:59 → 00:00)', async () => {
    vi.setSystemTime(new Date(2026, 9, 19, 23, 59, 30));
    const { fetcher, pending } = controlledFetcher();
    renderHook(() => useLiveQuery('today', fetcher));
    pending[0]!.resolve('19th');
    await flush();
    act(() => vi.advanceTimersByTime(31_000 + LIVE_QUERY_DEBOUNCE_MS));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('loads a new key at once and reports the key the data belongs to', async () => {
    const calls: string[] = [];
    const answers = new Map<string, Deferred<string>>();
    const { result, rerender } = renderHook(
      ({ month }) =>
        useLiveQuery(`calendar:${month}`, () => {
          calls.push(month);
          const d = deferred<string>();
          answers.set(month, d);
          return d.promise;
        }),
      { initialProps: { month: '2026-10' } },
    );
    answers.get('2026-10')!.resolve('oct');
    await flush();
    rerender({ month: '2026-11' });
    expect(calls).toEqual(['2026-10', '2026-11']);
    expect(result.current).toMatchObject({
      data: 'oct',
      dataKey: 'calendar:2026-10',
      status: 'loading',
    });
    answers.get('2026-11')!.resolve('nov');
    await flush();
    expect(result.current).toMatchObject({ data: 'nov', dataKey: 'calendar:2026-11' });
  });

  it('mutate changes the data on screen and an in-flight older answer cannot undo it', async () => {
    const { fetcher, pending } = controlledFetcher();
    const { result } = renderHook(() => useLiveQuery('today', fetcher));
    pending[0]!.resolve('open');
    await flush();
    act(() => {
      void result.current.refresh();
    });
    act(() => result.current.mutate((data) => `${data}+ticked`));
    expect(result.current.data).toBe('open+ticked');
    pending[1]!.resolve('open');
    await flush();
    expect(result.current.data).toBe('open+ticked');
    // The dropped request is asked again once things settle.
    act(() => vi.advanceTimersByTime(LIVE_QUERY_DEBOUNCE_MS));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('reports an error only while there is nothing to show', async () => {
    const { fetcher, pending } = controlledFetcher();
    const { result } = renderHook(() => useLiveQuery('today', fetcher));
    pending[0]!.reject(new TypeError('offline'));
    await flush();
    expect(result.current.status).toBe('error');
    await act(async () => {
      const done = result.current.refresh();
      pending[1]!.resolve('back');
      await done;
    });
    expect(result.current).toMatchObject({ status: 'ready', data: 'back', error: undefined });
    await act(async () => {
      const done = result.current.refresh();
      pending[2]!.reject(new TypeError('offline'));
      await done;
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe('back');
    expect(result.current.error).toBeInstanceOf(TypeError);
  });
});
