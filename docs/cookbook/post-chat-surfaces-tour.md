# Post-chat surfaces — guided tour

This is the **adopter-facing** walkthrough of the six post-chat-surfaces pillars (§17–§22 in the [USER_GUIDE matrix](../USER_GUIDE.md#use-cases)). Each section tells you where to click in the live demo, what you should see happen, what's happening underneath, and links to the Playwright video for the same flow.

The implementer-facing reference (registry shapes, code snippets, factory call signatures) lives in the per-pillar cookbook pages — [dashboards.md](./dashboards.md), [playbooks.md](./playbooks.md), [cmd-k-palette.md](./cmd-k-palette.md), etc. This page is the *user experience* tour.

## Live demo

| Surface | URL |
|---|---|
| Shell (start here) | https://ediscovery-shell.onrender.com |
| Review remote | https://ediscovery-review.onrender.com |
| Production remote | https://ediscovery-production.onrender.com |
| Search remote | https://ediscovery-search.onrender.com |
| Agent server (Gemini) | https://ediscovery-agent-server.onrender.com |

> **Cold-start expectation.** Render's free-tier static-site spins down after 15 min of inactivity. The first visit takes **~30 seconds** before the chat shell appears in the right rail (Render container spin-up + Native Federation loads 3 MFE remotes + Angular bootstraps). The header shows the matter title and a persona switcher; the left rail lists the routes. Once those render, every subsequent click is fast.
>
> If you click a *Try asking* prompt before the chat shell mounts, nothing happens — the chat-shell view-child isn't there yet to receive the message. Wait for the chat composer input to appear in the right rail, then click.

## Watch the videos

Every pillar below has an inline `<video>` walkthrough recorded against the live Render demo. GitHub renders them natively in this page — just click play. All 9 videos are checked in under [`docs/assets/videos/`](../assets/videos/) and total ~1 MB (the longest is the §18 in-context affordances run at 194 KB).

| Pillar | Direct link |
|---|---|
| §17 Workspace layouts | [17-workspace-layouts.webm](../assets/videos/17-workspace-layouts.webm) |
| §18 In-context affordances | [18-in-context-affordances.webm](../assets/videos/18-in-context-affordances.webm) |
| §19 Triggers + inbox | [19-triggers-and-inbox.webm](../assets/videos/19-triggers-and-inbox.webm) |
| §20 Dashboards | [20-dashboards.webm](../assets/videos/20-dashboards.webm) |
| §21 Workflow surfaces | [21-workflow-surfaces.webm](../assets/videos/21-workflow-surfaces.webm) |
| §22 Playbooks | [22-playbooks.webm](../assets/videos/22-playbooks.webm) |
| Custodians (assist + interview prep) | [custodians-interview-prep.webm](../assets/videos/custodians-interview-prep.webm) |
| Holds (lifecycle widget) | [holds-lifecycle.webm](../assets/videos/holds-lifecycle.webm) |
| Audit (chain-hash viz) | [audit-chain-viz.webm](../assets/videos/audit-chain-viz.webm) |

To **regenerate** them after a code change, run the Playwright spec against either Render or localhost — it records video for every test, then copy the new `.webm` files into `docs/assets/videos/`:

```bash
cd e2e
EDIS_BASE_URL=https://ediscovery-shell.onrender.com \
  npx playwright test specs/11-post-chat-surfaces.spec.ts --reporter=html
npx playwright show-report playwright-report
```

---

## §17 — Workspace layouts (P0, [ADR-043](../adr/0043-layout-registry-promotion.md))

### What you'll see

The chat shell on the right side of every page. Its **mode** is decided by the route + the active persona, via [`provideLayoutPolicy`](../../examples/demo-ediscovery-shell/src/app/app.config.ts). On most routes you see the persistent rail; on the Audit page the shell hides because a chain-hash query bar is the right primitive there.

### Try this

1. Open https://ediscovery-shell.onrender.com — chat shell renders as a **rail** on the right (320px wide).
2. Click the persona avatar in the top-right of the header. Switch from *Paralegal* to *Lead counsel*. The density of the assist panel + the chat composer chrome tightens (smaller padding, denser typography).
3. Click **Audit Trail** in the left rail. The chat shell **hides** — the page shows a chain-hash query bar + integrity badge instead.
4. Click **Legal Holds**. The shell switches to **pill** mode (a small floating button bottom-right) so the lifecycle widget gets full-bleed space.

> **Known follow-up:** the live demo currently sets the chat-shell mode at *initial mount* per route. Re-clicking the sidebar between routes doesn't re-evaluate the policy (the library's `<mvk-chat-shell>` reads `LAYOUT_POLICY.shellMode(route)` via a HostBinding getter, not a Router-event-subscribed computed signal). A lib follow-up will subscribe to Router events. For now, refresh the page after navigating to see the mode change.

### Video

<video src="../assets/videos/17-workspace-layouts.webm" controls preload="metadata" width="720"></video>

[Open in new tab →](../assets/videos/17-workspace-layouts.webm)

---

## §18 — In-context affordances (P1)

### What you'll see

The chat is not the only way to invoke a tool. The Documents page surfaces three new affordances built on the same `IntentRegistry` / `ToolRegistry` the chat shell consults.

### Try this

1. Click **Documents** in the left rail.
2. Look at the **AI flag** column — each row has a coloured pip (`PRIV` / `HOT` / `REDACT` / `—`). That's `<mvk-smart-cell>` reading `aiFlag(d)` per row. Hover to see the tool attribution. If your active persona can't invoke `markPrivileged`, the cell renders a blocked stub instead.
3. Click the **kebab (⋮)** icon at the right end of any row. A menu pops up with `Mark privileged` / `Tag responsive` / `Add to privilege log`. That's `<mvk-row-action-menu>` filtered by `IntentRegistry` entries tagged with `context: 'row'`. Different rows render different menus depending on row state.
4. **Tick** the checkbox at the left of two or three rows. A **bulk toolbar** materialises just above the table (the lib's `<mvk-bulk-toolbar>`). Click *Bulk mark privileged* — the demo logs the dispatch; production would run the tool against the selection.
5. Try ⌘K / Ctrl+K anywhere in the app — the command palette opens. Type *"holds"* and pick a result.

### Video

<video src="../assets/videos/18-in-context-affordances.webm" controls preload="metadata" width="720"></video>

[Open in new tab →](../assets/videos/18-in-context-affordances.webm)

---

## §19 — Proactive triggers + inbox (P2, [ADR-045](../adr/0045-trigger-registry.md))

### What you'll see

The agent reaches you without a prompt. Three pre-seeded notifications land in the bell tray + the full `/inbox` route on boot — production triggers them via cron / webhook / queue events.

### Try this

1. Look at the **bell icon** in the top-right of the header. It has a red badge showing **2 unread**. That's `<mvk-notification-tray>` reading the `NotificationsStore` signal.
2. Click the bell. Dropdown opens with three notifications:
   - *3 hold acknowledgements still pending* (warning) — CTA opens `/holds`
   - *Production PROD-002 finished export* (info) — CTA opens `/productions`
   - *Welcome to the post-chat surfaces tour* (info, already read)
3. Click *3 hold acknowledgements still pending*. Two things happen:
   - The notification gets marked read (badge count drops).
   - Router navigates to `/holds` (the CTA's `kind: 'route'` payload).
4. Click **Inbox** in the left rail. Same notifications, full-page layout with filter buttons (Unread / All). Bulk *Mark all read* button up top.

### Behind the scenes

`registerPostChatSurfaces()` registers a `dailyAckSweepTrigger` (cron `@daily` → notification target with a `compose(ctx)` that returns the warning notification). The browser-side `provideTriggerRunner()` fires it. Two more triggers are registered as webhook + queue shapes (visible in the catalog but their firing belongs to a server-side runner).

### Video

<video src="../assets/videos/19-triggers-and-inbox.webm" controls preload="metadata" width="720"></video>

[Open in new tab →](../assets/videos/19-triggers-and-inbox.webm)

---

## §20 — User-built dashboards (P3, [ADR-044](../adr/0044-dashboard-registry.md))

### What you'll see

Six dashboards in a left-rail picker. Three are registered by the host at boot (`matterHealth`, `productionStatus`, `auditSnapshot`); three more arrive via federation as the MFE remotes load (`reviewProductivity` from `demo-ediscovery-review`, `productionThroughput` from `demo-ediscovery-production`, `searchPerformance` from `demo-ediscovery-search`). All six are `DashboardDef` entries on the same `DashboardRegistry`.

### Try this

1. Click **Dashboards** in the left rail.
2. Wait for the left-rail picker to settle at 6 entries (federation load is async — you may see 3 → 6 transition over a few seconds on a cold start).
3. Click **Matter health** in the picker. The canvas on the right renders three tiles:
   - *Pending hold acknowledgements* — re-invokes `listLegalHolds({status: 'pending'})`. The number is live; refresh button re-fires the tool.
   - *Custodians on hold* — re-invokes `listCustodians({onHold: true})`.
   - *About this dashboard* — static markdown tile.
4. Click the **body** of *Pending hold acknowledgements*. Router drills you into `/holds` — the tile's `drilldown: { route: '/holds' }`.
5. Click **Production throughput** in the picker. This dashboard is registered by the *production* MFE remote — `defineCapabilityModule({ dashboards })` from `demo-ediscovery-production/src/app/capability.ts`. If you unload the production remote, `removeBySource('remote:demo-ediscovery-production')` reaps the dashboard symmetrically.

### Video

<video src="../assets/videos/20-dashboards.webm" controls preload="metadata" width="720"></video>

[Open in new tab →](../assets/videos/20-dashboards.webm)

---

## §21 — Workflow surfaces (P4)

### What you'll see

Three purpose-built widgets for the workflows that aren't chat-shaped: multi-reviewer queue, investigation timeline, CAL training loop. Plus the lifecycle widget on Holds + Productions.

### Try this

#### Workflow E — Review queue

1. Click **Review queue** in the left rail. Seeded items render grouped by state. **Switch persona** in the header from *Paralegal* to *Associate* — different items appear because the test data routes `qc_pending` items to associates.
2. Click **Accept** on a `proposed_privileged` item. The item moves to `qc_pending`. The last-decision pill at the bottom shows the round-trip. Production would emit `(decision)` to an `agenticAction` that writes a `tool-approved` event to the audit chain.

#### Workflow D — Timeline canvas

3. Click **Timeline** in the left rail. The Acme acquisition timeline renders horizontally with 6 events across 96 hours. Click the **star** on an event to toggle its key-moment flag (the count in the subtitle updates). Click an event body — the demo logs the drill-in; production opens a detail pane.
4. Click the **filter chips** at the top to filter by event kind (`email` / `chat` / `doc` / `meeting` / `transaction`).

#### Workflow C — CAL workbench

5. Click **CAL workbench** in the left rail. The first proposal renders with confidence, rationale, and three buttons: **Accept**, **Reject**, **Skip**. Click *Accept* — cursor advances to the next proposal, tagged count goes up.
6. Click *Train next round* (top-right) — production would dispatch the `runTARClassifier` long-running operation; the demo bumps the round counter.

#### Workflow A — Hold lifecycle

7. Click **Legal Holds** in the left rail. Each hold card shows the lib's `<mvk-lifecycle-stages>` widget above the hand-rolled timeline. Stages: **Issue → Acknowledge → Track → Release** with a Send reminder action on pending stages.

#### Workflow B — Production pipeline

8. Click **Productions** → pick a set. Same widget shape, different stage names: **Scope → Bates → Finalise → Deliver**.

#### Workflow F — Custodian interview prep

9. Click **Custodians** → pick a custodian. Below the assist panel, an *Interview prep* block renders with:
   - **Pre-interview** question list (priority pips per question; first question conditional on hold state)
   - **During interview** notes textarea
   - **Post-interview** cross-reference flags (seeded with a *Project Phoenix* inconsistency + an off-channel Signal note)

### Video

**Workflow surfaces (review-queue → timeline → CAL):**

<video src="../assets/videos/21-workflow-surfaces.webm" controls preload="metadata" width="720"></video>

[Open in new tab →](../assets/videos/21-workflow-surfaces.webm)

**Custodians (assist-panel + interview-prep):**

<video src="../assets/videos/custodians-interview-prep.webm" controls preload="metadata" width="720"></video>

[Open in new tab →](../assets/videos/custodians-interview-prep.webm)

**Holds (lifecycle-stages widget):**

<video src="../assets/videos/holds-lifecycle.webm" controls preload="metadata" width="720"></video>

[Open in new tab →](../assets/videos/holds-lifecycle.webm)

---

## §22 — Playbooks (P5)

### What you'll see

Named, versioned, persona-scoped sequences of tool calls. Three are pre-registered: `initialPrivilegePass v1`, `qcPrivilegePass v2` (with `parentVersion: 'v1'`), `productionRelease v1`. Every step chain-hashes with `origin: 'playbook'`.

### Try this

1. Click **Playbooks** in the left rail.
2. The left-rail picker shows three playbooks. Click **Initial privilege pass v1**.
3. Click **Start run** (top-right). `<mvk-playbook-runner>` materialises with three step rows:
   - **List pending holds** runs → succeeds (tool result captured + chain-hashed)
   - **List custodians on hold** runs → succeeds (`continueOnError: true` is shown as an icon)
   - **Open the approvals queue** halts at an **Approve / Skip gate** — it has `requiresApproval: true`
4. Click **Approve**. The third step runs and the overall pill flips to `SUCCESS`.
5. Switch persona to *Vendor reviewer*. Open `Initial privilege pass` again. The list-holds step now fails with *tool not visible to this persona* — that persona can't invoke `listLegalHolds`. The runner records the failure with a clear error.
6. Click **QC privilege pass v2** in the picker. Note the *v2* + *parentVersion: v1* metadata — this is the edit-creates-vN+1 versioning baked into `DashboardDef` / `PlaybookDef`.

### Video

<video src="../assets/videos/22-playbooks.webm" controls preload="metadata" width="720"></video>

[Open in new tab →](../assets/videos/22-playbooks.webm)

---

## Audit chain-hash visualization

### What you'll see

The `/audit` route renders the last 12 chain-linked events as a horizontal strip of connected hash blocks above the main trail. Click any block to scroll the corresponding row into view and flash it briefly.

### Try this

1. Run a few tool calls first (e.g. the **Playbooks** flow above) so the audit chain has entries.
2. Click **Audit Trail** in the left rail.
3. The integrity banner up top reads **Chain verified — X of Y hashes recompute**. Below it, the **Chain-hash visualization** section renders the last 12 events as hash blocks with:
   - Family-coded left border (hold / custodian / document / privilege)
   - 8-char truncated `chainHash`
   - Action + actor
   - An accent ring on the **head** (rightmost, latest)
4. Click any hash block. The corresponding row in the main trail below scrolls into view and **flashes** for ~1.4s.

### Video

<video src="../assets/videos/audit-chain-viz.webm" controls preload="metadata" width="720"></video>

[Open in new tab →](../assets/videos/audit-chain-viz.webm)

---

## Agent-driven surfaces — the "the agent reshapes the screen" demo

Two of the post-chat surfaces — `/workspace` and `/dashboards` — accept **live updates from the agent** via dedicated tools. Type a prompt in the chat shell:

| Prompt | What happens |
|---|---|
| *"Open document preview, tag panel, and chain-of-custody in a workspace"* | The agent picks the `setWorkspaceLayout` tool → it builds a SlotMap → writes to `WorkspaceLayoutStore` → `/workspace` re-renders the slots **live** (no navigation). A blue banner appears at the top of `/workspace`: *"Agent-driven layout active"* with a Reset button. |
| *"Build me a dashboard for production status"* | The agent picks the `proposeDashboard` tool → it builds a `DashboardDef` from the intent + topic hint → writes to `ProposedDashboardStore` → a blue banner appears at the top of `/dashboards`: *"Agent proposed: Production status"* with Preview / Commit / Dismiss buttons. **Preview** swaps the canvas to show the proposed def without committing; **Commit** registers it into `DashboardRegistry` so it joins the picker; **Dismiss** drops it. |

### Why dedicated tools and not the AG-UI `LAYOUT_RENDER` event?

The library ships both — the event-based path (`LayoutRenderEvent` consumed by `<mvk-chat-shell>`) and the tool-based path. The eDiscovery demo uses tools so:

1. Every agent decision is a chain-hashed audit entry. The user can see *which prompt led to which layout* in the `/audit` route.
2. Persona scope filters apply automatically. A vendor-reviewer that can't invoke `setWorkspaceLayout` doesn't see it surface as an option; the lib's `RegistryBase.setScopePolicy` filter handles this without any per-tool plumbing.
3. The proposal is reversible. Commit / Dismiss gives the user explicit say.

The `LAYOUT_RENDER` event path is fine for ad-hoc agent-driven shapes — the demo uses tools when *user preference* matters.

### User preference persistence

- **Workspace layout** — the slot map is persisted to `localStorage` under `ediscovery.workspace-layout:<personaId>`. Refresh the page; the agent-emitted layout is still there. Switch persona; the layout switches to that persona's preferred shape (or falls back to the per-persona default if nothing was saved).
- **Dashboard commits** — when the user clicks Commit, the proposed def joins `DashboardRegistry`. Persistence here is in-memory by default; production hosts would bind the registry to `PersistenceRegistry` for cross-session retention.

### Where the tool definitions live

- [`agentic/dynamic-surface.tools.ts`](../../examples/demo-ediscovery-shell/src/app/agentic/dynamic-surface.tools.ts) — `setWorkspaceLayout` + `proposeDashboard` factories.
- [`services/workspace-layout.store.ts`](../../examples/demo-ediscovery-shell/src/app/services/workspace-layout.store.ts) — signal-backed slot map with persona-scoped localStorage persistence.
- [`services/proposed-dashboard.store.ts`](../../examples/demo-ediscovery-shell/src/app/services/proposed-dashboard.store.ts) — signal-backed pending DashboardDef + commit-to-registry helper.

---

## What's wired in the eDiscovery shell vs the lib

The shell uses every post-chat-surfaces primitive from the library, with a few extension patterns that go beyond the lib's defaults:

| § | Library primitive | eDiscovery shell wiring |
|---|---|---|
| 17 | `provideLayoutPolicy({...})` | ✅ Wired in [`app.config.ts`](../../examples/demo-ediscovery-shell/src/app/app.config.ts) — per-persona density + route-based shellMode. |
| 17 | `<mvk-workspace-layout>` | ✅ [`/workspace`](https://ediscovery-shell.onrender.com/workspace) demo route shows the slot-based primitive with persona-driven density. The default routes (`/documents`, `/holds`, etc.) keep using the hand-rolled three-pane chassis since most routes don't need slot composition — the lib's primitive is for "the agent reshapes the canvas mid-turn" workflows. |
| 18 | `<mvk-cmd-k-palette>` | ⚠️ Replaced by a richer internal component ([`<mvk-command-palette>`](../../examples/demo-ediscovery-shell/src/app/ui/command-palette.component.ts)) that extends the same pattern (IntentRegistry → ToolRegistry → free-text) with **headless agent invocation**. Press ⌘K to invoke without opening the chat shell. The lib's bare-bones `<mvk-cmd-k-palette>` is what simpler hosts use; the eDiscovery flagship demonstrates the extension. |
| 18 | `<mvk-smart-cell>` + `<mvk-row-action-menu>` + `<mvk-bulk-toolbar>` + `<mvk-assist-panel>` | ✅ All wired — Documents page columns + row kebab + bulk toolbar, Custodians page assist panel. |
| 19 | `TriggerRegistry` + `provideTriggerRunner` + `<mvk-notification-tray>` + `<mvk-inbox>` + `<mvk-lifecycle-stages>` | ✅ All five wired — 3 triggers seeded at boot, tray in the header, `/inbox` route, lifecycle widget on `/holds` + `/productions`. |
| 20 | `DashboardRegistry` + `<mvk-dashboard-canvas>` + `TileResultCache` | ✅ Wired — 3 host dashboards + 3 MFE-contributed (federation symmetry). Canvas uses `<mvk-dashboard-tile>` + `TileResultCache` internally. `<mvk-dashboard-preview>` is not used (would surface when the LLM proposes a new dashboard via `proposeDashboard` — chat-driven flow not wired in this demo). |
| 21 | `<mvk-review-queue>` + `<mvk-timeline-canvas>` + `<mvk-cal-workbench>` | ✅ All wired as `/review-queue` + `/timeline` + `/cal` routes. |
| 22 | `PlaybookRegistry` + `PlaybookRunner` + `<mvk-playbook-runner>` | ✅ All wired — 3 PlaybookDefs (`initialPrivilegePass v1`, `qcPrivilegePass v2`, `productionRelease v1`). |
| 23 | `provideAgenticPlatform({...})` | ✅ Wired. Catalog adapters (persona resolver, MFE registry, capability registrar / authorizer, usage metering) all opt-in via per-feature options. |
| 24 | `provideTeamsContext({ loadContext })` | ✅ Wired — falls back to demo context outside Teams. Production hosts plug `microsoftTeams.app.getContext()` into `loadContext`. |

## §25–§27 — External chat-surface deployments (deferred)

The library packages for the three external chat surfaces are published and tested, but the eDiscovery flagship doesn't have live demo deployments of them. Each one needs platform-specific external configuration:

| § | Package | What's required to deploy |
|---|---|---|
| 25 | [`@infra-tools/agentic-ui-teams-bot`](../../projects/agentic-ui-teams-bot/) | Microsoft Bot Framework registration (Azure Bot resource + AAD app + Teams Connector) + a Node service exposing the bot webhook. Cookbook: [teams-bot-adaptive-cards.md](./teams-bot-adaptive-cards.md). |
| 26 | [`@infra-tools/agentic-ui-copilot-skill`](../../projects/agentic-ui-copilot-skill/) | GitHub App with Copilot Extensions permissions + a public webhook endpoint. Cookbook: [github-copilot-extension.md](./github-copilot-extension.md). |
| 27 | [`@infra-tools/agentic-ui-copilot-studio-connector`](../../projects/agentic-ui-copilot-studio-connector/) | Power Platform Custom Connector registration + Azure AD app (per-tenant). Cookbook: [copilot-studio-connector.md](./copilot-studio-connector.md). |

These three are intentionally not wired into the Render demo because they require **per-environment platform configuration** that goes beyond a self-contained showcase. The library packages, snapshot tests, and cookbook walkthroughs are all in place — adopters with Microsoft / GitHub developer accounts can wire them in ~1–2 hours each following the cookbooks.

## How to verify each pillar yourself

If you don't trust the videos, the deterministic Playwright spec exercises the same surfaces — each test is one pillar:

```bash
cd e2e
EDIS_BASE_URL=https://ediscovery-shell.onrender.com \
  npx playwright test specs/11-post-chat-surfaces.spec.ts

# After ~6-8 min: 9/9 tests pass against live Render (with the pre-warm
# hook + waitForShellReady gate that handles cold-start latency).
# Open the report to scrub through every test's video:
npx playwright show-report playwright-report
```

## Where to go from here

- [USER_GUIDE §17–§22](../USER_GUIDE.md#17-persona-shaped-workspace-layouts-post-chat-surfaces-p0) — implementer-facing walkthroughs (registry shapes, code snippets)
- [post-chat-surfaces-plan.md](../plans/post-chat-surfaces-plan.md) — the P0–P5 phase plan + acceptance criteria
- Per-pillar cookbooks: [agent-directed-workspace-layouts](./agent-directed-workspace-layouts.md) · [cmd-k-palette](./cmd-k-palette.md) · [smart-cell](./smart-cell.md) · [row-action-menu](./row-action-menu.md) · [bulk-toolbar](./bulk-toolbar.md) · [assist-panel](./assist-panel.md) · [proactive-triggers-and-inbox](./proactive-triggers-and-inbox.md) · [lifecycle-stages](./lifecycle-stages.md) · [dashboards](./dashboards.md) · [conversational-dashboards](./conversational-dashboards.md) · [live-dashboards](./live-dashboards.md) · [review-queue](./review-queue.md) · [timeline-canvas](./timeline-canvas.md) · [cal-workbench](./cal-workbench.md) · [playbooks](./playbooks.md)
