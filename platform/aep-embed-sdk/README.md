# @infra-tools/aep-embed-sdk

Consume **published** Agentic Experience Platform experiences in any external
site or portal — headlessly. The SDK fetches a frozen *render manifest* (the
workflow steps, widget names, and branch conditions) for a published experience;
your portal renders it with **its own components**. No platform login, no
framework coupling (zero dependencies — works in React, Vue, Svelte, plain DOM,
or server-side).

## The model

```
Product owner (Studio)      Catalog                       Your portal
──────────────────────      ───────                       ───────────
approve → PUBLISH      →     freezes a render manifest  →  createEmbedClient()
(pins version, mints         behind an origin-pinned       .getManifest(name)
 an embed key)               embed key                     → render with YOUR components
```

The platform ships **data + control-flow**; your portal ships **pixels**.

## Install

```bash
npm install @infra-tools/aep-embed-sdk
```

## Usage

```ts
import { createEmbedClient, resolveNext, stepById } from '@infra-tools/aep-embed-sdk';

const client = createEmbedClient({
  catalogUrl: 'https://catalog.example.com',
  tenant: 'acme',
  key: 'emb_…',            // the public, origin-pinned embed key from `publish`
});

const manifest = await client.getManifest('support-ticket');

// Drive the journey with your own widgets:
let stepId = manifest.workflow?.steps[0]?.id ?? null;
const state = {};
while (stepId) {
  const step = stepById(manifest.workflow!.steps, stepId)!;
  renderYourWidget(step.widget, state);        // ← your component, keyed by name
  stepId = resolveNext(step.next, state);       // branch conditions evaluated client-side
}
```

See [`examples/react-portal/App.tsx`](./examples/react-portal/App.tsx) for a full React example.

## Security

- The **embed key** is read-only, per-publication, **origin-pinned**, and revocable.
  It only ever resolves the one *published* experience it was minted for.
- The catalog serves a **frozen snapshot** — draft/unapproved/other-tenant content
  is unreachable through this endpoint by construction.
- Browsers send `Origin` automatically; the catalog enforces it against the
  publication's allow-list. Server-side callers may pass `origin` explicitly.

## API

- `createEmbedClient(config) → { getManifest(name) }` — fetch a published manifest.
- `resolveNext(next, state)` / `evalWorkflowCondition` / `isConditionalNext` / `stepById`
  — walk a workflow's steps and evaluate its branches.
- Types: `PublishedManifest`, `WorkflowStepJson`, `ConditionalNext`, `ManifestWidget`, …
- `EmbedError { status, code }` — thrown on non-2xx / network failure.
