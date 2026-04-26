import type { AgenticEvent } from './agentic-event';
import type { AgenticMessage } from './agentic-message';
import type { BackendCapabilities, ComponentDef, ToolDef } from './registry-defs';

export interface AgenticRunInput {
  readonly threadId: string;
  readonly runId: string;
  readonly messages: readonly AgenticMessage[];
  readonly tools: readonly ToolDef[];
  readonly widgets: readonly ComponentDef[];
  readonly signal: AbortSignal;
}

export interface AgenticBackend {
  readonly id: string;
  readonly capabilities: BackendCapabilities;
  run(input: AgenticRunInput): AsyncIterable<AgenticEvent>;
  reset?(threadId: string): Promise<void>;
}
