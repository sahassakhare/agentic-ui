import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { CompositionExpressionError } from '../composition/composition-expression';
import { FormCompositionError, agenticForm } from './agentic-form';

describe('agenticForm — schema mode (backwards compatibility)', () => {
  it('passes through fieldsSchema and wraps submit as a Promise', async () => {
    const submit = vi.fn().mockReturnValue(undefined);
    const def = agenticForm({
      name: 'simple',
      description: 'simple form',
      fieldsSchema: z.object({ x: z.string() }),
      submit,
    });

    expect(def.name).toBe('simple');
    expect(def.description).toBe('simple form');
    expect(def.composition).toBeUndefined();
    expect(def.fieldsSchema).toBeDefined();

    const result = def.submit({ x: 'hello' });
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(submit).toHaveBeenCalledWith({ x: 'hello' });
  });

  it('preserves async submit handlers', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const def = agenticForm({
      name: 'async',
      description: 'async form',
      fieldsSchema: z.object({}),
      submit,
    });
    await def.submit({});
    expect(submit).toHaveBeenCalledOnce();
  });

  it('threads through ui hints', () => {
    const def = agenticForm({
      name: 'ui',
      description: 'with ui',
      fieldsSchema: z.object({ note: z.string() }),
      ui: { note: { widget: 'textarea', placeholder: 'Notes…' } },
      submit: () => undefined,
    });
    expect(def.ui?.['note']?.widget).toBe('textarea');
  });
});

describe('agenticForm — composition mode (Capability F1)', () => {
  it('plan reference example: custodianIntake', async () => {
    const submit = vi.fn();
    const def = agenticForm({
      name: 'custodianIntake',
      description: 'Onboard a custodian',
      composition: [
        { widget: 'contact-card-fields', section: 'Identity' },
        {
          widget: 'regulatory-consent-checkbox',
          section: 'Compliance',
          if: 'matter.type === "securities"',
        },
        {
          widget: 'supervisor-signoff-picker',
          section: 'Approval',
          if: 'persona !== "lead-counsel"',
        },
        {
          widget: 'accounting-system-picker',
          section: 'Discovery',
          if: 'department === "Finance"',
        },
      ],
      submit,
    });

    expect(def.composition).toBeDefined();
    expect(def.composition).toHaveLength(4);
    // Permissive synthesized schema lets the renderer aggregate freely.
    expect(def.fieldsSchema).toBeDefined();

    // First entry has no condition — predicate undefined.
    expect(def.composition![0].widget).toBe('contact-card-fields');
    expect(def.composition![0].predicate).toBeUndefined();

    // Subsequent entries' `if` strings are compiled to predicates;
    // the original `if` is dropped to keep one source of truth.
    const compliance = def.composition![1];
    expect(compliance.if).toBeUndefined();
    expect(typeof compliance.predicate).toBe('function');
    expect(compliance.predicate?.({ matter: { type: 'securities' } })).toBe(true);
    expect(compliance.predicate?.({ matter: { type: 'employment' } })).toBe(false);
  });

  it('compiled predicate evaluates correctly across entry types', () => {
    const def = agenticForm({
      name: 'demo',
      description: 'demo',
      composition: [
        { widget: 'a' },
        { widget: 'b', if: 'x === 1' },
        { widget: 'c', predicate: (ctx) => ctx['flag'] === true },
      ],
      submit: () => undefined,
    });
    expect(def.composition![0].predicate).toBeUndefined();
    expect(def.composition![1].predicate?.({ x: 1 })).toBe(true);
    expect(def.composition![1].predicate?.({ x: 2 })).toBe(false);
    expect(def.composition![2].predicate?.({ flag: true })).toBe(true);
    expect(def.composition![2].predicate?.({ flag: false })).toBe(false);
  });

  it('preserves section heading on each entry', () => {
    const def = agenticForm({
      name: 'sections',
      description: 'sections',
      composition: [
        { widget: 'a', section: 'Alpha' },
        { widget: 'b', section: 'Beta' },
      ],
      submit: () => undefined,
    });
    expect(def.composition!.map((e) => e.section)).toEqual(['Alpha', 'Beta']);
  });

  it('aggregates submit values as a record', async () => {
    const submit = vi.fn();
    const def = agenticForm({
      name: 'sub',
      description: 'sub',
      composition: [{ widget: 'a' }],
      submit,
    });
    await def.submit({ a: { name: 'Alice' } });
    expect(submit).toHaveBeenCalledWith({ a: { name: 'Alice' } });
  });
});

