import { describe, expect, it } from 'vitest';
import { AgenticExperienceError, agenticExperience } from './agentic-experience';

const base = { name: 'legalIntake', title: 'Legal Intake', goal: 'Create Legal Matter' };

describe('agenticExperience', () => {
  it('accepts a valid experience', () => {
    const e = agenticExperience({
      ...base,
      intents: ['create matter'],
      personas: ['lead-counsel'],
      requiredPermissions: ['matter.create'],
      requires: [{ kind: 'form', name: 'customerSearch' }, { kind: 'component', tag: 'result-card' }],
    });
    expect(e.name).toBe('legalIntake');
  });

  it('requires name/title/goal', () => {
    expect(() => agenticExperience({ ...base, name: '' })).toThrow(/name is required/);
    expect(() => agenticExperience({ ...base, title: '' })).toThrow(/title is required/);
    expect(() => agenticExperience({ ...base, goal: '' })).toThrow(/goal is required/);
  });

  it('rejects a requirement with neither name nor tag', () => {
    expect(() => agenticExperience({ ...base, requires: [{ kind: 'form' }] })).toThrow(/must set either name or tag/);
  });

  it('rejects a requirement missing kind', () => {
    expect(() => agenticExperience({ ...base, requires: [{ kind: '', name: 'x' }] })).toThrow(/kind is required/);
  });

  it('rejects a self-referential requirement', () => {
    expect(() => agenticExperience({ ...base, requires: [{ kind: 'experience', name: 'legalIntake' }] }))
      .toThrow(/self-referential/);
  });

  it('rejects non-string arrays', () => {
    expect(() => agenticExperience({ ...base, personas: [1 as unknown as string] })).toThrow(AgenticExperienceError);
  });
});
