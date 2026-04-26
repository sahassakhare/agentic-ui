import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';
import { ActionRegistry } from './action-registry';
import { IntentRegistry } from './intent-registry';
import { FormRegistry } from './form-registry';
import { agenticAction } from '../factories/agentic-action';
import { agenticIntent } from '../factories/agentic-intent';
import { agenticForm } from '../factories/agentic-form';
import { ValidationRegistry } from '../validation/validation-registry';
import type { ActionDef, FormDef } from '../types';

describe('ActionRegistry', () => {
  let registry: ActionRegistry;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ActionRegistry);
  });

  it('byType resolves a registered action', () => {
    const action = agenticAction({
      type: 'navigate',
      description: 'Navigate to a route',
      payloadSchema: z.object({ url: z.string() }),
      effect: () => undefined,
    });
    registry.register(action as ActionDef);
    expect(registry.byType('navigate')).toBe(action as ActionDef);
    expect(registry.byType('unknown')).toBeUndefined();
  });

  it('agenticAction effect runs payload through the action', async () => {
    const calls: { url: string }[] = [];
    const action = agenticAction({
      type: 'navigate',
      description: '',
      payloadSchema: z.object({ url: z.string() }),
      effect: ({ url }) => { calls.push({ url }); },
    });
    await action.effect({ url: '/home' }, { threadId: 't', runId: 'r', actionId: 'a', signal: new AbortController().signal });
    expect(calls).toEqual([{ url: '/home' }]);
  });
});

describe('IntentRegistry', () => {
  it('match() finds an intent by example substring', () => {
    TestBed.configureTestingModule({});
    const registry = TestBed.inject(IntentRegistry);
    registry.register(agenticIntent({
      id: 'showBookings',
      description: 'Show booking history',
      examples: ['my bookings', 'show bookings'],
      schema: z.object({}),
      mapsTo: { kind: 'tool', target: 'getBookings' },
    }));
    expect(registry.match('show me my bookings please')?.id).toBe('showBookings');
    expect(registry.match('hello world')).toBeUndefined();
  });
});

describe('FormRegistry + ValidationRegistry', () => {
  it('agenticForm submits valid values; rejects invalid via ValidationRegistry', async () => {
    TestBed.configureTestingModule({});
    const forms = TestBed.inject(FormRegistry);
    const validators = TestBed.inject(ValidationRegistry);

    const submitted: { name: string; age: number }[] = [];
    const form = agenticForm({
      name: 'profile',
      description: '',
      fieldsSchema: z.object({ name: z.string().min(1), age: z.number().int().nonnegative() }),
      submit: (values) => { submitted.push(values); },
    });
    forms.register(form as FormDef);

    const def = forms.get('profile')!;
    const valid = validators.validate(def.fieldsSchema, { name: 'Ada', age: 30 });
    expect(valid.success).toBe(true);
    if (valid.success && valid.data) {
      await def.submit(valid.data as { name: string; age: number });
    }
    expect(submitted).toEqual([{ name: 'Ada', age: 30 }]);

    const invalid = validators.validate(def.fieldsSchema, { name: '', age: -1 });
    expect(invalid.success).toBe(false);
    expect(invalid.errors!.length).toBeGreaterThan(0);
  });
});
