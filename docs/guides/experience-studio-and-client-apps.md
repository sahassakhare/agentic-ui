# Experience Studio & Building Client Apps with the Agentic UI Framework

A practical, end-to-end guide to the **Agentic Experience Platform (AEP)**: how you
author a full application in the **Experience Studio** (no redeploy), and how you
stand up a **client host app** with the `@infra-tools/agentic-ui` framework that
renders those applications and drives them with a real LLM-backed assistant.

> **Audience.** Two roles, one platform:
> - **Experience authors** (business/solution engineers) compose applications in the
>   Studio UI — Part 1.
> - **App developers** (Angular) bootstrap the host app, register tools/widgets, and
>   wire in federated micro-frontends — Part 2.

---

## 1. The mental model

Everything the platform renders is a **capability** stored in the **catalog**. A
capability is just `{ kind, name, body }` — `kind` selects the shape, `body` is JSON.
Authoring never touches code or triggers a deploy: you edit capabilities in the Studio,
they persist to the catalog, and the running Hub picks them up over a live SSE stream.

The composition hierarchy:

```
Application  (kind: 'application')      ← the product a user opens
  └── Pages  (kind: 'page')            ← routed screens; a nav/route tree
        ├── type: 'shell'  (master)    ← header / sidenav / aside / footer chrome
        └── type: 'content'            ← a layout with regions
              └── Surfaces             ← slots that host any capability kind…
                    └── Capabilities   ← experience | dashboard | form | workflow |
                                          component | layout | (federated MFE widget)
```

- An **Application** binds a **route tree of Pages** + an optional **master (shell)**
  page + an **assistant** toggle + **personas**.
- A **Page** is either a **shell** (master chrome) or **content** (a layout whose
  regions hold **surfaces**).
- A **Surface** is a typed slot (`experience`, `dashboard`, `form`, `workflow`,
  `component`, `layout`) that points at another capability by `{ kind, name }` —
  including components served by a **federated micro-frontend**.

The three runtimes:

| Piece | What it is | Default port |
|---|---|---|
| **Experience Studio** | Authoring UI (this is where you build apps) | `:4600` |
| **Catalog service** | System of record for capabilities (`@infra-tools/agentic-catalog-server`) | `:8081` |
| **Experience Hub / runtime** | The client host app that renders applications | `:4700` |
| **AG-UI agent server** | Real LLM (e.g. Gemini) that backs the assistant | `:4111` |
| **SSO** (optional) | OIDC identity provider | `:9100` |
| **MFE remotes** | Federated micro-frontends (e.g. Matter Management) | e.g. `:4300` |

---

## 2. Part 1 — Authoring in the Experience Studio

Open the Studio at `http://localhost:4600`. The topbar nav (from `NAV` in
`app.component.ts`) exposes one registry per capability kind:

> Experiences · **Applications** · **Pages** · Components · Forms · Workflows ·
> **Decisions** · Prompts · Skills · Knowledge · Memory · Navigation · Tools ·
> Data Sources · Validation · Policy

Most of these are powered by a single generic screen, `CapabilityStudioComponent`
(`aes-capability-studio`), parameterized by a `StudioConfig` (see
`src/app/studio-configs.ts`). A few kinds have **dedicated visual designers**
(Applications, Pages, Decisions, Forms, Workflows).

### 2.1 The capability kinds

| Kind | Studio config | Authored by | Purpose |
|---|---|---|---|
| `application` | `APPLICATION_STUDIO` | **Application Designer** | The product: a nav/route tree of pages + assistant |
| `page` | `PAGE_STUDIO` | **Page Designer** | A screen — `content` (layout+surfaces) or `shell` (master) |
| `decision` | `DECISION_STUDIO` | **Decision Designer** | DMN-style decision table |
| `form` | `FORM_STUDIO` | **Form Designer** | Schema-driven form |
| `workflow` | — | **Workflow Designer** | Multi-step journey/wizard |
| `component` | `COMPONENT_STUDIO` | list/edit | A registered/federated component |
| `prompt` · `skill` · `knowledge` · `memory` · `navigation` · `tool` · `datasource` · `validation` | respective `*_STUDIO` | generic studio | Supporting capabilities |

