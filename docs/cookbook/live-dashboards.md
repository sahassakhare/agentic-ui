# Live + drillable dashboards

> **Status:** ships in v1.2.x (P3.C of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **ADR:** [0044](../adr/0044-dashboard-registry.md) · **Pattern:** §3 Pillar 3 — Flavour C

P3.A made dashboards a registry. P3.B made them agent-buildable. P3.C makes them **live + queryable + annotatable** — three properties that fall out of the registry-as-substrate design and that no dashboarding product (Tableau / PowerBI / Looker) has.

This slice adds two pieces:

- **`TileResultCache`** — cross-instance result cache. Two tiles referencing the same `{tool, args}` (or `{source, query}`) within `cacheTtlMs` share **one** underlying fetch. Concurrent fires dedupe automatically.
- **Tile annotations** — `[annotations]` input + `(annotate)` event on `<mvk-dashboard-tile>`. The chat (or any host UI) can pin notes to a tile; the audit chain captures the note as a chain-hashed tool call when the host wires it.

## 1. The cache — what changes for you?

Most of the time, nothing. You set `cacheTtlMs` on the tile and the runtime does the rest:

```ts
{
  id: 'open-holds',
  slot: 'primary',
  title: 'Open holds',
  component: 'countTile',
  invocation: { kind: 'tool', tool: 'countOpenHolds', args: { matterId: 'M-117' } },
  cacheTtlMs: 30_000,   // 30s reuse window across every tile referencing this {tool, args}
}
```

When two tiles in the same dashboard (or two dashboards open in the same tab, or the same tile rendered twice) reference `{countOpenHolds, {matterId:'M-117'}}` within 30s, the second one reads from the in-memory cache. **One fetch, two renders.**

### Concurrent dedupe is automatic

`TileResultCache.track()` registers each in-flight fetch under its stable key. Five tiles firing the same invocation simultaneously share **one** promise — the underlying tool runs once, all five render the same result.

```ts
// (internal — what every tile does)
const result = await cache.track(
  tileCacheKey('tool', 'countOpenHolds', { matterId: 'M-117' }),
  () => def.handler(args, ctx),
);
```

### Cache invalidation when you know the data changed

Hosts can punch a hole when an external write happens — *"the user just placed a hold, refresh tiles that count holds"*:

```ts
import { TileResultCache, tileCacheKey } from '@infra-tools/agentic-ui';

const cache = inject(TileResultCache);
cache.invalidate(tileCacheKey('tool', 'countOpenHolds', { matterId: 'M-117' }));

// Trigger a refresh on tiles that show open-holds counts — they'll
// miss the cache and re-fetch.
this.refreshTick.update((n) => n + 1);
```

### When to skip the cache

Don't set `cacheTtlMs` (or set it to `0`) when:

- The tile must always show fresh data (audit-integrity scores, current production stage).
- The tool has side effects (calls that mutate; don't cache the response).
- The data is small + the source is fast — the cache cost isn't worth the staleness risk.

The cache is **opt-in per tile**. The default is no cache — every fire hits the tool.

## 2. Tile annotations — *"leave a note for the team"*

Each tile accepts an optional `[annotations]` input plus emits `(annotate)` when the user posts a new note:

```ts
interface TileAnnotation {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}
```

```html
<mvk-dashboard-tile
  [tile]="tile"
  [annotations]="notes()"
  (annotate)="onAddNote($event)" />
```

```ts
onAddNote(e: { tileId: string; body: string }): void {
  // Chain-hash the note as a tool call so audit captures it.
  this.chat.sendMessage(
    `annotateTile(${e.tileId}): ${e.body}`,
  );
  // Or write directly to your store with the same id-scheme.
}
```

The tile:

- Shows a **💬 + count** badge when annotations exist.
- Click → expands a panel below the tile body listing every note with author + timestamp.
- Type into the new-note input + click **Post** → fires `(annotate)`.
- Cleared input on submit; host owns persistence.

This is a tiny UI piece, but its **architectural property** is the load-bearing thing:

> Every note posted is a tool call. Every tool call is chain-hashed. Every chain-hashed call carries the persona's audit attribution. So the dashboard's notes — what the team thinks about the numbers — are part of the same defensibility chain as the numbers themselves.

That's *exactly* the post-chat-surfaces premise: surfaces aren't reports, they're agent-participated artefacts.

## 3. Wiring annotations to persistence

Most apps want notes to survive page reload. The minimum:

```ts
@Injectable({ providedIn: 'root' })
export class TileNotesStore {
  private readonly _byTile = signal<Record<string, TileAnnotation[]>>({});
  readonly byTile = this._byTile.asReadonly();

  // Read-through to localStorage / IndexedDB / catalog server.
  load(): void {
    const raw = localStorage.getItem('tile-notes');
    if (raw) this._byTile.set(JSON.parse(raw));
  }

  add(tileId: string, body: string, author: string): TileAnnotation {
    const note: TileAnnotation = {
      id: `n-${Date.now()}`,
      author,
      body,
      createdAt: new Date().toISOString(),
    };
    this._byTile.update((cur) => ({
      ...cur,
      [tileId]: [...(cur[tileId] ?? []), note],
    }));
    localStorage.setItem('tile-notes', JSON.stringify(this._byTile()));
    return note;
  }
}
```

```ts
onAddNote(e: { tileId: string; body: string }): void {
  const author = inject(ACTIVE_PERSONA)();
  this.notes.add(e.tileId, e.body, author);
}

readonly notesForTile = computed(() => this.notes.byTile()[this.tile().id] ?? []);
```

The lib stays decoupled from the storage choice; you pick whatever fits your offline / multi-device story.

## 4. What the agent does with annotations

Once notes are tools, the agent can read them. Two patterns:

**A — Surface notes in the chat.** *"Show me Sarah's note on the privilege-rate tile"* → the agent reads the notes store + the tile registry, returns the matched note. No new infrastructure.

**B — Drive workflow.** A note with body `@partner please review` could fire an ADR-045 trigger (`webhook` kind, listening on a `notes` topic) that posts a message to the partner's Inbox. The trigger registry + the tile annotations compose without coupling.

## 5. The "agent uses the dashboard" property

P3.C unlocks the *interrogation* property the post-chat-surfaces plan named in §3 Pillar 3:

> *"On the production-throughput dashboard, find the week where redaction time spiked and explain it"*

The chat reads `DashboardRegistry.get('production-throughput')`, walks the tiles, identifies the tile invocation that produced the spike, **re-invokes that tool through the cache** (deduping against the rendered tile's recent fetch), and answers with the actual values + the note Sarah left two days ago.

The agent doesn't need a separate analytics surface. It uses the dashboard the same way the user does — through the same `DashboardRegistry` + the same `TileResultCache` + the same `TileNotesStore`.

## 6. What this slice does NOT do

- **Time-travel.** Replaying a dashboard "as of last Friday" needs the audit chain's historical state — server-side concern, out of the runtime tier per [ADR-010 D4](../adr/0010-platform-principles-and-license.md).
- **Per-cell drilldown.** Tiles drill down as a whole (via `TileDef.drilldown`). Per-cell hover-for-detail belongs on `<mvk-smart-cell>` (P1.2), not the dashboard tile.
- **Collaborative real-time editing.** Two users editing the same tile's notes concurrently is a conflict-resolution story for the catalog server, not the runtime tier.
- **Notes-as-comments-on-data-points.** Notes pin to a tile, not to a specific value or chart point. Per-datum annotations are a tile-author concern (the widget can render its own annotation overlay; nothing in the lib helps or hinders).

## 7. Reference

- **Service:** `TileResultCache` (`providedIn: 'root'`)
  - `read(key, ttlMs)` — `undefined` for miss / stale / ttl ≤ 0
  - `write(key, value)` — set
  - `track(key, factory)` — invoke once, dedupe concurrent waits, cache the result
  - `inflightFor(key)` — peek at an in-flight promise
  - `invalidate(key)` / `clear()` / `size()`
- **Key helper:** `tileCacheKey('tool' | 'data', identifier, argsOrQuery)` — stable string with sorted-key JSON
- **Types:** `TileAnnotation`, `DashboardTileAnnotate` (the `(annotate)` event payload)
- **Tests:** 10 cache specs + 4 annotation specs + 3 cross-instance cache specs = 17 new P3.C specs
- **Plan:** [post-chat-surfaces-plan §3 Pillar 3 P3.C](../plans/post-chat-surfaces-plan.md#p3-dashboards--production-pipeline-3-weeks)
- **Related:**
  - [User-built dashboards (P3.A)](./dashboards.md) — registry mechanics + canvas
  - [Conversational composition (P3.B)](./conversational-dashboards.md) — preview pane + version bump
  - [Proactive triggers + Inbox](./proactive-triggers-and-inbox.md) — pair note-as-tool-call with `TriggerRegistry` for active workflows
