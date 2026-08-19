# Legal Matter Intake — framework-free consumer demo

A working example of consuming a **published Agentic Experience Platform experience**
from a host that uses **no `@infra-tools/agentic-ui` and no UI framework** — just plain
DOM + the zero-dependency [`@infra-tools/aep-embed-sdk`](../../).

It's the answer to *"can we build a Hub-like consumer without the agentic-ui library?"* —
yes: the **platform ships data + control-flow** (the workflow steps and the conflict-check
branch, as a frozen render manifest); **this portal ships the pixels** (its own components).

## What it shows

A law-firm new-matter intake wizard that walks a workflow:

```
Client → Matter → Conflict check ──(no conflict)──▶ Fees → Review → Open matter
                        └─────────(conflict found)──▶ Waiver ─▶ Fees → …
```

- The **steps and the branch are the manifest's**, walked with the SDK's `resolveNext(step.next, state)`.
- Each step is rendered by **this portal's own widget**, keyed by the manifest's `widget` name — none of the platform's renderers are used.
- The conflict check branches declaratively: enter an opposing party that matches the firm's
  book of business (e.g. **`Meridian Capital`**) to trip the conflict → waiver path; anything
  else clears straight through.
- "View the manifest driving this" reveals the render manifest that powers it.

## Run it

It's a single static file — serve the folder over HTTP (ES modules need `http://`, not `file://`):

```bash
cd platform/aep-embed-sdk/examples/legal-intake-portal
npx serve .            # or: python3 -m http.server 8000
# open http://localhost:3000  (or :8000)
```

## Wiring it to a live catalog

The demo **inlines** the SDK's engine and a sample manifest so it runs offline. In a real
portal you'd install the SDK and fetch the manifest instead:

```bash
npm install @infra-tools/aep-embed-sdk
```

```ts
import { createEmbedClient, resolveNext, stepById } from '@infra-tools/aep-embed-sdk';

const client = createEmbedClient({
  catalogUrl: 'https://catalog.example.com', // or http://localhost:8081 in dev
  tenant: 'acme',
  key: 'emb_…',                              // the origin-pinned embed key, minted at publish time
});

const manifest = await client.getManifest('legal-intake-matter');
// then render manifest.workflow.steps with YOUR components, advancing with resolveNext(step.next, state)
```

To produce `legal-intake-matter`, author the workflow in the **Experience Studio** (Workflow
Designer — the conflict branch is a decision/branch step), publish it, and copy the embed key.

## The trade-off

The embed SDK gives you the **structure and control-flow**, not rendering or an assistant.
You own every component and any AI you add. If you want the built-in renderers, federated
components, and the ag-ui assistant, that's the full Experience Hub (which does use
`@infra-tools/agentic-ui`).
