import type { Experience, ExperiencePlanResult } from './services/experience-catalog.service';

/**
 * Pure builder for the capability **dependency** graph the studio renders
 * (AEP Seam A viz). Unlike the ops-console topology view — which shows
 * *containment* (which source owns a capability) — this shows dependency
 * edges: an experience → the capabilities it requires, flagged matched /
 * unmet / optional against a server `/plan` resolution.
 *
 * Emits a cytoscape-compatible element list, but has no cytoscape dependency
 * itself, so it is trivially unit-testable and the app stays light.
 */
export interface GraphNodeData {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  /** 'root' | 'matched' | 'unmet' */
  readonly state: 'root' | 'matched' | 'unmet';
}
export interface GraphEdgeData {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly optional: boolean;
  readonly reason?: string;
}
export type GraphElement =
  | { readonly group: 'nodes'; readonly data: GraphNodeData; readonly classes: string }
  | { readonly group: 'edges'; readonly data: GraphEdgeData; readonly classes: string };

const nodeId = (kind: string, name: string) => `${kind}:${name}`;

/**
 * Build the dependency-graph elements for one experience. When a `/plan`
 * result is supplied, each required capability is coloured matched vs unmet;
 * without it, requirements render as neutral targets.
 */
export function buildExperienceGraphElements(
  experience: Experience,
  plan?: ExperiencePlanResult,
): GraphElement[] {
  const rootId = nodeId('experience', experience.name);
  const elements: GraphElement[] = [
    {
      group: 'nodes',
      data: { id: rootId, label: experience.title || experience.name, kind: 'experience', state: 'root' },
      classes: 'root',
    },
  ];

  const matchedNames = new Set((plan?.matched ?? []).map((m) => nodeId(m.kind, m.name)));
  const seen = new Set<string>([rootId]);

  for (const req of experience.body.requires ?? []) {
    const label = req.name ?? (req.tag ? `#${req.tag}` : '*');
    const targetId = nodeId(req.kind, label);
    const state: 'matched' | 'unmet' = matchedNames.has(nodeId(req.kind, req.name ?? '')) ? 'matched' : 'unmet';

    if (!seen.has(targetId)) {
      seen.add(targetId);
      elements.push({
        group: 'nodes',
        data: { id: targetId, label, kind: req.kind, state },
        classes: state,
      });
    }
    elements.push({
      group: 'edges',
      data: {
        id: `${rootId}->${targetId}`,
        source: rootId,
        target: targetId,
        optional: req.optional ?? false,
        reason: req.reason,
      },
      classes: req.optional ? 'optional' : 'required',
    });
  }
  return elements;
}

/** Convenience: split elements into node + edge arrays for template rendering. */
export function partitionGraph(elements: readonly GraphElement[]): {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
} {
  const nodes: GraphNodeData[] = [];
  const edges: GraphEdgeData[] = [];
  for (const el of elements) {
    if (el.group === 'nodes') nodes.push(el.data);
    else edges.push(el.data);
  }
  return { nodes, edges };
}
