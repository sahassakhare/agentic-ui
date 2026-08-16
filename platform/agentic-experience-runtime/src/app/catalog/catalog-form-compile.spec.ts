import { describe, expect, it } from 'vitest';
import type { FormActionDef } from '@infra-tools/agentic-ui';
import { fieldsToZod, resolveActions } from './catalog-form-compile';

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
    // Only `name` is a real field; a section must not become a required key.
    expect(schema.safeParse({ name: 'a' }).success).toBe(true);
  });

  it('folds inline constraints (minLength) onto strings', () => {
    const schema = fieldsToZod([{ name: 'code', type: 'text', required: true, validation: { minLength: 3 } }]);
    expect(schema.safeParse({ code: 'ab' }).success).toBe(false);
    expect(schema.safeParse({ code: 'abc' }).success).toBe(true);
  });

  it('degrades an unknown field type to a permissive node instead of throwing', () => {
    const schema = fieldsToZod([{ name: 'weird', type: 'signature' as never, required: true }]);
    expect(schema.safeParse({ weird: { any: 'thing' } }).success).toBe(true);
  });

  it('keeps the node when a regex pattern is invalid (never throws)', () => {
    const schema = fieldsToZod([{ name: 'x', type: 'text', required: true, validation: { pattern: '(' } }]);
    expect(schema.safeParse({ x: 'anything' }).success).toBe(true);
  });
});

describe('resolveActions', () => {
  it('returns an authored action bar as-is', () => {
    const actions: FormActionDef[] = [
      { kind: 'submit', label: 'Save' },
      { kind: 'tool', label: 'Export', tool: 'export-pdf' },
    ];
    expect(resolveActions(actions, undefined)).toBe(actions);
  });

  it('maps a legacy tool submit string to a tool action', () => {
    expect(resolveActions(undefined, 'archive-matter')).toEqual([
      { kind: 'tool', label: 'Submit', tool: 'archive-matter' },
    ]);
  });

  it('maps usage-event (or nothing) to the synthesized default (undefined)', () => {
    expect(resolveActions(undefined, 'usage-event')).toBeUndefined();
    expect(resolveActions(undefined, undefined)).toBeUndefined();
  });

  it('prefers actions over a legacy submit', () => {
    const actions: FormActionDef[] = [{ kind: 'submit', label: 'Go' }];
    expect(resolveActions(actions, 'some-tool')).toBe(actions);
  });
});
