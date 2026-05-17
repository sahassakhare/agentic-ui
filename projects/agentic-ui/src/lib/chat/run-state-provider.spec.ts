import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { inject } from '@angular/core';
import {
  AGENTIC_RUN_STATE_PROVIDER,
  type AgenticRunStateProvider,
} from './run-state-provider';

describe('AGENTIC_RUN_STATE_PROVIDER', () => {
  it('default provider returns an empty object — preserves v1.2 behaviour', () => {
    TestBed.configureTestingModule({});
    const provider = TestBed.inject(AGENTIC_RUN_STATE_PROVIDER);
    expect(provider()).toEqual({});
  });

  it('host-supplied provider returns its object', () => {
    const provider: AgenticRunStateProvider = () => ({
      persona: 'paralegal',
      matter: { id: 'M-2026-0042', type: 'securities' },
      activeRoute: '/custodians',
    });
    TestBed.configureTestingModule({
      providers: [{ provide: AGENTIC_RUN_STATE_PROVIDER, useValue: provider }],
    });
    const got = TestBed.inject(AGENTIC_RUN_STATE_PROVIDER)();
    expect(got).toEqual({
      persona: 'paralegal',
      matter: { id: 'M-2026-0042', type: 'securities' },
      activeRoute: '/custodians',
    });
  });

  it('provider closure can read live signals at call time', () => {
    let active = 'paralegal';
    const provider: AgenticRunStateProvider = () => ({ persona: active });
    TestBed.configureTestingModule({
      providers: [{ provide: AGENTIC_RUN_STATE_PROVIDER, useValue: provider }],
    });
    const got1 = TestBed.inject(AGENTIC_RUN_STATE_PROVIDER)();
    expect(got1).toEqual({ persona: 'paralegal' });

    active = 'lead-counsel';
    const got2 = TestBed.inject(AGENTIC_RUN_STATE_PROVIDER)();
    expect(got2).toEqual({ persona: 'lead-counsel' });
  });

  it('factory provider can inject other tokens', () => {
    class FakePersona { active = 'paralegal'; }
    TestBed.configureTestingModule({
      providers: [
        FakePersona,
        {
          provide: AGENTIC_RUN_STATE_PROVIDER,
          useFactory: () => {
            const persona = inject(FakePersona);
            return () => ({ persona: persona.active });
          },
        },
      ],
    });
    const got = TestBed.inject(AGENTIC_RUN_STATE_PROVIDER)();
    expect(got).toEqual({ persona: 'paralegal' });
  });
});
