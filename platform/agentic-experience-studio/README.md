# Agentic Experience Studio

The **authoring app** for the Agentic Experience Platform (`:4600`). Business and
solution engineers compose whole applications — nav trees of pages, each hosting
surfaces backed by governed capabilities — plus forms, workflows, decisions, and
the supporting registries. It talks to the catalog service
(`/v1/catalogs/:tenant/…`, default `:8081`) over HTTP.

> A full walkthrough — authoring in the Studio and building a client app with the
> `@infra-tools/agentic-ui` framework — is in
> [docs/guides/experience-studio-and-client-apps.md](../../docs/guides/experience-studio-and-client-apps.md).

## The designers

Five first-class visual designers, plus a generic studio for the other kinds:

| Route | Designer | Authors |
|---|---|---|
| `/applications/:id/design` | **Application Designer** | a `kind:'application'` — a **nested nav route tree** of pages (indent/outdent), per-entry **icons** + **persona-scoping**, master (shell) page, assistant toggle |
| `/pages/:id/design` | **Page Designer** | a `kind:'page'` — `content` (layout + surfaces) or `shell` (master); a **universal per-surface props editor** (any surface, JSON-typed), reorder (▲▼) + move across regions |
| `/forms/:id/design` | **Form Designer** | a `kind:'form'` — fields + a multi-button **action bar** (submit/reset/cancel/tool/action/navigate/emit), live preview |
| `/decisions/:id/design` | **Decision Designer** | a `kind:'decision'` — DMN table with **typed I/O** (string/number/date/boolean), type-aware operators, rule notes, unique-conflict detection, a typed test panel |
| `/workflows/:id/design` | **Workflow Designer** | a `kind:'workflow'` — one canvas editor; steps chain or **branch** (`ConditionalNext`); **validation-before-save** (dead targets, unreachable, loops) |
| `/{prompts,skills,knowledge,memory,navigation,tools,datasources,validations,components}` | **Capability Studio** | the generic kinds (typed inputs + JSON), driven by `studio-configs.ts` |

Authored forms and workflows **render in the Hub** — the runtime compiles a
`kind:'form'`/`kind:'workflow'` body into a live definition (see the Hub's
`CatalogFormSource` / `CatalogWorkflowSource`).

## Governance (every capability)

The catalog gives every capability a governed lifecycle; the Studio surfaces it in
each designer via a shared **approval bar** (`lifecycle-bar.component.ts`) +
**History panel** (`history-panel.component.ts`), wired through
`governance-actions.ts`:

- **Approval review chain** — `draft → submit → review → approve → publish`.
  Submit/Approve/Reject/Revoke are shown per state; **Approve/Reject are gated by an
  approver role**; **Publish is disabled until approved**.
- **Version history + rollback + diff** — the History panel lists immutable
  snapshots, restores any (rollback), and shows a changed-keys compare vs latest.
- **Optimistic concurrency** — saves send `If-Match` (the loaded version); a
  conflicting write surfaces a "changed elsewhere — reload" toast (HTTP 412).
- **Unsaved-changes guard** — leaving a designer with pending edits prompts first.

## Run

```bash
# 1) the catalog backend (JDK 21) — see platform/agentic-catalog-service/README.md
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
(cd ../agentic-catalog-service && mvn spring-boot:run)   # :8081

# 2) the studio
ng serve agentic-experience-studio                       # http://localhost:4600
```

`src/environments/environment.ts#catalogBaseUrl` points at the catalog; in the
default `authMode:'disabled'` you just type a tenant (e.g. `acme`) on the login
screen. `ng build agentic-experience-studio` to build.

## Notable files

- `services/capability-catalog.service.ts` — typed client (list/get/create/update
  with `If-Match`, `transition`, `versions`, `rollback`; `ConcurrencyError`).
- `services/experience-catalog.service.ts` — the `/experiences` client (versioning
  + approval + publish).
- `lifecycle-bar.component.ts` · `history-panel.component.ts` · `governance-actions.ts`
  — the shared governance UI + wiring.
- `pages/*-designer.component.ts` · `pages/capability-studio.component.ts` — the designers.
- `studio-configs.ts` — the generic-kind field configs; `app.routes.ts` — routes +
  the unsaved-changes `canDeactivate` guard.

## Follow-ups

- Real OIDC redirect login (the screen currently accepts a pasted JWT / a tenant in
  disabled mode).
- Workflow parallel branches / sub-workflows / interactive node-graph; Application
  route params; page live preview — see the enterprise backlog in the guide.