Each capability moves through a **governed lifecycle**:
`draft → published → deprecated → disabled` (with restore). Only what an application
references and what a persona is allowed to see gets rendered in the Hub.

### 2.2 Create an Application

1. Go to **Applications** → **New**. Fill the `APPLICATION_STUDIO` fields: `title*`,
   `description`, `menu*` (JSON), `assistant` (JSON), `personas` (list).
2. Click **Design** to open the **Application Designer** (`aes-application-designer`,
   route `applications/:id/design`). Here you:
   - **Pick pages** to include (the designer calls `caps.listByKind('page')` and splits
     them into *content pages* vs `type === 'shell'` *masters*).
   - Set each row's **URL path** + **label**, and **drag to reorder**.
   - Choose a **master (shell) page**.
   - Toggle the **ag-ui assistant**.
3. **Save** writes the application `body`:

```jsonc
{
  "title": "Acme Operations Workspace",
  "description": "...",
  "master": "acme-shell",                 // name of a type:'shell' page
  "assistant": { "backend": "ag-ui", "enabled": true, "greeting": "How can I help?" },
  "personas": ["admin", "ops-manager"],
  "nav": [                                 // the route tree
    { "title": "Operations Overview", "path": "overview",  "page": "ops-overview-page", "order": 10 },
    { "title": "Employee Onboarding", "path": "onboard",   "page": "onboarding-page",   "order": 20 }
  ]
}
```

### 2.3 Author Pages — content vs shell

Open the **Page Designer** (`aes-page-designer`, route `pages/:id/design`). One
type-aware designer authors both page types with the same palette.

**Content page** (`type: 'content'`):
1. Pick a **layout template**: `single | two-column | sidebar-right | sidebar-left |
   stacked | grid`. This defines the **regions**.
2. Drag **surfaces** into regions. The palette is built from the catalog:
   `caps.listByKind('form' | 'workflow' | 'component')` and
   `experiences.list({ approvalState: 'approved' })`.
3. Set **props** per surface and **access** (`personas`, `scopes`).

**Shell page / master** (`type: 'shell'`): a master page is *also* a `kind:'page'` —
just a different `type`. You drop **shell components** (logo / header / sidenav /
footer / assistant) into the fixed shell regions `header`, `sidenav`, `aside`,
`footer` around the page-content outlet. Bind it to an application via the master
picker (§2.2).

Resulting `page` body:

```jsonc
{
  "title": "Operations Overview",
  "type": "content",                       // or 'shell'
  "layout": "sidebar-right",               // content only
  "regions": {
    "main":  [ { "kind": "dashboard",   "name": "ops-overview", "props": {} } ],
    "aside": [ { "kind": "component",   "name": "activity-feed" } ]
  },
  "access": { "personas": ["ops-manager"], "scopes": ["ops:read"] }
}
```

> **Surfaces host anything.** `kind` ∈ `experience | dashboard | form | workflow |
> component | layout`. A `component` surface can point at a **federated MFE widget**
> (see Part 2, §3.7) — the Studio composes it exactly like a local component.

### 2.4 Author a Decision table (DMN)

Open the **Decision Designer** (`aes-decision-designer`, route
`decisions/:id/design`). Define `inputs`, `outputs`, `rules`, and a **hit policy**,
with a live **Test** panel that runs the evaluator
(`decision/decision-eval.ts`).

- Operators: `any | == | != | > | < | >= | <= | in`
- Hit policies: `first | unique | collect`
- Rule shape: `{ when: { <input>: { op, value } }, then: { <output>: value } }`

