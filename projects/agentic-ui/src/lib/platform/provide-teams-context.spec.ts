import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  TEAMS_CONTEXT,
  type TeamsContext,
  provideTeamsContext,
} from './provide-teams-context';

const FIXTURE_CONTEXT: TeamsContext = {
  tenantId: 'tenant-fab',
  userPrincipalName: 'alice@example.com',
  theme: 'dark',
  locale: 'en-US',
};

const FALLBACK_CONTEXT: TeamsContext = {
  tenantId: 'fallback-tenant',
  userPrincipalName: null,
  theme: 'default',
  locale: 'en-US',
};

describe('provideTeamsContext', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('exposes a null signal until loadContext resolves', () => {
    TestBed.configureTestingModule({
      providers: [
        provideTeamsContext({
          // Never resolves -- mimics SDK init never returning.
          loadContext: () => new Promise<TeamsContext>(() => undefined),
        }),
      ],
    });
    const ctxSignal = TestBed.inject(TEAMS_CONTEXT);
    expect(ctxSignal()).toBeNull();
  });

  it('seeds the signal with `fallback` synchronously when provided', () => {
    TestBed.configureTestingModule({
      providers: [
        provideTeamsContext({
          loadContext: () => new Promise<TeamsContext>(() => undefined),
          fallback: FALLBACK_CONTEXT,
        }),
      ],
    });
    const ctxSignal = TestBed.inject(TEAMS_CONTEXT);
    expect(ctxSignal()).toEqual(FALLBACK_CONTEXT);
  });

  it('updates the signal once loadContext resolves', async () => {
    const load = vi.fn(async () => FIXTURE_CONTEXT);
    TestBed.configureTestingModule({
      providers: [provideTeamsContext({ loadContext: load })],
    });
    // Run the ENVIRONMENT_INITIALIZER side-effect.
    await TestBed.inject(TEAMS_CONTEXT);
    await Promise.resolve();   // flush microtasks
    expect(load).toHaveBeenCalledTimes(1);
    const ctxSignal = TestBed.inject(TEAMS_CONTEXT);
    expect(ctxSignal()).toEqual(FIXTURE_CONTEXT);
  });

  it('keeps the signal at fallback when loadContext rejects', async () => {
    const load = vi.fn(async () => { throw new Error('boom'); });
    TestBed.configureTestingModule({
      providers: [
        provideTeamsContext({ loadContext: load, fallback: FALLBACK_CONTEXT }),
      ],
    });
    await TestBed.inject(TEAMS_CONTEXT);
    await Promise.resolve();
    await Promise.resolve();   // extra tick so the rejected promise settles
    const ctxSignal = TestBed.inject(TEAMS_CONTEXT);
    expect(ctxSignal()).toEqual(FALLBACK_CONTEXT);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the signal at null when loadContext rejects and no fallback was provided', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideTeamsContext({
          loadContext: async () => { throw new Error('no SDK'); },
        }),
      ],
    });
    await TestBed.inject(TEAMS_CONTEXT);
    await Promise.resolve();
    await Promise.resolve();
    const ctxSignal = TestBed.inject(TEAMS_CONTEXT);
    expect(ctxSignal()).toBeNull();
  });

  it('preserves the fixture shape verbatim — no field rewrites', async () => {
    const ctx: TeamsContext = {
      tenantId: 'tenant-xyz',
      userPrincipalName: 'bob@contoso.com',
      theme: 'contrast',
      locale: 'fr-FR',
      claims: { roles: ['lead-counsel'], region: 'EU' },
    };
    TestBed.configureTestingModule({
      providers: [provideTeamsContext({ loadContext: async () => ctx })],
    });
    await TestBed.inject(TEAMS_CONTEXT);
    await Promise.resolve();
    expect(TestBed.inject(TEAMS_CONTEXT)()).toEqual(ctx);
  });
});
