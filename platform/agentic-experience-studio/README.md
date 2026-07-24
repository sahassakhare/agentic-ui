# Agentic Experience Studio

A dedicated authoring app for **AEP Experiences** (see
[docs/plans/agentic-experience-platform-plan.md](../../docs/plans/agentic-experience-platform-plan.md),
Seam E). Business users compose Experiences from registry capabilities; the app
previews each Experience's **capability dependency graph** (Seam A) and drives
its approval workflow.

## Why a separate app (not the ops console)

The `agentic-ops-console` is intentionally **left untouched** — it needs to
mature to enterprise grade and its UX needs rework, so authoring load is not
piled onto it. This studio is fully independent: it talks to the same catalog
server (`/v1/catalogs/:tenant/experiences`, Seam F) over HTTP and reuses **no**
ops-console code.

## What's here (first cut)

- `services/experience-catalog.service.ts` — typed client for the `/experiences`
  API (list / get / create / update / transition / plan / delete).
- `experience-graph.ts` — pure builder turning an Experience + a `/plan`
  resolution into **dependency-edge** graph data (matched / unmet / optional),
  the view the ops-console containment graph lacks. Unit-tested, no cytoscape
  dependency.
- `pages/experiences.component.ts` — experience list + create form.
- `pages/experience-detail.component.ts` — one experience, its cytoscape
  dependency graph, a server-side plan dry-run, edit form, and approval actions.
- `pages/capability-studio.component.ts` — generic authoring studio for a
  capability kind, driven by route `data.config`; powers the Prompt, Skill,
  Knowledge, Memory, and Navigation studios (`studio-configs.ts`).
- `pages/login.component.ts` + `guards/auth.guard.ts` — OIDC (paste JWT, tenant
  decoded from claims) / disabled (type tenant) auth.

## Run

```bash
ng serve agentic-experience-studio      # http://localhost:4600
ng build agentic-experience-studio
ng test  agentic-experience-studio
```

Point `src/environments/environment.ts#catalogBaseUrl` at the catalog server,
then set tenant + token in the connection bar.

## Not yet built (follow-ups)

- Policy studio (OPA bundle editing via the catalog `/policy/bundles` API).
- Workflow studio (a step-graph editor — more than the generic form covers).
- Real OIDC redirect flow (the login screen currently accepts a pasted JWT).
