# Multi-pod ApprovalRegistry — Redis-backed, cross-pod-consistent

Pair Capability F4 (HITL approval) with M1 R2 (`RegistryProviderHook`) + M1 R3 (`RedisThreadStateStore`) so an approval decided in one pod is visible from every other pod within seconds — without changing any consumer code.

This is the **worked example** referenced as out-of-scope in [ADR-011](../adr/0011-registry-provider-hook.md). It assumes you've already shipped the F4 stack — see [approval-flow.md](./approval-flow.md) — and you're now scaling out from a single pod.

---

## Why this matters

In a single-pod deployment, `ApprovalRegistry` lives in memory; every reader sees every writer's effect immediately. That's the [v3 plan](../plans/platform-evolution-plan.md)'s embedded-first default and works perfectly until you add a load balancer in front.

The moment you scale horizontally:

- **Pod A** queues an approval (paralegal asks to release HOLD-001).
- The next request lands on **Pod B** (load balancer round-robin).
- **Pod B's `ApprovalRegistry`** doesn't have the new entry — `signal()` returns the old list, the `/approvals` page is stale, the F4 intercept doesn't see the pending decision.

The fix is one of:

1. **Sticky sessions.** Pin every user's traffic to one pod. Works; ugly; doesn't help with admin views that span tenants.
2. **Periodic poll.** Each pod polls Redis every N seconds, replays writes into its local registry. Simple; eventual consistency window of N seconds.
3. **Pub/sub.** Pod A writes; Redis publishes; Pod B subscribes + replays. Sub-second consistency.

This cookbook documents option (3). Option (2) is a 1-line change away if you don't want a pub/sub channel.

---

## Architecture

Three moving pieces, each from a different M1 slice:

```
┌──────────────────────────────────┐  ┌──────────────────────────────────┐
│ Pod A                            │  │ Pod B                            │
│  ApprovalRegistry  (in-memory)   │  │  ApprovalRegistry  (in-memory)   │
│        │                         │  │        ▲                         │
│        │ setProviderHook(hook)   │  │        │ subscriber re-registers │
│        ▼                         │  │        │ on Redis pub/sub event  │
│  RedisApprovalHook               │  │        │                         │
│        │                         │  │  RedisApprovalSubscriber         │
│        │ writes to Redis +       │  │        ▲                         │
│        │ publishes to channel    │  │        │                         │
│        ▼                         │  │        │                         │
└────────┼─────────────────────────┘  └────────┼─────────────────────────┘
         │                                     │
         ▼                                     │
   ┌────────────────────────────────────────────┴───────┐
   │ Redis                                              │
   │   approvals:<tenant>:<approvalId> → JSON state     │
   │   PUBLISH approvals:<tenant>  ←  on every write    │
   └────────────────────────────────────────────────────┘
```

The pieces:

- **`RegistryProviderHook`** ([ADR-011](../adr/0011-registry-provider-hook.md)) — sync, opt-in, write-through mirror. In-memory state stays authoritative; the hook fires after every register / remove. Hook failures land on telemetry, never propagate.
- **`RedisThreadStateStore`** ([ADR-012](../adr/0012-thread-state-store-adapters.md)) — Redis-backed key/value store with TTL. Caller-managed `ioredis` client. Per-tenant prefix.
- **Redis pub/sub** — `PUBLISH` on every approval event; subscriber replays into the local in-memory registry. Subscriber lifecycle is the host's concern (start on boot, dispose on shutdown).

Both pieces are Apache 2.0 + already shipped. This cookbook glues them together.

---

## Code

### 1. The hook

```ts
// src/server/redis-approval-hook.ts
import type Redis from 'ioredis';
import type { ApprovalDef, RegistryProviderHook } from '@maverick/agentic-ui';

export class RedisApprovalHook implements RegistryProviderHook<ApprovalDef> {
  constructor(
    private readonly redis: Redis,
    private readonly tenantId: string,
  ) {}

  onRegister(def: ApprovalDef): void {
    const key = `approvals:${this.tenantId}:${def.name}`;
    // Fire-and-forget. Errors land on telemetry via the registry's
    // invokeHook wrapper — the in-memory write has already succeeded.
    void this.redis.set(key, JSON.stringify(def), 'EX', 86_400);
    // PUBLISH on the per-tenant channel so other pods replay this entry
    // into their local registries.
    void this.redis.publish(this.channel(), JSON.stringify({
      kind: 'register',
      def,
    }));
  }

  onRemove(name: string): void {
    void this.redis.del(`approvals:${this.tenantId}:${name}`);
    void this.redis.publish(this.channel(), JSON.stringify({
      kind: 'remove',
      name,
    }));
  }

  onRemoveBySource(source: string): void {
    // Per-entry onRemove already cleaned up the in-memory + Redis
    // entries. Use the batch hook to publish a single unload event
    // (other pods can sweep their own state without N round-trips).
    void this.redis.publish(this.channel(), JSON.stringify({
      kind: 'remove-by-source',
      source,
    }));
  }

  private channel(): string {
    return `approvals:${this.tenantId}`;
  }
}
```