```jsonc
{
  "hitPolicy": "first",
  "inputs":  [ { "name": "amount", "type": "number" }, { "name": "region", "type": "string" } ],
  "outputs": [ { "name": "route",  "type": "string" } ],
  "rules": [
    { "when": { "amount": { "op": ">", "value": 10000 } }, "then": { "route": "senior-review" } },
    { "when": { "region": { "op": "in", "value": ["EU","UK"] } }, "then": { "route": "eu-desk" } }
  ]
}
```

### 2.5 How the Studio talks to the catalog

All designers use `CapabilityCatalogService`
(`src/app/services/capability-catalog.service.ts`) against
`${environment.catalogBaseUrl}/v1/catalogs/{tenant}/capabilities`:

| Method | HTTP | Use |
|---|---|---|
| `listByKind(kind)` | `GET ?kind=` | palettes, lists |
| `get(id)` | `GET /:id` | load into a designer |
| `create({kind,name,body,tags?})` | `POST` | new capability |
| `update(id,{body?,lifecycle?,tags?})` | `PATCH /:id` | save / transition |
| `remove(id)` | `DELETE /:id` | soft-delete |

Studio env: `catalogBaseUrl: 'http://localhost:8081'`, `authMode: 'oidc'` (SSO on
`:9100`).

### 2.6 Enterprise designer capabilities

Each visual designer is built for real authoring, not toy demos:

- **Forms** — a form has an **action bar**, not a fixed Submit. Add any number of
  buttons, each bound to a *governed* capability: `submit` (validate + run),
  `reset`, `cancel`, `tool` (dispatch a governed tool with the form values),
  `action` (dispatch an `ActionDef`), `navigate`, or `emit`. A `kind:'form'`
  capability is compiled into a live `FormDef` by the runtime and **renders in the
  Hub** (fields → Zod schema; actions → the button bar).
- **Pages** — every surface (dashboard/form/component/experience) has a **universal
  props editor** (typed key/value, JSON-aware) — parameterize anything, not just the
  shell chrome. Surfaces **reorder** (▲▼) and **move across regions**. A `form`
  surface threads `initialValues` / `context` into the renderer.
- **Decisions** — inputs/outputs are **typed** (string / number / date / boolean)
  with type-correct comparison and type-aware operator menus; rules carry
  **annotations**; the `unique` hit policy **flags overlaps**; the test panel uses
  typed inputs.
- **Applications** — the nav is a **route tree**: nest entries (← / → indent-outdent),
  set a per-entry **icon**, and **scope entries to personas** (empty = everyone).
  The Hub renders the tree (indented) and filters by the current persona.
- **Workflows** — one **canvas editor** (the list's "New" creates an empty workflow
  and opens it). Steps chain or **branch** (`ConditionalNext`); a
  **validation panel** flags dead branch targets, unreachable steps, and
  non-terminating loops before save. A `kind:'workflow'` capability compiles into a
  `FormDef.workflow` and **renders in the Hub**.

**Governance in every designer** — a **lifecycle bar** (draft → published →
deprecated → disabled, with restore) is available directly in each designer, and an
**unsaved-changes guard** warns before you navigate away from a designer with
pending edits.

> **The two render bridges.** Historically only *dashboards* and *experiences* were
> compiled from the catalog into the Hub; catalog-authored *forms* and *workflows*
> showed "not registered." Both now have a `CatalogFormSource` / `CatalogWorkflowSource`
> compiler (mirroring `CatalogExperienceSource`) wired in the Hub's `app.config.ts`,
> so a form or workflow you author in the Studio actually renders and dispatches.

---

## 3. Part 2 — Building a client app with the framework

The library ships the *parts* (providers, chat shell, registries, renderers,
federation). You assemble a thin host app that binds them to your catalog + agent.
The reference host is `platform/agentic-experience-runtime` (the Hub) — mirror it.

### 3.1 Install

```bash
npm i @infra-tools/agentic-ui @infra-tools/agentic-ui-server
# optional, per need:
npm i @infra-tools/agentic-ui-mcp @infra-tools/agentic-ui-webmcp \
      @infra-tools/agentic-ui-server-stores @infra-tools/agentic-ui-opa-authorizer \
      @infra-tools/aep-embed-sdk
```

