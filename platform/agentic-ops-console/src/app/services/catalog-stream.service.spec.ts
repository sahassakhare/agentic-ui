import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { CatalogStreamService } from './catalog-stream.service';
import { AuthService } from './auth.service';
import { AutoRefreshService } from './auto-refresh.service';

function base64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function mintToken(payload: object): string {
  return [
    base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
    base64Url(JSON.stringify(payload)),
    'sig',
  ].join('.');
}

interface FakeEventSourceInstance {
  url: string;
  readyState: number;
  listeners: Map<string, Set<(e: unknown) => void>>;
  close: () => void;
  fire: (event: string, data: unknown) => void;
}

let lastInstance: FakeEventSourceInstance | null = null;

class FakeEventSource implements FakeEventSourceInstance {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 2;
  url: string;
  readyState = FakeEventSource.CONNECTING;
  listeners = new Map<string, Set<(e: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    lastInstance = this;
  }
  addEventListener(name: string, fn: (e: unknown) => void): void {
    let set = this.listeners.get(name);
    if (!set) { set = new Set(); this.listeners.set(name, set); }
    set.add(fn);
  }
  close(): void { this.readyState = FakeEventSource.CLOSED; }
  fire(event: string, data: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    const e = event === 'mutation' ? { data: JSON.stringify(data) } : data;
    for (const fn of set) fn(e);
  }
}

describe('CatalogStreamService', () => {
  beforeEach(() => {
    try { localStorage?.removeItem?.('ops-console.token'); } catch { /* no-op */ }
    try { localStorage?.removeItem?.('ops-console.tenant'); } catch { /* no-op */ }
    lastInstance = null;
    vi.stubGlobal('EventSource', FakeEventSource);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  function loginAs(tenantId: string): AuthService {
    const auth = TestBed.inject(AuthService);
    auth.setToken(mintToken({ sub: 'u-1', tenant_id: tenantId, roles: ['member'] }));
    return auth;
  }

  /** Flush queued effects so the stream effect runs `connect()`. */
  function flush(): void {
    // Angular 21 — `tick()` drains effects + change detection in
    // zoneless tests. `injector.get(...)` is needed because the
    // Service constructor's effect runs asynchronously.
    TestBed.tick();
  }

  it('opens an EventSource scoped to the principal\'s tenant', () => {
    loginAs('acme');
    const stream = TestBed.inject(CatalogStreamService);
    flush();
    expect(lastInstance?.url).toContain('/v1/catalogs/acme/stream');
    expect(stream.state()).toBe('connecting');
  });

  it('flips to live state on `open` and pauses polling', () => {
    loginAs('acme');
    const stream = TestBed.inject(CatalogStreamService);
    const polling = TestBed.inject(AutoRefreshService);
    flush();
    lastInstance!.readyState = FakeEventSource.OPEN;
    lastInstance!.fire('open', null);
    expect(stream.isLive()).toBe(true);
    expect(stream.state()).toBe('live');
    expect(polling.running()).toBe(false);   // SSE running → polling paused
  });

  it('forwards mutation events to subscribers', () => {
    loginAs('acme');
    const stream = TestBed.inject(CatalogStreamService);
    flush();
    const handler = vi.fn();
    stream.onMutation(handler);
    lastInstance!.readyState = FakeEventSource.OPEN;
    lastInstance!.fire('open', null);
    lastInstance!.fire('mutation', {
      tenantId: 'acme',
      entityType: 'capability',
      operation: 'create',
      entityId: 'cap-1',
      occurredAt: '2026-05-09T00:00:00Z',
    });
    expect(handler).toHaveBeenCalledOnce();
    const arg = handler.mock.calls[0]![0];
    expect(arg).toMatchObject({ entityType: 'capability', operation: 'create' });
  });

  it('falls back to polling on error when readyState is not OPEN', () => {
    loginAs('acme');
    const stream = TestBed.inject(CatalogStreamService);
    const polling = TestBed.inject(AutoRefreshService);
    flush();
    lastInstance!.readyState = FakeEventSource.OPEN;
    lastInstance!.fire('open', null);
    expect(polling.running()).toBe(false);

    // Simulate a network blip: server closes connection.
    lastInstance!.readyState = FakeEventSource.CLOSED;
    lastInstance!.fire('error', null);

    expect(stream.state()).toBe('polling');
    expect(polling.running()).toBe(true);
  });

  it('does not fall back if EventSource is silently auto-reconnecting (still OPEN)', () => {
    loginAs('acme');
    TestBed.inject(CatalogStreamService);
    const polling = TestBed.inject(AutoRefreshService);
    flush();
    lastInstance!.readyState = FakeEventSource.OPEN;
    lastInstance!.fire('open', null);
    expect(polling.running()).toBe(false);

    // EventSource fires error but readyState is OPEN — transient
    // hiccup, browser is auto-reconnecting; keep polling paused.
    lastInstance!.fire('error', null);
    expect(polling.running()).toBe(false);
  });

  it('drops malformed mutation payloads silently', () => {
    loginAs('acme');
    const stream = TestBed.inject(CatalogStreamService);
    flush();
    const handler = vi.fn();
    stream.onMutation(handler);
    lastInstance!.readyState = FakeEventSource.OPEN;
    lastInstance!.fire('open', null);
    // Hand-crafted malformed: a string that isn't JSON.
    const set = lastInstance!.listeners.get('mutation')!;
    for (const fn of set) fn({ data: 'not-json' });
    expect(handler).not.toHaveBeenCalled();
  });
});
