import type { CapabilityRequirement, RegistryEntry } from '../types/registry-defs';

/**
 * Capability dependency graph (AEP Seam A).
 *
 * `resolveCapabilityGraph` walks the `requires` edges declared on registry
 * entries (see {@link CapabilityRequirement}) and returns a dependency DAG:
 * the nodes reached from a root capability, the edges between them, any
 * requirements that could not be satisfied (`unmet`), any dependency cycles,
 * and a best-effort topological order.
 *
 * This is a **pure function** — no Angular, no signals, no external deps —
 * so it stays bundle-cheap in the runtime FESM and is trivially testable.
 * Angular code supplies a {@link CapabilityLookup} built from the live
 * registries (see {@link createCapabilityLookup}); everything downstream
 * (the Experience Planner, the studio-app graph viz) consumes the plain
 * `CapabilityGraph` result.
 */

/** A concrete capability reference — the pair that keys a graph node. */
export interface CapabilityRef {
  readonly kind: string;
  readonly name: string;
}

/** The root the traversal starts from. */
export interface RootCapability {
  readonly kind: string;
  readonly entry: RegistryEntry;
}

/** A registry entry resolved for a requirement, tagged with its kind. */
export interface ResolvedCapability {
  readonly kind: string;
  readonly entry: RegistryEntry;
}

/**
 * Resolves a {@link CapabilityRequirement} to zero or more concrete entries.
 * Decouples the pure traversal from how capabilities are actually stored
 * (Angular registries, a static map, a catalog response, …).
 */
export interface CapabilityLookup {
  resolve(requirement: CapabilityRequirement): readonly ResolvedCapability[];
}

/** One kind's worth of entries, for {@link createCapabilityLookup}. */
export interface CapabilityLookupSource {
  readonly kind: string;
  /** Returns the current entries of this kind (called lazily per resolve). */
  entries(): readonly RegistryEntry[];
}

/** A node in the resolved graph. `entry` is `null` for an unmet requirement. */
export interface CapabilityGraphNode {
  /** Stable id, `${kind}:${name}`. */
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  /** The resolved entry, or `null` when the requirement could not be satisfied. */
  readonly entry: RegistryEntry | null;
  /** Shortest distance from the root (root = 0). */
  readonly depth: number;
}

/** A dependency edge, `from` requires `to`. */
export interface CapabilityGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly optional: boolean;
  readonly reason?: string;
  /** Set when the edge was resolved by tag late-binding (not an exact name). */
  readonly viaTag?: string;
}

/** A required (non-optional) requirement that resolved to nothing. */
export interface UnmetRequirement {
  /** Node id that declared the requirement. */
  readonly from: string;
  readonly requirement: CapabilityRequirement;
}

/** The resolved dependency graph. */
export interface CapabilityGraph {
  /** Root node id. */
  readonly root: string;
  readonly nodes: readonly CapabilityGraphNode[];
  readonly edges: readonly CapabilityGraphEdge[];
  /** Non-optional requirements that resolved to no capability. */
  readonly unmet: readonly UnmetRequirement[];
  /** Detected cycles, each a list of node ids forming the loop. */
  readonly cycles: readonly (readonly string[])[];
  /** Node ids whose dependency expansion was cut off by `maxDepth`. */
  readonly truncated: readonly string[];
  /** Best-effort topological order (dependencies before dependents). */
  readonly order: readonly string[];
}

