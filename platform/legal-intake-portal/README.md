# Legal Matter Intake — Angular consumer (no agentic-ui)

A standalone **Angular application** that consumes a published Agentic Experience
Platform experience using only the zero-dependency
[`@infra-tools/aep-embed-sdk`](../aep-embed-sdk) — **not** `@infra-tools/agentic-ui`.

It's a "Hub without the framework": the platform ships the **data + control-flow**
(the workflow steps and the conflict-check branch, as a frozen render manifest);
this app ships the **pixels** — its own Angular components.

## What it is

A law-firm new-matter intake wizard:

```
Client → Matter → Conflict check ──(no conflict)──▶ Fees → Review → Open matter
                        └─────────(conflict found)──▶ Waiver ─▶ Fees → …
```

- **`src/app/manifest.ts`** — the published render manifest (inlined so it runs
  offline; the header comment shows the live `createEmbedClient().getManifest()` wiring).
- **`src/app/intake.store.ts`** — the runner: an Angular signal store that walks the
  manifest with the SDK's `resolveNext(step.next, state)` and branches on `conflictFound`.
- **`src/app/steps.ts`** — the portal's **own** standalone components, one per manifest
  `widget` name (`legal-client-form`, `legal-conflict-check`, …). No platform renderers.
- **`src/app/app.ts`** — the shell (masthead, stepper, footer) that mounts the active
  step via `ngComponentOutlet`, keyed by the manifest's widget name.

The only platform import is the SDK:

```ts
import { resolveNext, stepById, type PublishedManifest } from '@infra-tools/aep-embed-sdk';
```

## Run

```bash
npx ng serve legal-intake-portal      # http://localhost:4800
```

Enter an opposing party of **`Meridian Capital`** (in the firm's book of business) on
the Matter step to trip the conflict → waiver branch; any other name clears straight
through. "View the manifest driving this" shows the workflow that powers it.

## Wire it to a live catalog

Replace the inlined `MANIFEST` with a fetch:

```ts
import { createEmbedClient } from '@infra-tools/aep-embed-sdk';
const client = createEmbedClient({ catalogUrl: 'http://localhost:8081', tenant: 'acme', key: 'emb_…' });
const manifest = await client.getManifest('legal-intake-matter');
```

Author `legal-intake-matter` in the **Experience Studio** (Workflow Designer — the
conflict path is a branch step) and publish it to mint the embed key.

## The trade-off

You get the structure and control-flow, not rendering or an assistant — you own every
component. For the built-in renderers, federated components, and the ag-ui assistant,
that's the full Experience Hub (which uses `@infra-tools/agentic-ui`).
