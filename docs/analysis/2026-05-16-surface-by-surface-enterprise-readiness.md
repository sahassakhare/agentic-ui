# Surface-by-surface enterprise-readiness — Inbox, Dashboards, Playbooks, Workspace and the rest

**Date:** 2026-05-16 · **Scope:** every routed surface in `examples/demo-ediscovery-shell` · **Frame:** what works today, what's a stub, what an eDiscovery enterprise adopter would need to ship to production.

This is the deepest-cut analysis in the series. The two prior docs looked at architecture and use-case gaps; this one is brutally specific per surface. Same goal: give the next planning cycle an honest read on what's reference architecture, what's prototype, and what's stubbed.

The headline finding upfront: **the library is production-shaped, the demo is a curated showcase**. The surfaces in this codebase prove the agentic-UI patterns work; they do NOT constitute a shippable eDiscovery product. Closing that gap is a multi-quarter undertaking with real backend, real connectors, and real document-handling code.

---

## 0. How to read this doc

For each surface:

- **Wired** — what's actually working end-to-end (not just stubbed UI)
- **Stubbed** — UI exists, no real backing
- **Missing** — needed for enterprise eDiscovery, not in the codebase at all
- **Status** — one of:
  - ✅ Enterprise-ready (rare)
  - 🟡 Enterprise-shaped, missing depth
  - 🟠 Prototype with serious gaps
  - 🔴 Pure stub — no real domain functionality

Three audiences for this doc:
1. **Adopters** — read each surface's "Missing" list to estimate buildout for your domain
2. **Maintainers** — read the "Stubbed" sections to decide which placeholders deserve real implementations next
3. **Sales / evals** — read §6 (executive summary) and §7 (positioning)

---

## 1. Inbox 🟠

**Files:** [`pages/inbox/inbox.component.ts`](examples/demo-ediscovery-shell/src/app/pages/inbox/inbox.component.ts), [`services/notifications.store.ts`](examples/demo-ediscovery-shell/src/app/services/notifications.store.ts), `<mvk-inbox>` from lib

### What's wired
- `TrayNotification` model carries severity (`info`/`warning`/`error`), origin, timestamp, CTA (route/tool/action).
- `markRead`, `markAllRead`, computed `unreadCount`.
- CTA routing — route-kind CTAs `Router.navigateByUrl()`; tool / action CTAs documented as deferred.
- Header bell + dedicated `/inbox` route mounting `<mvk-inbox>`.

### What's stubbed
- **All three seeded notifications are static.** No live source feeding the store.
- **Severity not visualised** in the inbox template. The model carries it; the UI doesn't render it as an icon/badge/color treatment.

### What's missing for enterprise
- **Trigger subscription pipeline.** `TriggerRegistry` exists with cron-style triggers (`dailyAckSweep`, `productionReady` defined as `TriggerDef`s); they don't actually run on a schedule and inject notifications. The wiring exists; the *runtime* doesn't.
- **Filtering and search.** No filter by severity, kind, source, time-range, or matter. No free-text search. No saved searches.
- **Sort and group.** Insertion order only. No "group by source" or "sort by deadline".
- **Bulk actions.** Mark all read is the only bulk action. No snooze, archive, dismiss-all-of-kind.
- **SLA / priority queues.** No "this notification has been unread for 48h — escalate" rule.
- **Inbox preferences.** Per-user notification routing (email vs Slack vs in-app), digest schedules, suppression rules.
- **Cross-channel delivery.** Email, Slack, Teams, mobile push integration. eDiscovery legal teams expect court-deadline reminders in their work email, not just an in-app bell.
- **Notification grouping / threading.** Five "hold acknowledgement" notifications from the same trigger should collapse into a thread.
- **Source authentication.** Who emitted this notification? A real audit needs signed provenance, not just an origin string.

### Recommendation
Ship in this order: (1) trigger-runner → notification wiring (lib has both — connect them), (2) severity visualization in the inbox template (½ day), (3) filter chips + free-text search (1-2 days), (4) snooze + bulk actions (1 day). Multi-channel delivery and SLA escalation are 2-3 month follow-ons that need a backend.

---

## 2. Dashboards 🟡

**Files:** [`pages/dashboards/dashboards.component.ts`](examples/demo-ediscovery-shell/src/app/pages/dashboards/dashboards.component.ts), [`agentic/post-chat-surfaces.ts`](examples/demo-ediscovery-shell/src/app/agentic/post-chat-surfaces.ts), `<mvk-dashboard-canvas>` + `<mvk-dashboard-tile>` from lib

