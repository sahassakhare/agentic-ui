import { describe, expect, it } from 'vitest';

import { AgenticApprovalError, agenticApproval } from './agentic-approval';

describe('agenticApproval — factory + registration-time validation (Capability F4)', () => {
  const baseConfig = {
    tool: 'exportProductionSet',
    required: () => true,
    approverRoles: ['lead-counsel'],
    diffRenderer: 'production-summary-diff',
    signoffMessage: () => 'Approve?',
  } as const;

  it('returns an ApprovalDef with name === tool and the policy passed through', () => {
    const def = agenticApproval(baseConfig);
    expect(def.name).toBe('exportProductionSet');
    expect(def.tool).toBe('exportProductionSet');
    expect(def.approverRoles).toEqual(['lead-counsel']);
    expect(def.diffRenderer).toBe('production-summary-diff');
    expect(typeof def.required).toBe('function');
    expect(typeof def.signoffMessage).toBe('function');
  });

  it('rejects a non-identifier tool name', () => {
    expect(() => agenticApproval({ ...baseConfig, tool: '../etc/passwd' })).toThrow(
      /must be a registered tool name/,
    );
  });

  it('rejects a non-function required predicate', () => {
    expect(() =>
      agenticApproval({ ...baseConfig, required: 'always' as unknown as () => boolean }),
    ).toThrow(/'required' must be a function/);
  });

  it('rejects a non-function signoffMessage', () => {
    expect(() =>
      agenticApproval({ ...baseConfig, signoffMessage: 'static' as unknown as () => string }),
    ).toThrow(/'signoffMessage' must be a function/);
  });

  it('rejects an empty approverRoles array', () => {
    expect(() => agenticApproval({ ...baseConfig, approverRoles: [] })).toThrow(
      /non-empty array of role names/,
    );
  });

  it('rejects a non-string element in approverRoles', () => {
    expect(() =>
      agenticApproval({ ...baseConfig, approverRoles: ['lead-counsel', 42] as unknown as readonly string[] }),
    ).toThrow(/is not a valid string/);
  });

  it('rejects a non-identifier diffRenderer', () => {
    expect(() => agenticApproval({ ...baseConfig, diffRenderer: 'not a name' })).toThrow(
      /must be a registered widget name/,
    );
  });

  it('rejects a non-positive slaMinutes', () => {
    expect(() => agenticApproval({ ...baseConfig, slaMinutes: -1 })).toThrow(
      /'slaMinutes' must be a positive number/,
    );
    expect(() => agenticApproval({ ...baseConfig, slaMinutes: 0 })).toThrow(
      /'slaMinutes' must be a positive number/,
    );
  });

  it('error message includes the tool name', () => {
    let caught: AgenticApprovalError | undefined;
    try {
      agenticApproval({ ...baseConfig, approverRoles: [] });
    } catch (e) {
      caught = e as AgenticApprovalError;
    }
    expect(caught).toBeInstanceOf(AgenticApprovalError);
    expect(caught!.tool).toBe('exportProductionSet');
    expect(caught!.message).toContain('[approval:exportProductionSet]');
  });
});
