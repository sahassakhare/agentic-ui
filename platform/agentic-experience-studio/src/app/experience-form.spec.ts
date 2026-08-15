import { describe, expect, it } from 'vitest';
import { formatRequirementLines, parseRequirementLines } from './experience-form';

describe('parseRequirementLines', () => {
  it('parses name-based requirements', () => {
    expect(parseRequirementLines('form customerSearch\ntool conflictCheck')).toEqual([
      { kind: 'form', name: 'customerSearch' },
      { kind: 'tool', name: 'conflictCheck' },
    ]);
  });

  it('parses tag late-binding with #', () => {
    expect(parseRequirementLines('component #result-card')).toEqual([
      { kind: 'component', tag: 'result-card' },
    ]);
  });

  it('parses the optional flag', () => {
    expect(parseRequirementLines('tool aiSummary optional')).toEqual([
      { kind: 'tool', name: 'aiSummary', optional: true },
    ]);
  });

  it('ignores blanks, comments, and malformed lines', () => {
    expect(parseRequirementLines('\n# a comment\nform\nform customerSearch\n   ')).toEqual([
      { kind: 'form', name: 'customerSearch' },
    ]);
  });

  it('round-trips through format', () => {
    const text = 'form customerSearch\ncomponent #result-card\ntool aiSummary optional';
    expect(formatRequirementLines(parseRequirementLines(text))).toBe(text);
  });
});