### What's wired
- 3 seeded `DashboardDef`s: `matterHealth`, `productionStatus`, `auditSnapshot`. Three tile kinds in use (`tool`, `static`; `data-source` reserved).
- Tile drilldown via `(drilldown)` event → `Router.navigateByUrl()` for route-kind drilldowns.
- Picker on the left rail; persona-scoped via `ToolRegistry.setScopePolicy` — blocked tiles render "no access" stub instead of 403.
- Agent flow: `proposeDashboard` tool → blue banner with Preview/Commit/Dismiss → committed entry joins `DashboardRegistry` with `source: 'user'`.
- Version-chaining on re-commit (`v1 → v2` with `parentVersion`).
- Approved-template catalog (Apply button instantiates into registry).

### What's stubbed
- All tile data is mock from `demo-ediscovery-shared` — `listLegalHolds`, `listCustodians` return seeded arrays. No live backend.
- "Static" tiles (`kind: 'static'`) render markdown blurbs as filler.

### What's missing for enterprise
- **Cross-tile filters.** A date-range picker at the dashboard level that propagates to every tile's `args`. Same for matter-scope, custodian-scope, tag-filter. Today each tile invocation is static.
- **Drillable visualizations.** Tiles are currently single-value KPIs. No charts (line/bar/heatmap), no tables with sort/filter, no comparison views (this matter vs benchmark, this week vs last week).
- **Conditional visibility.** Tiles can't hide based on persona, matter phase, role. The lib has `setScopePolicy`; tile-level visibility rules aren't wired.
- **Scheduled snapshots.** Export to PDF / PowerPoint / CSV on a cron. Email to a distribution list.
- **Annotations / comments.** Lead-counsel commenting on a tile ("why did the privilege rate drop this week?").
- **Real-time refresh.** WebSocket subscriptions, polling cadence, manual refresh. Today: `refreshOn: 'load'` only.
- **Tile-level permissions.** Some tiles should be admin-only, not just hidden.
- **Drill into tile data.** Click a count tile → modal with the underlying rows. Click a chart series → filter the dashboard.
- **Dashboard-to-dashboard navigation.** Drilldown can route or fire a tool; it can't navigate to *another dashboard* with parameters carried over.
- **Print-friendly layout.** Many legal contexts require printed dashboards for filings. No print stylesheet, no PDF render.

### Recommendation
Three days of work would close the most visible gaps: dashboard-level date-range picker + chart components (real `<mvk-line-chart>` / `<mvk-bar-chart>` registered as ComponentDef so tiles can use them) + a tile-drill-modal pattern. Scheduled exports + permissions are a backend-shaped follow-on.

---

## 3. Playbooks 🟠

**Files:** [`pages/playbooks/playbooks.component.ts`](examples/demo-ediscovery-shell/src/app/pages/playbooks/playbooks.component.ts), `PlaybookRegistry` + `PlaybookRunner` from lib, 3 seeded `PlaybookDef`s in `post-chat-surfaces.ts`

### What's wired
- 3 playbooks seeded: `initialPrivilegePass` (3 steps), `qcPrivilegePass v2` (4 steps, `parentVersion: v1`), `productionRelease` (3 steps).
- `PlaybookRunner.start(def)` returns a `RunningPlaybook` handle with signal-backed state.
- Per-step properties: `continueOnError`, `requiresApproval`. Approval-required steps pause and queue.
- Chain-hashed audit per step with `origin: 'playbook'`.
- User actions on the runner: Approve / Skip / Cancel.

### What's stubbed
- All step tools resolve to existing demo tools (`listLegalHolds`, `runTARClassifier`) — work, but produce mock results.
- The 3 playbooks are linear procedural skeletons. No real branching or domain decision logic.