### 2. The subscriber

The subscriber receives pub/sub events and replays them into the local `ApprovalRegistry`. **Critical:** subscribers should ignore events that originated from their own writes — otherwise every write loops back as a duplicate register. The simplest dedup is a per-pod node-id; a hook annotates outgoing events with the node id, the subscriber drops events that match.

```ts
// src/server/redis-approval-subscriber.ts
import type Redis from 'ioredis';
import type { ApprovalRegistry, ApprovalDef } from '@maverick/agentic-ui';

interface PubSubEvent {
  readonly kind: 'register' | 'remove' | 'remove-by-source';
  readonly originPod: string;     // sender pod's id; receiver compares
  readonly def?: ApprovalDef;     // for 'register'
  readonly name?: string;         // for 'remove'
  readonly source?: string;       // for 'remove-by-source'
}

export class RedisApprovalSubscriber {
  private active = true;

  constructor(
    private readonly redis: Redis,    // a SECOND ioredis client; pub/sub blocks the connection
    private readonly registry: ApprovalRegistry,
    private readonly tenantId: string,
    private readonly podId: string,
  ) {}

  async start(): Promise<void> {
    await this.redis.subscribe(`approvals:${this.tenantId}`);
    this.redis.on('message', (channel, raw) => {
      if (!this.active) return;
      let event: PubSubEvent;
      try {
        event = JSON.parse(raw);
      } catch {
        return;  // malformed — ignore
      }
      if (event.originPod === this.podId) return;  // our own write
      this.apply(event);
    });
  }

  async stop(): Promise<void> {
    this.active = false;
    await this.redis.unsubscribe(`approvals:${this.tenantId}`);
  }

  private apply(event: PubSubEvent): void {
    switch (event.kind) {
      case 'register':
        if (event.def) this.registry.register(event.def);
        break;
      case 'remove':
        // Removal-by-name doesn't have a top-level method; the disposer
        // returned from register is private. Pattern: register a fresh
        // copy with a noop body, then dispose it. OR: extend
        // ApprovalRegistry with a removeByName method (out of scope here).
        this.registry.removeBySource(`pubsub:${event.name}`);
        break;
      case 'remove-by-source':
        if (event.source) this.registry.removeBySource(event.source);
        break;
    }
  }
}
```

### 3. Wiring it all together

```ts
// src/server/main.ts
import Redis from 'ioredis';
import { ApprovalRegistry } from '@maverick/agentic-ui';
import { RedisApprovalHook } from './redis-approval-hook';
import { RedisApprovalSubscriber } from './redis-approval-subscriber';

const podId = process.env.HOSTNAME ?? `pod-${Math.random().toString(36).slice(2, 8)}`;

// Two clients: one for writes / pub, one for subscribe (subscribe blocks
// the connection from doing anything else — ioredis convention).
const writer = new Redis(process.env.REDIS_URL!);
const subscriber = new Redis(process.env.REDIS_URL!);

const tenantId = 'acme-corp';   // or however you scope tenants

// 1. Wire the hook into the registry. Both must run in an Angular
//    injection context; in a Node Hono server you typically expose
//    the registry singleton via a small bootstrap module.
const approvalRegistry = injector.get(ApprovalRegistry);
approvalRegistry.setProviderHook(new RedisApprovalHook(writer, tenantId));

// 2. Start the subscriber so this pod replays other pods' writes.
const sub = new RedisApprovalSubscriber(subscriber, approvalRegistry, tenantId, podId);
await sub.start();

// 3. On shutdown, stop the subscriber and close clients.
process.on('SIGTERM', async () => {
  await sub.stop();
  await Promise.all([writer.quit(), subscriber.quit()]);
});
```

---

## Caveats

### Eventual consistency

Pod A's write reaches Pod B's local registry **only after** the Redis pub/sub round-trip completes. Latency is typically 5–50 ms intra-region, can spike under Redis contention. UI consequence: a paralegal who clicked Approve on Pod B might not see "✓ approved" reflected in Pod A's `/approvals` view for ~50 ms. Acceptable for almost every workflow; the few that aren't (high-frequency contention on a single record) are anti-patterns the F4 design wasn't optimized for.

### Hook errors