### 3.2 Bootstrap the platform

Wire providers in `app.config.ts`. This is the exact shape the Hub uses:

```ts
import { provideAgenticUiPlatform, provideAgUiBackend } from '@infra-tools/agentic-ui';
import { makeEnvironmentProviders } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgenticUiPlatform({
      widgets: [...widgets, ...dashboardWidgets, ...shellWidgets],
      tools: appTools,
      // A single active chat transport — a real LLM-backed AG-UI SSE server.
      transport: makeEnvironmentProviders([
        provideAgUiBackend({ url: environment.agentUrl }),
      ]),
      mcpUi: false,
    }),
    // catalog-driven routing: '' and '**' → the page host component
    provideRouter([
      { path: '', component: PageHostComponent },
      { path: '**', component: PageHostComponent },
    ]),
    provideAppInitializer(registerCatalog),   // hydrate capabilities from :8081
    // …dashboards, MFE registry, live-sync initializers (below)
  ],
};
```

> `provideAgUiBackend({ url })` returns `EnvironmentProviders` and registers the
> AG-UI SSE transport. Point `environment.agentUrl` at your agent server, e.g.
> `http://localhost:4111/agents/gemini/run`.

### 3.3 The app shell

The reference shell (`src/app/app.ts`, selector `app-root`) renders a CSS-grid shell
whose regions are filled from the application's **master (shell) page**, with a
`<router-outlet />` in the content region:

```
.r-header   → region 'header'      (app-header shell widget)
.mid        → [ sidenav ] 1fr [ aside ]
   .r-sidenav → region 'sidenav'
   .content   → <router-outlet />   ← the selected page renders here
   .r-aside    → region 'aside'      (assistant rail)
.r-footer   → region 'footer'
```

Each region slot is an `<app-surface-host [target]="s" />` that resolves a
`{ kind, name }` to the right renderer. If the application has no master page, the
shell falls back to `DEFAULT_SHELL` (`header: app-header`, `sidenav: app-sidenav`,
`aside: app-assistant`).

### 3.4 The assistant rail

The assistant is the framework's chat shell, mounted as a shell widget:

```html
<mvk-chat-shell mode="rail" [placeholder]="'Ask the assistant…'"></mvk-chat-shell>
```

`mode` ∈ `rail | pill | overlay | docked-bottom | assist-panel | hidden` (default
`rail`). It uses the transport you registered in §3.2, so with a real agent server
running the assistant streams tokens, calls tools, and renders generative UI.

### 3.5 Give the agent host tools

Tools are how the assistant *does* things in your app. Build them with `agenticTool`
and pass them to `provideAgenticUiPlatform({ tools })`. The Hub ships two
(`src/app/agentic/tools.ts`):

```ts
import { agenticTool } from '@infra-tools/agentic-ui';
import { z } from 'zod';

export const openApplication = agenticTool({
  name: 'openApplication',
  description: 'Open a workspace experience/page by name and navigate to it.',
  schema: z.object({ name: z.string() }),
  run: async ({ name }) => {
    const ok = shellApi.openExperience(name);        // navigates the host
    return ok ? { opened: true, name }
              : { opened: false, error: `Unknown: ${name}`, valid: shellApi.listMenu() };
  },
});

export const appTools = [listApplications, openApplication];
```

`shellApi` is a small bridge the shell component installs at construction
(`openExperience → navigateTo`, `listMenu → appSource.flatNav()`), so a tool the
agent calls actually drives the running UI.

### 3.6 Register widgets, forms, dashboards

Author host-native UI with the factory functions and register them via the platform
`widgets` array (or the registries directly):

```ts
import { agenticWidget, agenticForm, agenticWorkflow } from '@infra-tools/agentic-ui';

export const activityFeed = agenticWidget({
  name: 'activity-feed',
  component: ActivityFeedComponent,
  propsSchema: z.object({ limit: z.number().default(20) }),
});
```

