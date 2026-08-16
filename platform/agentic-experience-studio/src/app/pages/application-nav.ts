/**
 * Nav tree ↔ flat-rows conversion for the Application Designer.
 *
 * The designer edits navigation as a FLAT list of rows, each carrying a `depth`
 * (an outliner). These helpers convert to/from the nested `children` tree the
 * runtime consumes. Pure + dependency-free so they're unit-testable.
 */

/** Nested nav entry as persisted in the application body (runtime consumes this). */
export interface NavEntry {
  title: string; path: string; page: string;
  icon?: string; order?: number;
  personas?: string[];
  children?: NavEntry[];
}

/** Flat editing row: a nav entry plus its nesting `depth`. */
export interface NavRow {
  title: string; path: string; page: string;
  icon?: string; personas?: string[];
  depth: number;
}

/** Flatten the nested nav tree into editable rows carrying depth. */
export function flattenTree(entries: readonly NavEntry[], depth = 0, out: NavRow[] = []): NavRow[] {
  for (const e of entries) {
    out.push({
      title: e.title, path: e.path, page: e.page,
      icon: e.icon,
      personas: e.personas ? [...e.personas] : undefined,
      depth,
    });
    if (e.children?.length) flattenTree(e.children, depth + 1, out);
  }
  return out;
}

/** Rebuild the nested tree from flat rows + depth; assigns `order` per sibling group. */
export function buildTree(rows: readonly NavRow[]): NavEntry[] {
  const roots: NavEntry[] = [];
  const stack: { entry: NavEntry; depth: number }[] = [];
  for (const r of rows) {
    const entry: NavEntry = {
      title: r.title, path: r.path, page: r.page,
      icon: r.icon || undefined,
      personas: r.personas?.length ? r.personas : undefined,
    };
    while (stack.length && stack[stack.length - 1].depth >= r.depth) stack.pop();
    if (!stack.length) roots.push(entry);
    else (stack[stack.length - 1].entry.children ??= []).push(entry);
    stack.push({ entry, depth: r.depth });
  }
  const order = (list: NavEntry[]): void => list.forEach((e, i) => { e.order = (i + 1) * 10; if (e.children) order(e.children); });
  order(roots);
  return roots;
}

/** Clamp depths so the first row is a root and no row jumps more than one level deeper. */
export function normalizeDepths(rows: NavRow[]): void {
  let prev = -1;
  for (const r of rows) { r.depth = Math.max(0, Math.min(r.depth, prev + 1)); prev = r.depth; }
}
