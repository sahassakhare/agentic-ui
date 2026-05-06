import type { ApprovalDef, ApprovalPolicy } from '../types/registry-defs';

/**
 * Configuration accepted by {@link agenticApproval}. Mirrors
 * {@link ApprovalPolicy} 1-to-1; the factory adds registration-time
 * validation and stamps `name = tool` for `RegistryBase` indexing.
 */
export interface AgenticApprovalConfig extends ApprovalPolicy {}

/**
 * Thrown when the approval policy is malformed at registration time.
 * Surface authoring errors before any chat turn intercepts the tool.
 */
export class AgenticApprovalError extends Error {
  constructor(message: string, public readonly tool: string) {
    super(`[approval:${tool}] ${message}`);
    this.name = 'AgenticApprovalError';
  }
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Factory for an approval policy (Capability F4).
 *
 * @example
 * ```ts
 * inject(ApprovalRegistry).register(
 *   agenticApproval({
 *     tool: 'exportProductionSet',
 *     required: (args, ctx) => ctx.persona !== 'lead-counsel',
 *     approverRoles: ['lead-counsel'],
 *     diffRenderer: 'production-summary-diff',
 *     signoffMessage: (args) =>
 *       `Approve delivery of production ${(args as {productionId: string}).productionId}?`,
 *   }),
 * );
 * ```
 *
 * Validates at registration:
 *   - `tool` is a non-empty string identifier
 *   - `required` and `signoffMessage` are functions
 *   - `approverRoles` is a non-empty array of strings
 *   - `diffRenderer` is a non-empty string identifier
 *   - `slaMinutes` (if set) is a positive number
 *
 * Throws {@link AgenticApprovalError} on any of the above so the host
 * fails loud at boot rather than at first interception.
 */
export function agenticApproval(config: AgenticApprovalConfig): ApprovalDef {
  if (typeof config.tool !== 'string' || !IDENTIFIER_RE.test(config.tool)) {
    throw new AgenticApprovalError(
      `'tool' must be a registered tool name (got ${JSON.stringify(config.tool)})`,
      String(config.tool ?? ''),
    );
  }
  if (typeof config.required !== 'function') {
    throw new AgenticApprovalError(`'required' must be a function`, config.tool);
  }
  if (typeof config.signoffMessage !== 'function') {
    throw new AgenticApprovalError(`'signoffMessage' must be a function`, config.tool);
  }
  if (!Array.isArray(config.approverRoles) || config.approverRoles.length === 0) {
    throw new AgenticApprovalError(
      `'approverRoles' must be a non-empty array of role names`,
      config.tool,
    );
  }
  for (const role of config.approverRoles) {
    if (typeof role !== 'string' || role.length === 0) {
      throw new AgenticApprovalError(
        `Approver role ${JSON.stringify(role)} is not a valid string`,
        config.tool,
      );
    }
  }
  if (typeof config.diffRenderer !== 'string' || !IDENTIFIER_RE.test(config.diffRenderer)) {
    throw new AgenticApprovalError(
      `'diffRenderer' must be a registered widget name (got ${JSON.stringify(config.diffRenderer)})`,
      config.tool,
    );
  }
  if (
    config.slaMinutes !== undefined &&
    (typeof config.slaMinutes !== 'number' || !(config.slaMinutes > 0))
  ) {
    throw new AgenticApprovalError(
      `'slaMinutes' must be a positive number (got ${JSON.stringify(config.slaMinutes)})`,
      config.tool,
    );
  }
  return {
    name: config.tool,
    tool: config.tool,
    required: config.required,
    approverRoles: config.approverRoles,
    diffRenderer: config.diffRenderer,
    signoffMessage: config.signoffMessage,
    slaMinutes: config.slaMinutes,
    autoApproveAfterAuditNote: config.autoApproveAfterAuditNote,
  };
}
