# Agentic Experience Hub (runtime)

The **client host app** that renders a Studio-authored application at runtime
(`:4700`). It reads capabilities from the catalog (`:8081`), assembles the app
**shell → pages → surfaces**, and drives an LLM-backed assistant. Built with the
`@infra-tools/agentic-ui` framework + Native Federation.

> How this fits together, and how to build your own host app, is in
> [docs/guides/experience-studio-and-client-apps.md](../../docs/guides/experience-studio-and-client-apps.md).

## What it does

- **App shell** (`src/app/app.ts`) — a CSS-grid shell whose `header/sidenav/aside/
  footer` regions come from the application's **master (shell) page**, with a
  `<router-outlet>` for the selected page and an **app switcher**.
- **Surfaces** (`src/app/render/surface-host.component.ts`) — each page region slot
  resolves a `{ kind, name }` to a renderer: `experience`/`dashboard` →
  `<app-experience-host>` (planned + access-gated), `form` → `<mvk-form-renderer>`,
  `workflow` → `<mvk-workflow-renderer>`, `component`/`mfe` → `<mvk-widget-container>`,
  `layout` → `<mvk-workspace-layout>`. Per-surface **props** are threaded in.
- **Assistant rail** — `<mvk-chat-shell mode="rail">` backed by a real AG-UI SSE
  server (`environment.agentUrl`), with host tools (`openApplication`, …).

## Catalog → runtime bridges

The runtime compiles catalog bodies into live definitions and keeps them in sync
over SSE (see `src/app/catalog/`):

| Source | Kind | Renders |
|---|---|---|
| `CatalogExperienceSource` | `experience` | via `ExperiencePlanner` |
| `CatalogFormSource` | `form` | compiles `body.schema` → a `FormDef` (fields → Zod, actions → button bar) |
| `CatalogWorkflowSource` | `workflow` | compiles `body.workflow.steps` → a `FormDef.workflow` |
| `ApplicationSource` / `PageSource` | `application` / `page` | nav tree (incl. nested + persona-scoped) + page host |

Dashboards are host-shipped defs flagged by a catalog experience tag. MFEs are
Native-Federation remotes discovered from `mfes.json` and loaded via
`loadRemoteCapabilities` into `ComponentRegistry`.

## Run

```bash
# 1) catalog backend (JDK 21) — platform/agentic-catalog-service/README.md
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
(cd ../agentic-catalog-service && mvn spring-boot:run)     # :8081

# 2) the Hub (Native Federation dev server)
ng serve agentic-experience-runtime                        # http://localhost:4700
```

Config in `src/environments/environment.ts`: `catalogBaseUrl` (`:8081`), `tenant`
(`acme`), `applicationName` (which app to open), `agentUrl` (the AG-UI server, e.g.
`http://localhost:4111/agents/gemini/run`), `mfeEnv`. The assistant degrades
gracefully if the agent server is down. Only **published** capabilities render, so
new Studio-authored capabilities appear after they're approved + published.

> Native-Federation dev servers bind `0.0.0.0` (not just IPv6 `[::1]`) so
> `127.0.0.1:4700` works in the browser — already set in `angular.json`.
