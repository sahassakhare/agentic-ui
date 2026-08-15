import type { Experience } from '../domain/experience.js';
import type { ManifestWidget, PublishedBundle, WorkflowStepJson } from '../domain/publication.js';

/**
 * Everything gathered from the catalog needed to freeze a render manifest: the
 * experience, its workflow steps (from the referenced `workflow` capability, if
 * any), and the widget metadata each step needs. Assembled by the repository's
 * `resolveCapabilityBodiesForExperience`; consumed by {@link buildPublishedBundle}.
 */
export interface BundleSources {
  readonly experience: Experience;
  readonly workflow: { readonly steps: WorkflowStepJson[] } | null;
  readonly widgets: readonly ManifestWidget[];
}

/**
 * Pure assembler: fold the gathered sources into the self-contained manifest
 * that gets frozen into `experience_publications.bundle` and served verbatim to
 * external portals. No I/O — deterministic given its inputs, so it is trivially
 * unit-testable and the embed read never re-derives anything.
 */
export function buildPublishedBundle(
  src: BundleSources,
  publishedVersionNo: number,
  publishedAt: string,
): PublishedBundle {
  const { experience } = src;
  return {
    experience: {
      name: experience.name,
      title: experience.title,
      goal: experience.goal,
      ...(experience.body.defaultLayout ? { defaultLayout: experience.body.defaultLayout } : {}),
    },
    workflow: src.workflow ? { steps: [...src.workflow.steps] } : null,
    widgets: [...src.widgets],
    publishedVersionNo,
    publishedAt,
  };
}
