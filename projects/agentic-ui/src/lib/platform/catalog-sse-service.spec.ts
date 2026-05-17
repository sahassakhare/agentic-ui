import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  CatalogSseService,
  type CatalogMutationEvent,
  type EventSourceFactory,
} from './catalog-sse-service';

/**
 * Stub EventSource — captures the URL the service constructed, lets
 * the test drive `open` / `mutation` / `error` events deterministically,
 * and exposes `close()` so the service-side cleanup is observable.
 */
class StubEventSource {
  static OPEN = 1 as const;
  static CLOSED = 2 as const;
  readyState: 0 | 1 | 2 = 0;
  closed = false;
  private listeners = new Map<string, ((e: Event) => void)[]>();

  constructor(public readonly url: string) {}

  addEventListener(event: string, handler: (e: Event) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler);
  }

  close(): void {
    this.closed = true;
    this.readyState = StubEventSource.CLOSED;
  }

  fireOpen(): void {
    this.readyState = StubEventSource.OPEN;
    for (const h of this.listeners.get('open') ?? []) h(new Event('open'));
  }

  fireMutation(event: CatalogMutationEvent): void {
    const messageEvent = new MessageEvent('mutation', {
      data: JSON.stringify(event),
    });
    for (const h of this.listeners.get('mutation') ?? []) h(messageEvent);
  }

  fireMalformed(): void {
    const messageEvent = new MessageEvent('mutation', { data: 'not-json{' });
    for (const h of this.listeners.get('mutation') ?? []) h(messageEvent);
  }

  fireError(closed = false): void {
    if (closed) this.readyState = StubEventSource.CLOSED;
    for (const h of this.listeners.get('error') ?? []) h(new Event('error'));
  }
}

function makeFactory(): { factory: EventSourceFactory; latest: () => StubEventSource | null } {
  let last: StubEventSource | null = null;
  const factory: EventSourceFactory = (url: string) => {
    last = new StubEventSource(url);
    return last as unknown as EventSource;
  };
  return { factory, latest: () => last };
}

describe('CatalogSseService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('builds the per-tenant stream URL with token query param', async () => {
    const { factory, latest } = makeFactory();
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(CatalogSseService);
    svc.configure({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => 'tok-123',
      eventSourceFactory: factory,
    });
    await svc.connect();

    expect(latest()?.url).toBe(
      'https://catalog.example.com/v1/catalogs/acme/stream?token=tok-123',
    );
  });

  it('omits the token query param when getToken returns null (AUTH_MODE=disabled)', async () => {
    const { factory, latest } = makeFactory();
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(CatalogSseService);
    svc.configure({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => null,
      eventSourceFactory: factory,
    });
    await svc.connect();

    expect(latest()?.url).toBe('https://catalog.example.com/v1/catalogs/acme/stream');
  });

  it('flips state to live on open frame and fan-outs mutation events to listeners', async () => {
    const { factory, latest } = makeFactory();
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(CatalogSseService);
    svc.configure({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => null,
      eventSourceFactory: factory,
    });
    await svc.connect();

    expect(svc.state()).toBe('connecting');

    latest()?.fireOpen();
    expect(svc.state()).toBe('live');
    expect(svc.isLive()).toBe(true);

    const captured: CatalogMutationEvent[] = [];
    const off = svc.onMutation((e) => captured.push(e));

    const event: CatalogMutationEvent = {
      tenantId: 'acme',
      entityType: 'capability',
      operation: 'update',
      entityId: 'cap-42',
      occurredAt: new Date().toISOString(),
      summary: { lifecycle: 'disabled' },
    };
    latest()?.fireMutation(event);

    expect(captured.length).toBe(1);
    expect(captured[0]).toEqual(event);

    off();
    latest()?.fireMutation(event);
    expect(captured.length).toBe(1); // disposer worked
  });

  it('flips to fallback on EventSource error (with stub readyState=CLOSED)', async () => {
    const { factory, latest } = makeFactory();
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(CatalogSseService);
    svc.configure({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => null,
      eventSourceFactory: factory,
    });
    await svc.connect();
    latest()?.fireOpen();
    expect(svc.state()).toBe('live');

    latest()?.fireError(true);
    expect(svc.state()).toBe('fallback');
  });

  it('drops malformed payloads silently without affecting other listeners', async () => {
    const { factory, latest } = makeFactory();
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(CatalogSseService);
    svc.configure({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => null,
      eventSourceFactory: factory,
    });
    await svc.connect();
    latest()?.fireOpen();

    const captured: CatalogMutationEvent[] = [];
    svc.onMutation((e) => captured.push(e));

    latest()?.fireMalformed();        // should NOT throw
    expect(captured.length).toBe(0);

    // Listener still works after the malformed event.
    const goodEvent: CatalogMutationEvent = {
      tenantId: 'acme',
      entityType: 'capability',
      operation: 'create',
      entityId: 'cap-1',
      occurredAt: new Date().toISOString(),
    };
    latest()?.fireMutation(goodEvent);
    expect(captured.length).toBe(1);
  });

  it('disconnect closes the EventSource and resets state', async () => {
    const { factory, latest } = makeFactory();
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(CatalogSseService);
    svc.configure({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => null,
      eventSourceFactory: factory,
    });
    await svc.connect();
    latest()?.fireOpen();

    svc.disconnect();
    expect(latest()?.closed).toBe(true);
    expect(svc.state()).toBe('closed');
  });

  it('connect() is idempotent — calling twice is a no-op', async () => {
    const factories: StubEventSource[] = [];
    const factory: EventSourceFactory = (url) => {
      const es = new StubEventSource(url);
      factories.push(es);
      return es as unknown as EventSource;
    };
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(CatalogSseService);
    svc.configure({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => null,
      eventSourceFactory: factory,
    });
    await svc.connect();
    await svc.connect();
    await svc.connect();

    expect(factories.length).toBe(1);
  });

  it('falls back when EventSource is undefined and no factory provided', async () => {
    const ORIG = (globalThis as { EventSource?: unknown }).EventSource;
    (globalThis as { EventSource?: unknown }).EventSource = undefined;
    try {
      // Reset module cache so the typeof check sees the new global.
      TestBed.configureTestingModule({});
      const svc = TestBed.inject(CatalogSseService);
      svc.configure({
        catalogUrl: 'https://catalog.example.com',
        tenantId: 'acme',
        getToken: () => null,
      });
      await svc.connect();
      expect(svc.state()).toBe('fallback');
    } finally {
      (globalThis as { EventSource?: unknown }).EventSource = ORIG;
    }
  });
});