describe('agenticForm — registration-time validation (AC-F1-3)', () => {
  it('throws FormCompositionError for invalid `if` DSL with cause', () => {
    let caught: unknown;
    try {
      agenticForm({
        name: 'bad-dsl',
        description: 'bad',
        composition: [{ widget: 'a', if: 'a +++ b' }],
        submit: () => undefined,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FormCompositionError);
    const err = caught as FormCompositionError;
    expect(err.formName).toBe('bad-dsl');
    expect(err.entryIndex).toBe(0);
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(CompositionExpressionError);
  });

  it('rejects out-of-grammar features (function call)', () => {
    expect(() =>
      agenticForm({
        name: 'fn-call',
        description: 'no',
        composition: [{ widget: 'a', if: 'f(x) === 1' }],
        submit: () => undefined,
      }),
    ).toThrow(FormCompositionError);
  });

  it('rejects when both `if` and `predicate` are provided', () => {
    expect(() =>
      agenticForm({
        name: 'both',
        description: 'both',
        composition: [
          { widget: 'a', if: 'x === 1', predicate: () => true },
        ],
        submit: () => undefined,
      }),
    ).toThrow(/either 'if' .* or 'predicate'/);
  });

  it('rejects empty composition array', () => {
    expect(() =>
      agenticForm({
        name: 'empty',
        description: 'empty',
        composition: [],
        submit: () => undefined,
      }),
    ).toThrow(/at least one entry/);
  });

  it('rejects entry without a widget name', () => {
    const badEntry = { section: 'Stray' } as unknown as { widget: string };
    expect(() =>
      agenticForm({
        name: 'noname',
        description: 'noname',
        composition: [badEntry],
        submit: () => undefined,
      }),
    ).toThrow(FormCompositionError);
  });

  it('rejects widget name that is not a valid identifier', () => {
    expect(() =>
      agenticForm({
        name: 'bad-widget',
        description: 'bad-widget',
        composition: [{ widget: '../etc/passwd' }],
        submit: () => undefined,
      }),
    ).toThrow(/registered widget by name/);
  });

  it('rejects duplicate widget references in the same composition', () => {
    expect(() =>
      agenticForm({
        name: 'dup',
        description: 'dup',
        composition: [{ widget: 'a' }, { widget: 'a' }],
        submit: () => undefined,
      }),
    ).toThrow(/appears more than once/);
  });

  it('rejects predicate that is not a function', () => {
    const badEntry = {
      widget: 'a',
      predicate: 'not-a-function',
    } as unknown as { widget: string; predicate: () => boolean };
    expect(() =>
      agenticForm({
        name: 'bad-pred',
        description: 'bad-pred',
        composition: [badEntry],
        submit: () => undefined,
      }),
    ).toThrow(/'predicate' must be a function/);
  });

  it('error message includes form name and entry index', () => {
    let caught: FormCompositionError | undefined;
    try {
      agenticForm({
        name: 'helpful',
        description: 'helpful',
        composition: [
          { widget: 'a' },
          { widget: 'b', if: 'a +++' }, // bad DSL on entry index 1
        ],
        submit: () => undefined,
      });
    } catch (e) {
      caught = e as FormCompositionError;
    }
    expect(caught).toBeInstanceOf(FormCompositionError);
    expect(caught!.message).toContain('[helpful]');
    expect(caught!.message).toContain('composition[1]');
  });
});
