import type {
  AgenticTelemetrySink,
  ApprovalPolicy,
  ToolDef,
} from '@infra-tools/agentic-ui';
import { syntheticToolContext } from './synthetic-context';
import { zodToWebMcpSchema } from './zod-bridge';
import type {
  NavigatorModelContext,
  WebMcpToolHandle,
  WebMcpToolResult,
} from './types';

/**
 * Pure, framework-free core of the WebMCP adapter. The Angular service
 * (`WebMcpService`) is a thin shell that wires DI + reactivity around
 * these functions; everything security-critical lives here so it's
 * unit-testable without a TestBed (matching the repo convention that
 * sibling packages test pure logic — cf. agentic-ui-opa-authorizer).
 */

/** Narrow dependency surface the invoke path needs (mockable in tests). */
export interface WebMcpInvokeDeps {
  /** Resolve a tool through the scope policy (ToolRegistry.get applies it). */
  readonly getTool: (name: string) => ToolDef | undefined;
  /** Resolve an approval policy for a tool name, if any. */
  readonly getApproval: (toolName: string) => ApprovalPolicy | undefined;
  /** Enqueue a pending approval; returns the generated id. */
  readonly enqueueApproval: (input: {
    toolName: string;
    args: unknown;
    persona: string;
    signoffMessage: string;
  }) => string;
  /** Active persona for approval `required(args, ctx)`. */
  readonly persona: () => string;
  readonly telemetry: AgenticTelemetrySink;
}

function errorResult(text: string): WebMcpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Handle one inbound WebMCP tool call. Order of gates:
 *   1. scope (getTool returns undefined for hidden/missing — single reason)
 *   2. arg validation against the tool's Zod schema
 *   3. approval policy (queue + return pending, never auto-execute)
 *   4. execute through a synthetic context
 */
export async function invokeWebMcpTool(
  deps: WebMcpInvokeDeps,
  toolName: string,
  args: unknown,
): Promise<WebMcpToolResult> {
  const tool = deps.getTool(toolName);
  if (!tool) {
    deps.telemetry.emit('agentic.webmcp.call_blocked', {
      'agentic.tool.name': toolName,
      'agentic.webmcp.block_reason': 'tool-not-found-or-scoped',
    });
    return errorResult(`Tool "${toolName}" is not available.`);
  }

  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) {
    return errorResult(
      `Invalid arguments for "${toolName}": ` +
        parsed.error.issues.map((i) => `${i.path.join('.')}:${i.code}`).join(', '),
    );
  }

  const persona = deps.persona();
  const policy = deps.getApproval(toolName);
  if (policy) {
    const runId = `webmcp-${Date.now()}`;
    let needs = false;
    try {
      needs = policy.required(parsed.data, {
        persona, threadId: `webmcp:${toolName}`, runId, toolCallId: `webmcp-tc-${runId}`,
      });
    } catch {
      needs = true; // throwing predicate → fail closed
    }
    if (needs) {
      const approvalId = deps.enqueueApproval({
        toolName,
        args: parsed.data,
        persona,
        signoffMessage: policy.signoffMessage(parsed.data),
      });
      deps.telemetry.emit('agentic.webmcp.call_queued_for_approval', {
        'agentic.tool.name': toolName,
        'agentic.approval.id': approvalId,
      });
      return {
        content: [{ type: 'text', text: `This action requires approval and has been queued (id ${approvalId}): ${policy.signoffMessage(parsed.data)}` }],
        structuredContent: { status: 'pending-approval', approvalId },
      };
    }
  }

  const runId = `webmcp-${Date.now()}`;
  deps.telemetry.emit('agentic.tool_call.start', {
    'agentic.webmcp.origin': true, 'agentic.tool.name': toolName, 'agentic.run.id': runId,
  });
  try {
    const result = await tool.handler(
      parsed.data,
      syntheticToolContext({ threadId: `webmcp:${toolName}`, runId, toolCallId: `webmcp-tc-${runId}`, signal: new AbortController().signal }),
    );
    deps.telemetry.emit('agentic.tool_call.end', {
      'agentic.webmcp.origin': true, 'agentic.tool.name': toolName, 'agentic.run.id': runId, 'agentic.tool.success': true,
    });
    return {
      content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.telemetry.emit('agentic.tool_call.end', {
      'agentic.webmcp.origin': true, 'agentic.tool.name': toolName, 'agentic.run.id': runId, 'agentic.tool.success': false, 'agentic.error.message': message,
    });
    return errorResult(`Tool "${toolName}" failed: ${message}`);
  }
}

/**
 * Diff the visible tool set against current registrations and apply the
 * delta to `navigator.modelContext`. Pure aside from the registerTool /
 * unregister side effects (which are the whole point). Returns nothing;
 * mutates `handles` in place.
 */
export function syncRegistrations(
  mc: NavigatorModelContext,
  visible: readonly ToolDef[],
  handles: Map<string, WebMcpToolHandle>,
  makeExecute: (toolName: string) => (args: unknown) => Promise<WebMcpToolResult>,
): void {
  const visibleNames = new Set(visible.map((t) => t.name));

  for (const [name, handle] of handles) {
    if (!visibleNames.has(name)) {
      handle.unregister();
      handles.delete(name);
    }
  }

  for (const tool of visible) {
    if (handles.has(tool.name)) continue;
    const handle = mc.registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToWebMcpSchema(tool.schema),
      execute: makeExecute(tool.name),
    });
    handles.set(tool.name, handle);
  }
}
