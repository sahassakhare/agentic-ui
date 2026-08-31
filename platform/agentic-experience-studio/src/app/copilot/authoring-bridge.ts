/**
 * Bridge between the copilot's authoring tool handlers (which run inside the
 * agentic run-loop, OUTSIDE Angular DI) and the Studio's services. The copilot
 * rail component (in an injection context) populates these on init; the tool
 * handlers read them. Mirrors the Hub's `agentic/shell-api.ts` pattern — never
 * call `inject()` inside a tool handler.
 */
import { signal } from '@angular/core';

export interface AuthoringDraft {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  /** Route to open the draft in its rich designer (or the registry list). */
  readonly designerPath: string;
}

export interface CapabilitySummary {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly lifecycle?: string;
}

export interface AuthoringBridge {
  /** Create a governed capability as an AI-assisted DRAFT; returns where to open it. */
  createDraft?(kind: string, name: string, body: Record<string, unknown>): Promise<AuthoringDraft>;
  /** List capabilities (optionally one kind). */
  list?(kind?: string): Promise<readonly CapabilitySummary[]>;
  /** Fetch one capability's body by id (or name within a kind). */
  get?(idOrName: string, kind?: string): Promise<Record<string, unknown> | null>;
  /** Refine an existing DRAFT — shallow-merge `bodyPatch` into its body (If-Match versioned). */
  updateDraft?(idOrName: string, kind: string | undefined, bodyPatch: Record<string, unknown>): Promise<AuthoringDraft>;
  /** Navigate the author to a designer route. */
  openDesigner?(path: string): void;
}

/** Module-level singleton: the rail writes to it, the tool handlers read from it. */
export const authoringBridge: AuthoringBridge = {};

/** The most recent draft the copilot created — the rail shows an "Open in designer" action. */
export const lastDraft = signal<AuthoringDraft | null>(null);

/** Kinds that have a rich design route (a `/:id/design` page in app.routes.ts); others link to the list. */
const DESIGNER_KINDS = new Set(['form', 'page', 'workflow', 'decision', 'application', 'theme']);

/** Build the designer/list route for a freshly created capability. */
export function designerPathFor(kind: string, id: string): string {
  return DESIGNER_KINDS.has(kind) ? `/${kind}s/${id}/design` : `/${kind}s`;
}