These become **surfaces** the Studio can drop into page regions by `name`.

Available factories: `agenticTool`, `agenticWidget`, `agenticForm`,
`agenticWorkflow`, `agenticAction`, `agenticApproval`, `agenticIntent`,
`agenticDataSource`, plus capability factories `agenticPrompt`, `agenticSkill`,
`agenticKnowledge`, `agenticMemory`, `agenticNavigation`.

### 3.7 Consume a federated micro-frontend (MFE)

An MFE is built independently (its own repo/app) and **exposes a capability module**.
Producer side (`platform/matter-management-mfe/src/app/capability.ts`):

```ts
import { defineCapabilityModule, agenticWidget } from '@infra-tools/agentic-ui';

export const capability = defineCapabilityModule({
  remoteName: 'matter-management',
  version: '1.0.0',
  tools: [],
  components: [
    agenticWidget({ name: 'matter-dashboard', component: MatterDashboardComponent, propsSchema: anyProps }),
    agenticWidget({ name: 'matter-list',      component: MatterListComponent,      propsSchema: anyProps }),
    agenticWidget({ name: 'matter-report',    component: MatterReportComponent,    propsSchema: anyProps }),
  ],
});
```

`federation.config.js` (Native Federation) exposes it and shares the framework as a
singleton:

```js
module.exports = withNativeFederation({
  name: 'matter-management',
  exposes: { './Capability': './platform/matter-management-mfe/src/app/capability.ts' },
  shared: {
    ...shareAll({ singleton: true, strictVersion: true, requiredVersion: 'auto' }),
    '@infra-tools/agentic-ui': { singleton: true, strictVersion: false, requiredVersion: 'auto' },
  },
});
```

Host side — discover remotes and load their capability module at boot:

```ts
provideStaticJsonMfeRegistry({ url: 'mfes.json' }),
// initializer:
const remotes = await client.discover(environment.mfeEnv);
for (const remote of remotes) {
  await loadRemoteCapabilities({
    remote,
    loader: () => loadRemoteModule<{ capability: CapabilityModule }>({
      remoteName: remote.remoteName,
      exposedModule: './Capability',
    }),
  });
}
```

Once loaded, the remote's widgets (`matter-dashboard`, …) are ordinary surfaces — the
Studio composes them and the Hub renders them like any local component.

### 3.8 Live sync

The Hub hydrates and then keeps in sync with the catalog over SSE. Initializers wire
`CatalogExperienceSource`, `ApplicationSource`, and `PageSource`, each with
`startLiveSync()`, so publishing a change in the Studio surfaces in the Hub without a
reload.

### 3.9 Runtime environment

```ts
// platform/agentic-experience-runtime/src/environments/environment.ts
export const environment = {
  catalogBaseUrl: 'http://127.0.0.1:8081',
  tenant: 'acme',
  applicationName: 'ediscovery-matters', // which application this host opens
  mfeEnv: 'dev',
  agentUrl: 'http://localhost:4111/agents/gemini/run',
  authMode: 'disabled',                  // or 'oidc'
};
```

---

## 4. End-to-end walkthrough

1. **Seed / start** the catalog (`:8081`) and confirm
   `GET /v1/catalogs/acme/capabilities?kind=application` returns your app.
2. In the **Studio** (`:4600`): create pages (a `shell` master + a couple of
   `content` pages with surfaces), then an **Application** binding them; **publish**.
3. Start the **agent server** (`:4111`) so the assistant has a real backend.
4. Open the **Hub** (`:4700`): the shell renders your master chrome, the nav lists the
   app's pages, each page renders its surfaces, and the assistant rail can call your
   host tools (e.g. "open the onboarding page").
5. Edit a page in the Studio and **publish** → the Hub reflects it live (SSE).

---

## 5. Running locally