### What's missing for enterprise
- **Conditional branching.** No `if`/`switch` on prior step outputs. eDiscovery playbooks routinely need *"if TAR confidence < 0.7 then escalate"*. Today every step runs unconditionally in order.
- **Data passing between steps.** Each step is independent. The output of step 1 isn't bound to args of step 2. Real playbooks need *"use the documents returned by `listLegalHolds` as input to `runTARClassifier`"*.
- **Multi-actor handoff.** A step pauses for approval → who's the approver? Today: anyone with the persona can approve. No role-based routing (paralegal escalates to lead-counsel; lead-counsel escalates to managing-partner).
- **Cross-session persistence.** `RunningPlaybook` state lives in memory. Close the tab → the run is gone. Production runs are days long (run overnight TAR classification, resume next morning).
- **SLA / deadline on a step.** "Acknowledge within 48h or auto-escalate." No timer infrastructure.
- **Retry policies.** Per-step retry with backoff, max attempts. Today: `continueOnError` is the only knob.
- **Rollback / re-run from step N.** No undo. No "the privilege classification was wrong, re-run from step 3 with new args".
- **Performance metrics.** Mean time per step, error rates by step, cost per run. Real playbook libraries get optimized via this telemetry.
- **Visual workflow editor.** Adopters today author playbooks in TypeScript. Enterprise users expect a drag-drop builder.
- **Playbook templates + sharing.** Like dashboards have a `LayoutTemplateRegistry`, playbooks need approval-gated sharing across matters.
- **Sub-playbooks.** Reuse — "release production" is a sub-flow within "close matter". No nesting.

### Recommendation
Highest-leverage 3 fixes: (1) data passing between steps — let step N's output flow into step N+1's args via a small expression language, (2) conditional branching — `if`/`else` on tool result via that same expression language, (3) cross-session persistence — `PlaybookRunner` state through `LayeredLayoutStore`. Each ~1 week. Visual editor is a separate ADR.

---

## 4. Workspace 🔴 (widgets) / 🟡 (infrastructure)

**Files:** [`pages/workspace/workspace-demo.component.ts`](examples/demo-ediscovery-shell/src/app/pages/workspace/workspace-demo.component.ts), [`agentic/slot-widgets.ts`](examples/demo-ediscovery-shell/src/app/agentic/slot-widgets.ts), `<mvk-workspace-layout>` + `LayoutResolver` from lib

### What's wired (layout infrastructure — 🟡)
- 7-source precedence resolution (route / persona / matter-phase / agent / user-saved / selection / alert).
- `LayoutAuditTracker` chain — every resolved-layout change captured with attribution.
- `Save as my preference` → `LayeredLayoutStore.writeToTier('user-saved', key, slots)` + UserSavedLayoutInput round-trip.
- Reset hierarchy menu (4 levels).
- Save-as-template promotion flow with approval workflow.
- Responsive collapse rules at 1024px + 768px.
- Density per persona (compact/comfortable/dense).
- Agent-driven via `setWorkspaceLayout`, `addLayoutSlot`, `removeLayoutSlot`, `replaceLayoutSlot`, `applyLayoutTemplate`.

### What's stubbed (the widgets — 🔴)
All six slot widgets in `slot-widgets.ts` are **pure visual placeholders**:

| Widget | What it shows | What it's missing |
|---|---|---|
| `documentPreview` | Selected doc ID + lorem ipsum + AI-flag pill | **No PDF viewer, no annotations, no redaction overlay, no native rendering.** Stub comment: *"production would mount the redacted-PDF viewer"*. |
| `tagPanel` | 6 hardcoded clickable tags | **Buttons don't dispatch.** No taxonomy fetch, no `tagDocuments` call, no audit. |
| `chainOfCustody` | 4 hardcoded fake events with fake hashes | **Not reading the real audit chain.** No cryptographic verification, no link to `MatterStore.auditLog`. |
| `bulkActions` | 4 buttons, selection count | **No bulk operation queued.** No progress display. No SLA. |
| `multiDocPreview` | List of selected IDs with stub metadata | **No thumbnails, no lazy-load, no real metadata.** Random page count. |
| `privilegeLog` | 3 hardcoded entries | **Not a real log.** No filter, no export, no privilege-rule application. |

### What's missing for enterprise eDiscovery
- **A real document viewer.** PDF rendering with text-layer (search, copy), redaction overlays with audit trail, native file viewer (Office docs, emails with attachments), Bates stamping preview.
- **A real tag editor.** Hierarchical taxonomies (responsive → highly-relevant, responsive → low-relevance). Tag inheritance rules across email threads / families. Bulk tag with progress. Tag-removal audit.
- **Real chain-of-custody.** Reads from `MatterStore.auditLog`, verifies the prevHash → chainHash linkage cryptographically, surfaces breaks. Exports to court-defensible PDF.
- **Real privilege log.** Auto-generated from tags + reviewer decisions. Categorization (attorney-client / work-product / other). Privilege withhold tracking. Slipsheets for production.
- **Slot-to-slot communication.** Click a tag in `tagPanel` → filter the document queue. Click a custodian in `chainOfCustody` → focus their documents. The `SelectionStore` exists; cross-slot reactivity does NOT.
- **Workspace tabs.** Multiple workspaces open simultaneously (one per matter, one per privilege batch). Tab management.
- **Per-slot data binding with backend queries.** Each widget should query its own data source given the selection. Today: every widget reads the same `SelectionStore` and renders mock data.
- **Slot constraints.** "documentPreview requires single-document selection" should be a typed declaration. Today: the rule decides; the widget doesn't validate.

