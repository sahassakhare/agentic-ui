import { describe, expect, it } from 'vitest';
import type { FormActionDef } from '@infra-tools/agentic-ui';
import { fieldsToUi, fieldsToZod, resolveActions } from './catalog-form-compile';

describe('fieldsToZod', () => {
  it('maps field types to the right Zod primitives', () => {
    const schema = fieldsToZod([
      { name: 'title', type: 'text', required: true },
      { name: 'age', type: 'number', required: true },
      { name: 'active', type: 'checkbox', required: true },
    ]);
    expect(schema.safeParse({ title: 'x', age: 3, active: true }).success).toBe(true);
    expect(schema.safeParse({ title: 'x', age: 'nope', active: true }).success).toBe(false);
  });

  it('treats select with options as an enum', () => {
    const schema = fieldsToZod([{ name: 'size', type: 'select', options: ['S', 'M', 'L'], required: true }]);
    expect(schema.safeParse({ size: 'M' }).success).toBe(true);
    expect(schema.safeParse({ size: 'XL' }).success).toBe(false);
  });

  it('makes non-required fields optional', () => {
    const schema = fieldsToZod([{ name: 'note', type: 'text', required: false }]);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it('skips section fields', () => {
    const schema = fieldsToZod([
      { name: 'heading', type: 'section' },
      { name: 'name', type: 'text', required: true },
    ]);
    expect(schema.safeParse({ name: 'a' }).success).toBe(true);
  });

  it('folds inline constraints (minLength) onto strings', () => {
    const schema = fieldsToZod([{ name: 'code', type: 'text', required: true, validation: { minLength: 3 } }]);
    expect(schema.safeParse({ code: 'ab' }).success).toBe(false);
    expect(schema.safeParse({ code: 'abc' }).success).toBe(true);
  });

  it('applies a named validator resolved from the rule registry', () => {
    const resolve = (name: string) => name === 'max5' ? (v: unknown) => (String(v).length <= 5 ? null : 'too long') : undefined;
    const schema = fieldsToZod([{ name: 'code', type: 'text', required: true, validators: ['max5'] }], resolve);
    expect(schema.safeParse({ code: 'abcdef' }).success).toBe(false);
    expect(schema.safeParse({ code: 'abc' }).success).toBe(true);
  });

  it('degrades an unknown field type to a permissive node instead of throwing', () => {
    const schema = fieldsToZod([{ name: 'weird', type: 'signature' as never, required: true }]);
    expect(schema.safeParse({ weird: { any: 'thing' } }).success).toBe(true);
  });
});

describe('fieldsToUi', () => {
  it('carries each field type through as its renderer widget', () => {
    const ui = fieldsToUi([
      { name: 'title', type: 'text' },
      { name: 'age', type: 'number' },
      { name: 'email', type: 'email' },
    ]);
    expect(ui['age'].widget).toBe('number');
    expect(ui['email'].widget).toBe('email');
    expect(ui['title'].widget).toBe('text');
  });

  it('skips section fields and does not consume an order slot', () => {
    const ui = fieldsToUi([{ name: 'heading', type: 'section' }, { name: 'name', type: 'text' }]);
    expect(ui['heading']).toBeUndefined();
    expect(ui['name'].order).toBe(0);
  });

  it('maps select/radio options to {value,label} pairs', () => {
    const ui = fieldsToUi([{ name: 'size', type: 'select', options: ['S', 'M'] }]);
    expect(ui['size'].options).toEqual([{ value: 'S', label: 'S' }, { value: 'M', label: 'M' }]);
  });
});

describe('resolveActions', () => {
  it('returns an authored action bar as-is', () => {
    const actions: FormActionDef[] = [{ kind: 'submit', label: 'Save' }];
    expect(resolveActions(actions, undefined)).toBe(actions);
  });

  it('maps a legacy tool submit string to a tool action', () => {
    expect(resolveActions(undefined, 'archive-matter')).toEqual([{ kind: 'tool', label: 'Submit', tool: 'archive-matter' }]);
  });

  it('maps usage-event (or nothing) to the synthesized default (undefined)', () => {
    expect(resolveActions(undefined, 'usage-event')).toBeUndefined();
    expect(resolveActions(undefined, undefined)).toBeUndefined();
  });
});