| Service | Command (from repo root) | URL |
|---|---|---|
| Catalog service | `cd platform/agentic-catalog-server && npm start` | `:8081` |
| Experience Studio | `npx ng serve agentic-experience-studio` | `:4600` |
| Experience Hub | `npx ng serve agentic-experience-runtime` | `:4700` |
| Matter-Management MFE | `npx ng serve matter-management-mfe --port 4300` | `:4300` |
| Agent server | (your AG-UI/Gemini server) | `:4111` |

> Native Federation dev servers should bind `0.0.0.0` (not just IPv6 `[::1]`) so
> `127.0.0.1` works in the browser.

---

## 6. Package reference (the `@infra-tools` libraries)

| Package | What it gives you |
|---|---|
| `@infra-tools/agentic-ui` | The framework: providers, chat shell, registries, renderers, factories, federation |
| `@infra-tools/agentic-ui-server` | Server helpers: AG-UI SSE route handler, Agent interface, thread store |
| `@infra-tools/agentic-ui-server-stores` | Redis/Postgres adapters for thread state |
| `@infra-tools/agentic-ui-server-registrar` | Capability registration helpers for the server |
| `@infra-tools/agentic-catalog-server` | The catalog control-plane service (Hono + Postgres/RLS + JWT) |
| `@infra-tools/agentic-ui-mcp` | MCP server bridge for agentic-ui tools |
| `@infra-tools/agentic-ui-webmcp` | WebMCP (in-browser MCP) integration |
| `@infra-tools/agentic-ui-opa-authorizer` | OPA-based capability authorization |
| `@infra-tools/agentic-ui-copilot-skill` · `-copilot-studio-connector` · `-m365-agents` · `-teams-bot` | Microsoft Copilot / M365 / Teams integrations |
| `@infra-tools/aep-embed-sdk` | Embed a governed experience into a third-party page |
| `@infra-tools/mvk` | `mvk` CLI |
| `@infra-tools/agentic-platform-schematics` | `ng add` schematics that scaffold this whole monorepo |

---

## 7. Scaffolding a new workspace

To generate a fresh monorepo pre-wired with the platform (library, Studio, Hub,
catalog, examples — security-sensitive scripts excluded):

```bash
npm i -D @infra-tools/agentic-platform-schematics
npx schematics @infra-tools/agentic-platform-schematics:scaffold --directory=my-app
# or, in an existing workspace:
ng add @infra-tools/agentic-platform-schematics
```

See the package's `EXCLUDED.md` for the (security) files the scaffold intentionally
omits.

---

## Appendix — key files

| Concern | File |
|---|---|
| Studio routes | `platform/agentic-experience-studio/src/app/app.routes.ts` |
| Studio configs | `platform/agentic-experience-studio/src/app/studio-configs.ts` |
| Application Designer | `platform/agentic-experience-studio/src/app/pages/application-designer.component.ts` |
| Page Designer | `platform/agentic-experience-studio/src/app/pages/page-designer.component.ts` |
| Decision Designer / eval | `platform/agentic-experience-studio/src/app/pages/decision-designer.component.ts`, `.../decision/decision-eval.ts` |
| Catalog client | `platform/agentic-experience-studio/src/app/services/capability-catalog.service.ts` |
| Host providers | `platform/agentic-experience-runtime/src/app/app.config.ts` |
| Host shell | `platform/agentic-experience-runtime/src/app/app.ts` |
| Host tools | `platform/agentic-experience-runtime/src/app/agentic/tools.ts` |
| Framework entry | `projects/agentic-ui/src/public-api.ts` |
| `provideAgenticUiPlatform` | `projects/agentic-ui/src/lib/platform/provide-agentic-platform.ts` |
| `provideAgUiBackend` | `projects/agentic-ui/src/lib/backends/ag-ui/ag-ui-backend.ts` |
| Chat shell | `projects/agentic-ui/src/lib/components/chat-shell.component.ts` |
| MFE capability module | `projects/agentic-ui/src/lib/mfe/capability-module.ts` |
