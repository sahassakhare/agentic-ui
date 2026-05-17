import type { Observable } from 'rxjs';

/**
 * Converts an RxJS Observable to an AsyncIterable, honoring an AbortSignal.
 * Backpressure: events are buffered in a queue; consumer pull rate determines memory.
 */
export async function* observableToAsyncIterable<T>(
  observable: Observable<T>,
  signal: AbortSignal,
): AsyncIterable<T> {
  const queue: T[] = [];
  let resolveNext: (() => void) | null = null;
  let completed = false;
  let error: unknown;

  const wake = () => {
    const r = resolveNext;
    resolveNext = null;
    r?.();
  };

  const subscription = observable.subscribe({
    next: (value) => { queue.push(value); wake(); },
    error: (err) => { error = err; wake(); },
    complete: () => { completed = true; wake(); },
  });

  const onAbort = () => { subscription.unsubscribe(); wake(); };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      if (signal.aborted) return;
      if (queue.length > 0) {
        yield queue.shift() as T;
        continue;
      }
      if (error !== undefined) throw error;
      if (completed) return;
      await new Promise<void>((resolve) => { resolveNext = resolve; });
    }
  } finally {
    subscription.unsubscribe();
    signal.removeEventListener('abort', onAbort);
  }
}