The lib catches any throw from `onRegister` / `onRemove` / `onRemoveBySource` and emits `agentic.registry.hook_error` telemetry. **Pipe this to your alerting**; otherwise a Redis outage silently degrades to single-pod behaviour without anyone noticing.

```ts
// e.g., in your AGENTIC_TELEMETRY_SINK adapter
if (event.name === 'agentic.registry.hook_error') {
  alertPager.fire({ severity: 'P2', detail: event.attributes });
}
```

### Self-loop dedup

The `originPod` field is the simplest dedup. If you'd rather have a single pub/sub topic per pod (no fan-in routing), use that approach instead — but it scales worse with pod count. The `originPod` model keeps things simple and works to ~50 pods comfortably.

### Conflict resolution on simultaneous writes

Two pods writing the same `approvalId` simultaneously (e.g., paralegal on Pod A approves; lead-counsel on Pod B approves at exactly the same time) end up writing to Redis twice; the SECOND write wins. If your tenant has approval policies where this matters, add a CAS check (`SET NX` on the entry's lifecycle field) at the hook layer. F4's typical workflows are bounded enough that "last writer wins" suffices.

### TTL

`RedisThreadStateStore` defaults to 24-hour TTL. Approvals decided after 24 hours of no activity will fall out of Redis. The in-memory authoritative state in the deciding pod stays; OTHER pods will simply not see the entry. For approvals with longer SLAs, set `ttlSeconds` higher or `null` (with a periodic sweeper for capacity).

---

## Test plan

End-to-end test (uses `testcontainers` — not yet in CI; run locally):

```ts
import { GenericContainer } from 'testcontainers';
import Redis from 'ioredis';
import { Test } from '@nestjs/testing';
// or your equivalent server bootstrap

describe('cross-pod approval propagation', () => {
  let redis: GenericContainer;
  beforeAll(async () => {
    redis = await new GenericContainer('redis:7').withExposedPorts(6379).start();
  });

  it('pod B sees pod A\'s approval after pub/sub delivers', async () => {
    const url = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    const podA = await bootstrapPod({ redisUrl: url, podId: 'A' });
    const podB = await bootstrapPod({ redisUrl: url, podId: 'B' });

    podA.approvals.register({ approvalId: 'TEST-1', state: 'pending' /* ... */ });
    await waitFor(() => podB.approvals.list().some((a) => a.name === 'TEST-1'), 1000);

    expect(podB.approvals.list().map((a) => a.name)).toContain('TEST-1');
  });
});
```

The unit-test surface is already covered by the `RegistryProviderHook` conformance suite in [`registry-base.spec.ts`](../../projects/agentic-ui/src/lib/registries/registry-base.spec.ts) — every registry passes the suite both with and without a hook.

---

## Production checklist

Before flipping a real deployment to multi-pod with this stack:

- [ ] Two Redis clients per pod (one for write, one for subscribe). `ioredis` blocks the connection during subscribe.
- [ ] Per-tenant key prefix + per-tenant pub/sub channel. Don't share state across tenants — RLS-equivalent isolation lives in the key shape.
- [ ] `agentic.registry.hook_error` wired to alerting. Don't fail silently.
- [ ] Dedup mechanism (`originPod` or per-pod channel). Without it, every write loops back as a duplicate register.
- [ ] Subscriber start *before* the first request handler binds. Otherwise the first ~few seconds of traffic show stale state on this pod.
- [ ] Subscriber stop on `SIGTERM` (graceful shutdown). Otherwise Redis sees half-closed connections and you'll burn through your `maxclients`.
- [ ] TTL chosen with awareness of your longest-lived approval. 24-hour default is right for most; high-friction workflows want 7 days or `null` + sweeper.
- [ ] If you're on Redis Cluster, make sure all keys for a tenant hash to the same slot (use hash tags: `approvals:{<tenant>}:<approvalId>`).

---

## Related

- [ADR-011 — `RegistryProviderHook`](../adr/0011-registry-provider-hook.md) — design rationale + restricted-class allow-list
- [ADR-012 — `ThreadStateStore` adapters](../adr/0012-thread-state-store-adapters.md) — sibling-package design + caller-managed lifecycle
- [`@maverick/agentic-ui-server-stores`](../../projects/agentic-ui-server-stores/README.md) — the package this cookbook depends on
- [F4 approval flow](./approval-flow.md) — single-pod baseline this cookbook scales out from
- [docs/architecture/platform-seams.md](../architecture/platform-seams.md) — `setProviderHook` + `ThreadStateStore` documented as Tier 1.5 / Tier 2 contracts
- [docs/plans/platform-evolution-plan.md](../plans/platform-evolution-plan.md) §4.1 R2–R3 — the v3 plan slices that produced this composition
