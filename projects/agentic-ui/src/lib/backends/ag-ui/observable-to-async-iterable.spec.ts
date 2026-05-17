import { describe, expect, it } from 'vitest';
import { Observable, Subject, throwError } from 'rxjs';
import { observableToAsyncIterable } from './observable-to-async-iterable';

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe('observableToAsyncIterable', () => {
  it('yields all next() values then completes', async () => {
    const src = new Observable<number>((sub) => {
      sub.next(1);
      sub.next(2);
      sub.next(3);
      sub.complete();
    });
    const ac = new AbortController();
    const values = await collect(observableToAsyncIterable(src, ac.signal));
    expect(values).toEqual([1, 2, 3]);
  });

  it('propagates errors as a thrown Error', async () => {
    const ac = new AbortController();
    await expect(collect(observableToAsyncIterable(throwError(() => new Error('oops')), ac.signal)))
      .rejects.toThrow('oops');
  });

  it('terminates promptly when the abort signal fires', async () => {
    // Use an Observable that subscribes synchronously and emits via setTimeout
    // — this guarantees the consumer is subscribed before values arrive,
    // without depending on async-generator microtask timing.
    const ac = new AbortController();
    const src = new Observable<number>((sub) => {
      const t1 = setTimeout(() => sub.next(1), 10);
      const t2 = setTimeout(() => sub.next(2), 20);
      const t3 = setTimeout(() => sub.next(3), 50);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    });
    const consumer = collect(observableToAsyncIterable(src, ac.signal));
    setTimeout(() => ac.abort(), 30); // abort after the first two have arrived
    const values = await consumer;
    expect(values).toEqual([1, 2]);
  });

  it('handles late next() between abort + consumer drain by stopping cleanly', async () => {
    const src = new Subject<number>();
    const ac = new AbortController();
    const consumer = collect(observableToAsyncIterable(src.asObservable(), ac.signal));
    await Promise.resolve();
    ac.abort();
    src.next(1); // post-abort emission, ignored
    const values = await consumer;
    expect(values).toEqual([]);
  });

  it('returns immediately if the signal is already aborted', async () => {
    const src = new Subject<number>();
    const ac = new AbortController();
    ac.abort();
    const values = await collect(observableToAsyncIterable(src.asObservable(), ac.signal));
    expect(values).toEqual([]);
  });
});
