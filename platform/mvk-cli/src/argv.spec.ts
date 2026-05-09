import { describe, expect, it } from 'vitest';
import { parseArgs } from './argv.js';

describe('parseArgs', () => {
  it('separates flags from positionals (subcommand resolution is the dispatcher\'s job)', () => {
    const a = parseArgs(['tenant', 'create', '--id', 'acme']);
    expect(a.positional).toEqual(['tenant', 'create']);
    expect(a.flags).toEqual({ id: 'acme' });
    expect(a.subcommands).toEqual([]);
  });

  it('handles --flag=value form', () => {
    const a = parseArgs(['capability', 'list', '--kind=tool', '--limit=10']);
    expect(a.flags).toEqual({ kind: 'tool', limit: '10' });
  });

  it('treats known boolean flags as standalone', () => {
    const a = parseArgs(['tenant', 'list', '--include-deleted', '--json']);
    expect(a.flags).toEqual({ 'include-deleted': true, json: true });
  });

  it('positional args land in `positional` in order', () => {
    const a = parseArgs(['tenant', 'get', '550e8400-e29b-41d4-a716-446655440000']);
    expect(a.positional).toEqual(['tenant', 'get', '550e8400-e29b-41d4-a716-446655440000']);
  });

  it('flag-without-value at end of argv treated as boolean', () => {
    const a = parseArgs(['tenant', 'delete', 'acme', '--force']);
    expect(a.flags).toEqual({ force: true });
    expect(a.positional).toEqual(['tenant', 'delete', 'acme']);
  });

  it('quoted-style values with spaces preserved', () => {
    const a = parseArgs(['tenant', 'suspend', 'acme', '--reason', 'overdue invoice']);
    expect(a.flags).toEqual({ reason: 'overdue invoice' });
  });

  it('empty argv returns empty parse', () => {
    const a = parseArgs([]);
    expect(a.subcommands).toEqual([]);
    expect(a.positional).toEqual([]);
    expect(a.flags).toEqual({});
  });
});
