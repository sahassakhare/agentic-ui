/**
 * The published render-manifest contract, mirrored by hand from the catalog
 * server's `domain/publication.ts` (kept in lockstep via shared-fixture tests).
 * This package is intentionally framework-agnostic and dependency-free — no
 * Angular, no Zod — so any portal (React, Vue, Svelte, plain DOM, server-side)
 * can consume it.
 */

/** A serializable branch condition. */
export interface WorkflowCondition {
  field: string;
  op: '==' | '!=' | 'in' | 'truthy' | 'falsy';
  value?: unknown;
}

/** Declarative conditional transition: first matching branch wins, else default. */
export interface ConditionalNext {
  branches: Array<{ when: WorkflowCondition; goto: string }>;
  default: string | null;
}

/**
 * One workflow step. `next` is a target step id, terminal (`null`), or a
 * {@link ConditionalNext}. The runtime's `(state) => …` function form never
 * appears here — it cannot survive JSON serialization.
 */
export interface WorkflowStepJson {
  id: string;
  widget: string;
  section?: string;
  next: string | null | ConditionalNext;
}

/** A widget the portal must supply an implementation for, keyed by `name`. */
export interface ManifestWidget {
  name: string;
  kind: string;
  /** Serializable props hint (JSON-schema-ish) if the capability declared one. */
  propsSchema?: unknown;
}

/** The frozen, self-contained render manifest served to external portals. */
export interface PublishedManifest {
  experience: {
    name: string;
    title: string;
    goal: string;
    defaultLayout?: string;
  };
  workflow: { steps: WorkflowStepJson[] } | null;
  widgets: ManifestWidget[];
  publishedVersionNo: number;
  publishedAt: string;
}