export interface ResolveGraphOptions {
  /** Safety bound on traversal depth. Default 64. */
  readonly maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 64;

/** `${kind}:${name}` — the canonical node id. */
export function capabilityNodeId(kind: string, name: string): string {
  return `${kind}:${name}`;
}

/** A stable id for a requirement that resolved to nothing, so viz can render it. */
function unresolvedNodeId(req: CapabilityRequirement): string {
  const selector = req.name ?? (req.tag ? `tag:${req.tag}` : '*');
  return `${req.kind}:${selector}`;
}

/**
 * Builds a {@link CapabilityLookup} over a set of per-kind entry sources.
 *
 * Resolution rules:
 * - `req.name` set → exact match on `entry.name` within `req.kind` (name wins
 *   if `tag` is also set).
 * - `req.tag` set (no `name`) → every `req.kind` entry whose `tags` include the
 *   tag (late binding — may return multiple implementations).
 * - unknown `kind`, or neither `name` nor `tag` → `[]` (surfaces as unmet).
 */
export function createCapabilityLookup(sources: readonly CapabilityLookupSource[]): CapabilityLookup {
  const byKind = new Map<string, CapabilityLookupSource>();
  for (const source of sources) byKind.set(source.kind, source);

  return {
    resolve(req: CapabilityRequirement): readonly ResolvedCapability[] {
      const source = byKind.get(req.kind);
      if (!source) return [];
      const entries = source.entries();

      if (req.name != null) {
        const hit = entries.find((e) => e.name === req.name);
        return hit ? [{ kind: req.kind, entry: hit }] : [];
      }
      if (req.tag != null) {
        const tag = req.tag;
        return entries
          .filter((e) => e.tags?.includes(tag))
          .map((entry) => ({ kind: req.kind, entry }));
      }
      return [];
    },
  };
}

/**
 * Resolves the dependency DAG reachable from `root` by following `requires`
 * edges through `lookup`.
 *
 * - Missing **required** requirements → an `unmet` entry plus an edge to an
 *   `entry: null` placeholder node (so viz can render the gap).
 * - Missing **optional** requirements → silently skipped.
 * - Cycles are detected, recorded in `cycles`, and not re-traversed (the
 *   function always terminates).
 */
export function resolveCapabilityGraph(
  root: RootCapability,
  lookup: CapabilityLookup,
  options: ResolveGraphOptions = {},
): CapabilityGraph {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  const nodes = new Map<string, CapabilityGraphNode>();
  const edges: CapabilityGraphEdge[] = [];
  const unmet: UnmetRequirement[] = [];
  const cycles: string[][] = [];
  const adjacency = new Map<string, string[]>();

  const rootId = capabilityNodeId(root.kind, root.entry.name);
  nodes.set(rootId, { id: rootId, kind: root.kind, name: root.entry.name, entry: root.entry, depth: 0 });

  // Track the active DFS stack for cycle detection and its index for slicing.
  const onStack = new Map<string, number>();
  // Nodes whose children have actually been processed. A node first reached at
  // maxDepth is added but NOT expanded; if it's later reached via a shorter
  // path (children now in-bounds) we must re-expand it — otherwise plan
  // completeness would depend on `requires` ordering.
  const expanded = new Set<string>();
  // Nodes whose expansion was cut off by maxDepth and never later re-reached
  // in-bounds — surfaced so the truncation isn't silent (audit).
  const truncated = new Set<string>();

  const visit = (id: string, entry: RegistryEntry, depth: number, stack: string[]): void => {
    if (depth >= maxDepth) {
      if ((entry.requires?.length ?? 0) > 0 && !expanded.has(id)) truncated.add(id);
      return;
    }
    expanded.add(id);
    truncated.delete(id);
    onStack.set(id, stack.length);
    stack.push(id);

    for (const req of entry.requires ?? []) {
      const matches = lookup.resolve(req);

      if (matches.length === 0) {
        if (!req.optional) {
          const targetId = unresolvedNodeId(req);
          if (!nodes.has(targetId)) {
            nodes.set(targetId, {
              id: targetId,
              kind: req.kind,
              name: req.name ?? (req.tag ? `tag:${req.tag}` : '*'),
              entry: null,
              depth: depth + 1,
            });
          }
          edges.push({ from: id, to: targetId, optional: false, reason: req.reason, viaTag: req.tag });
          (adjacency.get(id) ?? adjacency.set(id, []).get(id)!).push(targetId);
          unmet.push({ from: id, requirement: req });
        }
        continue;
      }

      for (const match of matches) {
        const targetId = capabilityNodeId(match.kind, match.entry.name);
        const existing = nodes.get(targetId);
        if (!existing) {
          nodes.set(targetId, {
            id: targetId,
            kind: match.kind,
            name: match.entry.name,
            entry: match.entry,
            depth: depth + 1,
          });
        } else if (depth + 1 < existing.depth) {
          nodes.set(targetId, { ...existing, depth: depth + 1 });
        }

        edges.push({
          from: id,
          to: targetId,
          optional: req.optional ?? false,
          reason: req.reason,
          viaTag: req.name == null ? req.tag : undefined,
        });
        (adjacency.get(id) ?? adjacency.set(id, []).get(id)!).push(targetId);

        // Cycle: target is on the current DFS stack → record and don't recurse.
        const stackIndex = onStack.get(targetId);
        if (stackIndex != null) {
          cycles.push([...stack.slice(stackIndex), targetId]);
          continue;
        }
        // Recurse until a node is actually expanded — so a node first seen at
        // maxDepth (truncated) still gets expanded if later reached in-bounds.
        // Once expanded, never re-visited (DAG joins + edges stay single).
        if (!expanded.has(targetId)) {
          visit(targetId, match.entry, depth + 1, stack);
        }
      }
    }

    stack.pop();
    onStack.delete(id);
  };

  visit(rootId, root.entry, 0, []);

  return {
    root: rootId,
    nodes: [...nodes.values()],
    edges,
    unmet,
    cycles,
    truncated: [...truncated],
    order: topologicalOrder(rootId, nodes, adjacency, cycles),
  };
}

/**
 * Post-order DFS → reversed = dependencies before dependents. Back-edges
 * (cycle members) are skipped so the function terminates; nodes involved in a
 * cycle still appear, ordered by first completion.
 */
function topologicalOrder(
  rootId: string,
  nodes: Map<string, CapabilityGraphNode>,
  adjacency: Map<string, string[]>,
  cycles: readonly (readonly string[])[],
): string[] {
  const cycleEdges = new Set<string>();
  for (const cycle of cycles) {
    for (let i = 0; i < cycle.length - 1; i++) cycleEdges.add(`${cycle[i]}->${cycle[i + 1]}`);
  }

  const completed: string[] = [];
  const done = new Set<string>();
  const active = new Set<string>();

  const dfs = (id: string): void => {
    if (done.has(id) || active.has(id)) return;
    active.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (cycleEdges.has(`${id}->${next}`)) continue;
      dfs(next);
    }
    active.delete(id);
    done.add(id);
    completed.push(id);
  };

  dfs(rootId);
  // Include any nodes unreachable from root's adjacency (defensive).
  for (const id of nodes.keys()) if (!done.has(id)) dfs(id);

  return completed; // post-order already lists a dependency before its dependent
}