### Recommendation
This is the **biggest gap** in the codebase between "lib promise" and "delivered demo". Three sprints:

1. **Real document viewer integration.** Use [PDF.js](https://mozilla.github.io/pdf.js/) or [PSPDFKit](https://pspdfkit.com/) — both have Angular wrappers. Wire as a `documentPreview` ComponentDef that fetches the doc by ID from the `SelectionStore`. ~2 weeks.
2. **Real tag panel.** Hierarchical taxonomy, dispatches `tagDocuments` tool, chain-hashes the action. ~1 week.
3. **Real chain-of-custody.** Read from `MatterStore.auditLog` directly. Verify cryptographically. Export to PDF. ~1 week.

The remaining widgets (`privilegeLog`, `bulkActions`, `multiDocPreview`) can stay stubbed for another sprint without losing demo credibility once the first three are real.

---

## 5. The other surfaces

Shorter takes per surface. Same format.

### `/documents` 🟠

**Wired:** Sortable table + filter rail (custodian / tag / privilege-only / search) + smart-cell column + row-action-menu + bulk-toolbar + slide-in drawer + persona-scoped tool execution.

**Missing for enterprise:**
- Bates stamping (no column, no production-mode toggle).
- Inline redaction editor.
- Native file rendering for non-PDF formats.
- Email threading (related family groups).
- Bulk export with format selection + Bates allocation.
- Real full-text search (`searchDocuments` is a mock helper).
- Reviewer assignment + workload balancing.
- Per-reviewer productivity metrics.
- Review pass tracking (1st pass → 2nd pass → privilege pass).
- Sticky notes / per-doc reviewer comments.

**Status:** Table mechanics are solid; review *workflow* depth is missing. Closing the document-viewer gap in §4 partially addresses this.

### `/custodians` 🟠

**Wired:** List + detail pane + interview prep widget + assist-panel + agent-driven `addCustodian`.

**Missing:**
- Self-service custodian portal (custodians log in, acknowledge hold, upload files).
- Interview questionnaire response capture.
- Collection SLA tracking + escalation.
- Auto-reminder workflow.
- Per-custodian data map (where their data lives — email, OneDrive, Slack).
- Audit of custodian-side actions (what they did, when).

**Status:** Custodian *roster* works; *collection management* is prototype.

### `/holds` 🟠

**Wired:** KPI cards (active / pending / acked / released) + hold cards with custodian list + `<mvk-lifecycle-stages>`.

**Missing:**
- Acknowledgment UI on the hold card itself.
- Hold notice generation (PDF, email template with merge fields).
- Custodian reminder cadence + SLA escalation.
- Hold-scope modification workflow (extend, narrow, transfer to another matter).
- Bulk release at matter close.
- Defensible-destruction certificate generation.

**Status:** Hold *tracking* solid; *workflow* (notice → acknowledge → release) is prototype.

### `/productions` 🟠

**Wired:** Master-detail picker + status badges + Bates pattern display + `<mvk-lifecycle-stages>`.

**Missing:**
- Bates allocation algorithm (which docs get which numbers, conflict detection across productions).
- Redaction editor with Boolean redaction rules.
- Native file format conversion (TIFF, PDF/A, native).
- Chain-of-custody report generation per production set.
- Privilege log inclusion / exclusion at production time.
- Endorsement (Confidential / Highly Confidential / Attorneys' Eyes Only).
- Production manifest export.
- Integrity check (hash verification of deliverable).
- Scheduled delivery to opposing counsel.

**Status:** Production *tracking* exists; *export workflow* (the meat) is a stub.

### `/approvals` 🟠

**Wired:** Pending queue + recent decisions + `<mvk-approval-card>` + cross-session async handoff (paralegal queues, lead-counsel approves next morning).

**Missing:**
- Role-based routing (this approval goes to lead-counsel; that one goes to managing-partner).
- SLA per approval + escalation.
- Comment / reason capture on Approve and Reject.
- Multi-step chains (junior reviewer → senior → partner).
- Re-submission workflow with diff (what changed since the rejection).
- Approval delegation (lead-counsel is on PTO → delegate to associate).
- Per-action approval policies (every `releaseLegalHold` requires lead-counsel sign-off).

**Status:** Approval *queue infrastructure* works; *routing logic* is missing.

### `/operations` 🟠

**Wired:** Active/completed/failed KPIs + `<mvk-operation-progress>` per op + in-memory `OperationRegistry`.

**Missing:**
- Cross-session persistence — close tab, the op state is gone.
- Streaming progress (TAR classifier "1,200 / 50,000 docs classified" with ETA).
- Retry / cancel UI per op.
- Resource usage (CPU, memory, estimated time remaining).
- Per-operation audit trail (who started it, who cancelled it, why).
- Bulk operation control (cancel all by-type, retry all failed).

**Status:** Tracking OK; *durability + control depth* missing.

### `/audit` ✅ 🟡

**Wired:** Chain-hash verification + per-event filter + chain-block visualization + tamper detection.

**Missing:**
- Time-range picker.
- Drill-into-event with before/after state diff.
- Export to signed PDF for court.
- Cross-matter audit query ("show me every privilege override across all my matters this quarter").
- Compliance report templates (SEC, FRCP, 21 CFR Part 11).

**Status:** Closest to enterprise-ready of any surface. Audit infrastructure is genuinely strong.

### `/review-queue` 🟠

**Wired:** Seeded queue + per-item decision (approve/reject) + audit per decision.

**Missing:**
- Batching / bulk review.
- Evidence display (AI flag rationale, full document context shown alongside the decision).
- Categorization workflow (attorney-client vs work-product vs other).
- Appeal workflow.
- Performance metrics (reviewer productivity, inter-rater agreement / Cohen's kappa).
- Decision audit attribution.

**Status:** Queue *structure* in place; review *workflow* (evidence, categorization, audit) is a stub.

### `/timeline` 🟠

**Wired:** Seeded timeline (6 events, 96h window) + filter by event kind + drill-into-event.

**Missing:**
- Agent-reconstructed timeline (real `reconstructTimeline` tool that ingests email/chat/doc events).
- Drill-into-event with full source record.
- Timeline export / annotation.
- Privilege overlay.
- Multi-actor view (overlay multiple custodians' timelines).
- Anomaly highlighting.

**Status:** Display *primitive* works; agent *reconstruction* and rich features missing.

### `/cal` (CAL workbench) 🟠

**Wired:** Seeded TAR proposals (3 items) + decision tally + convergence stats + `<mvk-cal-workbench>` + (decision)/(navigate)/(advance) events.

**Missing:**
- Real TAR model integration (mocked confidence).
- Convergence criterion (e.g., "stop when F1 > 0.95").
- Feature importance ("why did the model predict this?").
- Batching (process multiple docs per round).
- Feedback loop (decisions retrain the classifier).
- Validation set tracking.

**Status:** UI is the right shape; *backing model* doesn't exist.

### `/admin/templates` 🟡

**Wired (new this sprint):** In-review / rejected / drafts buckets + Approve/Reject/Resubmit with comments + `transition()` calls the registry's state machine + `ApprovalTransitionError` surfaced inline.

**Missing:**
- Per-template diff view (v2 ↔ v1).
- Bulk approve / reject.
- Template revision history.
- Reviewer-side notifications (badge already in sidebar; in-app + email digest are missing).
- Cross-matter template promotion.

**Status:** Workflow API is solid; UI surface depth is shallow.

### `/audit/layouts` 🟡

**Wired:** Chain integrity badge + per-event list with attribution + snapshot scrubber + at-or-before time-travel.

**Missing:**
- Replay-from-snapshot (re-render the workspace as-of timestamp T).
- Compare snapshots (slot diff between T1 and T2).
- Cross-correlate with tool-call chain (what tool ran between layout events).
- Export to court-defensible compliance report.

**Status:** Snapshot inspector works; full replay deferred per ADR-046.

---

## 6. Executive summary — the pattern

Across 14 surfaces, three patterns recur:

### Pattern A — Surfaces with strong infrastructure, weak content

`/audit`, `/audit/layouts`, `/dashboards` (canvas), `/workspace` (layout engine), `/admin/templates`. The lib pieces are production-shaped. The demo populates them with seeded mocks. Adopters who bring real data + real backends light these up immediately.

### Pattern B — Surfaces with credible UI, no real backend

`/inbox`, `/operations`, `/approvals`, `/playbooks`, `/review-queue`, `/cal`, `/timeline`. The components render, the interactions work, but the data flows are static. Adopters need to wire real trigger sources, real long-running ops backends, real TAR models, real notification pipelines.

### Pattern C — Surfaces that are pure stubs

The 6 workspace widgets (`documentPreview`, `tagPanel`, etc.). The `/documents` review depth (Bates, redaction, native render). The `/productions` export workflow (Bates allocation, COC, delivery). These are **placeholder territory** — they look correct but do nothing.

The codebase is honest about this. Inline comments on most stubs read *"Production would mount the [X] component"* or *"Production routes through `[Y]` tool"*. The demo is intentionally a scaffold.

---

## 7. Positioning — what is this codebase actually?

Three honest options for what the eDiscovery flagship demo IS:

**Option 1 — A reference architecture.** Position as *"here's how to build agentic UIs for any domain — eDiscovery is the worked example"*. Adopters fork it, replace the widgets with real ones, plug in their backend. **Implication:** Don't over-invest in demo polish; invest in cookbook coverage + the seam quality. This is closest to today's reality.

**Option 2 — A shippable eDiscovery product.** Position as *"plug-and-play eDiscovery review tool with agentic UX"*. **Implication:** 6-12 months of focused buildout — real document viewer, real Bates allocation, real TAR integration, real backend, real connectors (O365, Slack, Exchange). This is what enterprise adopters EXPECT when they see "eDiscovery flagship".

**Option 3 — A hybrid: vertical slices that work end-to-end.** Pick 2-3 review workflows (e.g., *"privilege pass with TAR + reviewer + production"*) and make them genuinely production-quality. Leave the rest as scaffold. **Implication:** Smallest path to "this is a real product for these specific things", without the cost of full coverage.

The current state is implicitly Option 1, but the *naming* (*"flagship"*, *"demo-ediscovery-shell"*) and *quantity of surfaces* (14 routes) suggests Option 2 or 3. **This positioning ambiguity is the root cause of the "feels prototype" perception.**

**Recommendation:** explicitly choose. If Option 1, rename `demo-ediscovery-shell` to `demo-ediscovery-reference` and reduce surface area to 4-5 representative routes. If Option 2 or 3, commit to a real buildout plan (with a real backend, real integrations, real document handling) and budget accordingly.

---

## 8. If we go Option 3 — vertical slices — what would they be?

The 3 highest-value workflows for an enterprise eDiscovery demo to actually do end-to-end:

### Vertical Slice A — Privilege review with real document handling

- Real PDF viewer (`<mvk-document-viewer>` registered as a ComponentDef, wraps PDF.js).
- Real tag panel that dispatches `tagDocuments` with chain-hashed audit.
- Real privilege log auto-generation from tags + reviewer decisions.
- Real chain-of-custody export to court-ready PDF.
- Real TAR integration (one external model — e.g., OpenAI embeddings) for relevance suggestions.

**Effort:** 6-8 weeks. Eliminates 4 stubs at once. The Workspace + Documents + Review Queue + CAL surfaces all become real.

### Vertical Slice B — Hold lifecycle with real notifications

- Custodian self-service portal at a separate URL — log in, see hold notice, acknowledge.
- Real email-based hold notice delivery (SES / SendGrid).
- SLA escalation (no acknowledgement in 48h → email lead-counsel).
- Real audit of custodian-side actions.

**Effort:** 4-6 weeks. Eliminates the stub on `/holds` + `/custodians` + Inbox notification source.

### Vertical Slice C — Production export with real Bates + redaction

- Bates allocation algorithm (per-production-set, conflict detection).
- Redaction editor with reviewer audit.
- Native + TIFF + PDF/A export.
- Production manifest + COC report.
- Privilege log + slipsheets.

**Effort:** 8-10 weeks. Eliminates the stub on `/productions`, partially on `/documents`.

Pick one of A/B/C as the next quarter's focus. All three together is a year.

---

## 9. The honest one-line takeaway

**The library is more capable than the demo demonstrates; the demo is more shaped than the workflows are real.** Either reposition the demo as a reference architecture and stop calling it a flagship — OR invest in real backends, real document handling, and real domain workflows. The current middle path produces the "prototype" perception that prompted this analysis.

---

**Generated:** 2026-05-16 · **Status:** Descriptive analysis · **Input to:** the next planning cycle (recommend: pick Option 1 / 2 / 3 explicitly before more surface-level work)
