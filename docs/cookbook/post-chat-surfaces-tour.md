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

If you'd rather skim a pre-recorded run before clicking, the Playwright tour spec records video for every test. Produce them locally with one command:

```bash
cd e2e
EDIS_BASE_URL=https://ediscovery-shell.onrender.com \
  npx playwright test specs/11-post-chat-surfaces.spec.ts --reporter=html
npx playwright show-report playwright-report
```

The HTML report opens in your browser. Click any test → Attachments → Video. Each `.webm` is ~80–200 KB; the full run is ~4 min.

The video paths in the deep-link table below assume you've run that command — they live under `test-results/<spec-folder>/video.webm`.

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

- `test-results/11-post-chat-surfaces-§17--d552b-r-route-per-persona-density-chromium/video.webm`

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

- `test-results/11-post-chat-surfaces-§18--2374d-ow-action-menu-bulk-toolbar-chromium/video.webm`

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

- `test-results/11-post-chat-surfaces-§19--f974f-eeded-notifications-visible-chromium/video.webm`

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

- `test-results/11-post-chat-surfaces-§20--21c85-ost-MFE-contributed-visible-chromium/video.webm`

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

- `test-results/11-post-chat-surfaces-§21--78026-—-review-queue-timeline-cal-chromium/video.webm`
- `test-results/11-post-chat-surfaces-Cust-d2bd8-rview-prep-lifecycle-stages-chromium/video.webm`
- `test-results/11-post-chat-surfaces-Hold-8cdb0-ycle-stages-widget-rendered-chromium/video.webm`

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

- `test-results/11-post-chat-surfaces-§22--8d738-tart-run-chain-hashed-steps-chromium/video.webm`

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

- `test-results/11-post-chat-surfaces-Audi-74cc1-alization-when-events-exist-chromium/video.webm`

---

## How to verify each pillar yourself

If you don't trust the videos, the deterministic Playwright spec exercises the same surfaces — each test is one pillar:

```bash
cd e2e
EDIS_BASE_URL=https://ediscovery-shell.onrender.com \
  npx playwright test specs/11-post-chat-surfaces.spec.ts

# After ~4 min: 8/9 tests pass (the failing §17 documents the known
# chat-shell-mode reactivity follow-up — see §17 above).
# Open the report to scrub through every test's video:
npx playwright show-report playwright-report
```

## Where to go from here

- [USER_GUIDE §17–§22](../USER_GUIDE.md#17-persona-shaped-workspace-layouts-post-chat-surfaces-p0) — implementer-facing walkthroughs (registry shapes, code snippets)
- [post-chat-surfaces-plan.md](../plans/post-chat-surfaces-plan.md) — the P0–P5 phase plan + acceptance criteria
- Per-pillar cookbooks: [agent-directed-workspace-layouts](./agent-directed-workspace-layouts.md) · [cmd-k-palette](./cmd-k-palette.md) · [smart-cell](./smart-cell.md) · [row-action-menu](./row-action-menu.md) · [bulk-toolbar](./bulk-toolbar.md) · [assist-panel](./assist-panel.md) · [proactive-triggers-and-inbox](./proactive-triggers-and-inbox.md) · [lifecycle-stages](./lifecycle-stages.md) · [dashboards](./dashboards.md) · [conversational-dashboards](./conversational-dashboards.md) · [live-dashboards](./live-dashboards.md) · [review-queue](./review-queue.md) · [timeline-canvas](./timeline-canvas.md) · [cal-workbench](./cal-workbench.md) · [playbooks](./playbooks.md)
