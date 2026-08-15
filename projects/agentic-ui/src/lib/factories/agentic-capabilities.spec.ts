import { describe, expect, it } from 'vitest';
import {
  AgenticCapabilityError,
  agenticKnowledge,
  agenticMemory,
  agenticNavigation,
  agenticPrompt,
  agenticSkill,
} from './agentic-capabilities';

describe('Seam-B capability factories', () => {
  it('agenticPrompt validates name + template', () => {
    expect(agenticPrompt({ name: 'greet', template: 'hi {{n}}', variables: ['n'] }).name).toBe('greet');
    expect(() => agenticPrompt({ name: '', template: 'x' })).toThrow(AgenticCapabilityError);
    expect(() => agenticPrompt({ name: 'x', template: '' })).toThrow(/template is required/);
    expect(() => agenticPrompt({ name: 'x', template: 't', variables: [1 as unknown as string] })).toThrow(/variables/);
  });

  it('agenticSkill requires a non-empty tools array', () => {
    expect(agenticSkill({ name: 's', description: 'd', tools: ['a'] }).tools).toEqual(['a']);
    expect(() => agenticSkill({ name: 's', description: '', tools: ['a'] })).toThrow(/description/);
    expect(() => agenticSkill({ name: 's', description: 'd', tools: [] })).toThrow(/at least one tool/);
    expect(() => agenticSkill({ name: 's', description: 'd', tools: 'a' as unknown as string[] })).toThrow(/tools/);
  });

  it('agenticKnowledge / agenticMemory require kind', () => {
    expect(agenticKnowledge({ name: 'k', kind: 'vector' }).kind).toBe('vector');
    expect(() => agenticKnowledge({ name: 'k', kind: '' as unknown as 'vector' })).toThrow(/kind/);
    expect(agenticMemory({ name: 'm', kind: 'long-term' }).kind).toBe('long-term');
    expect(() => agenticMemory({ name: 'm', kind: '' as unknown as 'long-term' })).toThrow(/kind/);
  });

  it('agenticNavigation requires title + route', () => {
    expect(agenticNavigation({ name: 'n', title: 'T', route: '/r' }).route).toBe('/r');
    expect(() => agenticNavigation({ name: 'n', title: '', route: '/r' })).toThrow(/title/);
    expect(() => agenticNavigation({ name: 'n', title: 'T', route: '' })).toThrow(/route/);
  });

  it('rejects malformed names', () => {
    expect(() => agenticPrompt({ name: 'has space', template: 't' })).toThrow(/must match/);
  });
});
