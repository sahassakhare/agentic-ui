# eDiscovery use cases — what's wired, what's missing, what to do next

**Date:** 2026-05-16 · **Scope:** `examples/demo-ediscovery-shell` flagship · **Focus:** which real eDiscovery workflows the ADR-046 / ADR-047 primitives can drive end-to-end vs. which are stubs vs. which are missing entirely.

This is the eDiscovery-domain companion to the architecture critique. That doc looked at code-level gaps; this one looks at user-journey gaps. The library is largely in place; the question now is *which canonical eDiscovery flows does the demo actually let an adopter run, and which look like they should but don't*.

---

## 1. The canonical eDiscovery agentic-UI scenario (the gold-standard walkthrough)

A reviewer arrives at 9 AM Monday on matter `In re Acme Corp Securities Litigation`. **None of the actions below should require typing a prompt.** This is the demo we should be able to play end-to-end:

> 1. **Lands on `/`.** Sees the matter-overview dashboard. Live tiles show: pending hold acknowledgements, custodians on hold, recent productions, audit-chain health.
> 2. **Clicks "Documents" in the sidebar.** Workspace pivots to the review queue layout. Persona-driven: lead-counsel sees compact density; vendor-reviewer sees dense.
> 3. **Clicks a single document row.** Workspace pivots — **automatically, no prompt** — to a three-pane: PDF preview (primary), tag panel (sidebar), chain-of-custody (footer). This is `SelectionLayoutInput` doing its job.
> 4. **Tags the document privileged.** Selection clears; queue returns. Audit chain captures both layout shifts with attribution + chain hash.
> 5. **Types in chat: *"add a footer showing my recent privilege calls"*.** Agent picks `addLayoutSlot` (NOT a whole-map re-emit), reads `<override-stack>` from its context block, sees the route + selection layers are driving primary/sidebar, adds only the footer.
> 6. **Likes the result. Clicks "📌 Save as my preference".** Writes to `user-saved` tier under `/documents:lead-counsel`. Next reviewer session, the saved layout takes precedence over route default.
> 7. **A privilege-deadline alert fires** (60 min until log delivery). Workspace pivots — again, no prompt — to highlight unresolved privilege candidates.
> 8. **Matter transitions from `review` to `production`** (lead-counsel clicks "Mark phase complete"). Workspace + dashboards re-derive: production-throughput dashboard auto-appears, review-specific tiles fade.
> 9. **Lead-counsel goes to `/audit/layouts`, scrubs to 09:47Z.** Sees the exact slot map the junior reviewer was looking at when she made the privilege call — compliance-defensible.
> 10. **Asks the agent: *"propose a dashboard with privilege resolution velocity by reviewer"*.** Agent uses `proposeDashboard`. Lead-counsel commits via banner. v2 chains to v1 via `parentVersion`. Becomes the matter-default dashboard after lead-counsel sign-off through the approval workflow.

Of these ten steps, **how many work today?**

| # | Step | Status |
|---|---|---|
| 1 | Matter-overview dashboard | ⚠️ Static tiles, no real data; widgets are all `kpiTile` placeholders |
| 2 | Route → review queue layout | ✓ Route rule fires; layout is correct shape but slot widgets are kpiTile placeholders, not the actual review queue component |
| 3 | **Click doc → pivot to preview/tag/chain** | ❌ **Not wired.** `SelectionStore` exists; demo has no click handlers calling `set()` and no `selectionRules` registered |
| 4 | Tag → audit chain | ⚠️ Audit chain captures resolved-layout changes but not the user's tag action as an attribution chain |
| 5 | Slot-edit tool with context awareness | ⚠️ Tool exists; agent has the `<override-stack>` context fragment; but no spec asserts the agent uses it correctly, and the demo agent's system prompt doesn't reference the precedence model |
| 6 | Save as preference | ⚠️ Button writes to user-saved tier; **but** no `UserSavedLayoutInput` reads from that tier on next boot — so the save is decorative |
| 7 | Alert-driven pivot | ❌ **Not wired.** `AlertLayoutInput` exists in the resolver design but isn't shipped; trigger-runner doesn't feed into the resolver |
| 8 | Matter-phase auto-switch | ❌ **Not wired.** `MatterStore.matterId` exists but no `.phase()` signal; `matter-phase` precedence layer (weight 300) has no input feeding it |
| 9 | Time-travel to specific timestamp | ✓ `/audit/layouts` route + scrubber present. Works deterministically given the chain has events |
| 10 | Approval workflow for templates | ⚠️ State machine works (`transition()` method) but there's no admin UI to surface `pendingReview()` entries; only `approved()` shows in the picker |

**Score: 2 / 10 fully working, 5 / 10 partial, 3 / 10 missing entirely.**

The lib has the primitives. The demo doesn't tell the story end-to-end.

---

## 2. Use case inventory — wired, partial, missing

### 2.1 Collection phase

| Use case | Path / surface | Status | Notes |
|---|---|---|---|
| List custodians | `/custodians` | ✓ Working | Static list, no layout pivot on row click |
| Onboard custodian via chat | Chat: *"Onboard a Finance custodian..."* | ✓ Working | `addCustodian` tool, mounts intake form widget |
| Onboard custodian via page | `/intake/custodian` | ✓ Working | Direct-mount form |
| Place legal hold | `/holds` + chat | ✓ Working | Both surfaces exercise the same `placeLegalHold` tool |
| **Click a custodian → workspace pivots to interview-prep** | `/custodians` row click | ❌ Missing | `selectionStore.set({ kind: 'custodian', ids: [...] })` not wired |
| **Hold deadline approaching → layout warns** | Trigger → resolver | ❌ Missing | No `AlertLayoutInput` |
| **Multi-select custodians → bulk-action layout** | `/custodians` multi-select | ❌ Missing | UI doesn't multi-select; no rule registered |

### 2.2 Review phase

| Use case | Path / surface | Status | Notes |
|---|---|---|---|
| Documents list | `/documents` | ✓ Working | Static three-pane chassis (hand-rolled, predates resolver) |
| Tag a document privileged | Smart-cell + row-action-menu | ✓ Working | Lib primitive |
| Smart-cell AI flag column | Documents table | ✓ Working | Lib primitive |
| Bulk toolbar on multi-select | Documents table | ✓ Working | Lib primitive |
| Review queue layout | `/review-queue` | ⚠️ Partial | Route exists; `<mvk-review-queue>` mounts; not bound to resolver |
| **Click 1 doc → preview + tag + chain** | `/documents` row click | ❌ Missing | The canonical *"context-driven, no prompt"* moment. Doesn't fire. |
| **Click 3+ docs → bulk preview** | `/documents` multi-select | ❌ Missing | Same gap |
| **Privilege-review-v3 template applied → looks distinct** | Chat: *"apply privilege-review-v3"* | ⚠️ Partial | Tool fires; template has empty `slotMap`; layout doesn't change visibly |
| CAL workbench | `/cal` | ✓ Working | Standalone lib component |
| TAR classification on un-tagged | Chat: long-running op | ✓ Working | `runTARClassifier` tool, operation-progress widget |

### 2.3 Production phase

| Use case | Path / surface | Status | Notes |
|---|---|---|---|
| Productions list | `/productions` | ✓ Working | Static; agent can `openProductions` |
| Production set creation | Chat: *"Create production set..."* | ✓ Working | Lib intake workflow |
| Place hold + collect multi-step | `/workflows/place-hold-and-collect` | ✓ Working | Multi-actor workflow widget |
| **Production-throughput dashboard with drillable tiles** | `/dashboards` | ⚠️ Partial | Dashboard exists; tiles drill but only to a route, never to another dashboard |
| **Production-export-prep template usable** | Apply via chat or button | ❌ Missing | Template state is `in review`; doesn't surface in picker; no admin UI to approve |
| **Bates-range issuance trend** | Dashboard tile | ⚠️ Partial | `production-throughput-weekly` template approved but tile invocation is `{kind: 'static'}` with placeholder markdown |

### 2.4 Audit & compliance

| Use case | Path / surface | Status | Notes |
|---|---|---|---|
| Matter audit trail | `/audit` | ✓ Working | Pre-existing; lists `AuditEvent`s; chain-hash visualization |
| **Layout audit trail** | `/audit/layouts` | ✓ Working | NEW: chain viewer + scrubber. Real time-travel works |
| **Cross-audit time-travel** ("what was Sarah looking at when she made the call?") | Compliance query | ⚠️ Partial | Time-travel viewer exists but matter-audit + layout-audit are separate logs. No "unified view at time T". |
| **Chain integrity validation** | `/audit/layouts` green pill | ✓ Working | `validateChain()` runs every render |
| **Attribution per layout change** | Banner on `/workspace` | ✓ Working | NEW post-bug-fix in `605c3b5` |

### 2.5 Workflow + playbook execution

| Use case | Path / surface | Status | Notes |
|---|---|---|---|
| Playbook runner UI | `/playbooks` | ✓ Working | Lib primitive |
| Initial privilege pass playbook | `/playbooks` → run | ✓ Working | 3 seeded `PlaybookDef`s |
| Step-by-step audit per playbook | Audit trail | ✓ Working | Each step audits via chain hash |

### 2.6 Cross-cutting agentic surfaces

| Use case | Surface | Status | Notes |
|---|---|---|---|
| Agent reshapes workspace from prompt | `setWorkspaceLayout` | ✓ Working | Original PR4 |
| Agent edits one slot without re-emitting | `addLayoutSlot`/`removeLayoutSlot`/`replaceLayoutSlot` | ✓ Working | NEW (ADR-047 D1) |
| Agent recommends template by name | `listLayoutTemplates` + `applyLayoutTemplate` | ✓ Working | NEW (ADR-047 D2) |
| Agent sees current layout in context | `<override-stack>` fragment | ⚠️ Wired but unverified | Sent in HTTP body; agent's system prompt doesn't reference it |
| **Agent sees user's selection** | `<selection>` fragment | ⚠️ Wired but selection never populated | Demo doesn't call `selectionStore.set()` |
| **Agent sees recent tool calls** | `<recent-tool-calls>` fragment | ❌ Missing provider | Token unbound |
| **Agent sees matter phase** | `<matter phase="..." />` | ⚠️ Partial | Matter id flows; phase doesn't exist |

---

## 3. The five missing "demo moments" that would transform the story

If we want the demo to read as a true agentic-UI showcase rather than a feature-checklist, these are the five highest-impact gaps to close:

### 3.1 Selection-driven layout pivot — the canonical zero-prompt moment

**The moment:** click a document row → workspace becomes preview + tag + chain. No typing.

**What's missing (concrete):**
- `pages/documents/documents.component.ts` row click handler calls `selectionStore.set({ kind: 'document', ids: [doc.id] })`.
- `app.config.ts` registers selection rules:
  ```ts
  selectionRules: [
    { kind: 'document', minCount: 1, maxCount: 1, slots: {
      primary: { component: 'documentPreview', size: { default: '60%' } },
      sidebar: { component: 'tagPanel', size: { default: '25%' } },
      footer:  { component: 'chainOfCustody', size: { default: '15%' } },
    }, reason: 'single-doc focus mode' },
    { kind: 'document', minCount: 2, slots: {
      primary: { component: 'multiDocPreview' },
      sidebar: { component: 'bulkActions' },
    }, reason: 'multi-doc bulk mode' },
  ]
  ```
- `NavigationEnd` handler in `AppComponent` clears selection on route change.

**Why it matters:** This is the single most viscerally agentic-UI moment. Without it, the resolver looks like extra infrastructure; with it, the *"no prompt needed"* claim becomes self-evident.

**Effort:** 1 day. ~40 lines of demo wiring. No lib work.

### 3.2 Real slot widgets (`documentPreview`, `tagPanel`, `chainOfCustody`)

**The moment:** the resolved slot map renders distinct, real-looking widgets — not three identical `kpiTile` boxes.

**What's missing (concrete):**
- A `DocumentPreviewWidget` component — even a stub that renders the doc id + "PDF preview placeholder" — registered in `ComponentRegistry` as `documentPreview`.
- Similar stubs for `tagPanel`, `chainOfCustody`, `bulkActions`, `multiDocPreview`, `privilegeLog`, `interviewPrep`.
- Update route rules + selection rules to reference these names instead of `kpiTile`.

**Why it matters:** Every workspace layout today looks identical because every slot mounts the same `kpiTile`. Adopters can't tell from the demo *what* a "documentPreview slot" means visually. Stub widgets — even with placeholder content — make the precedence model legible.

**Effort:** ~1 day per stub widget × 6-8 widgets. Can be cheap if they're all `KpiTileShellComponent` variants with different titles + icons.

### 3.3 Matter-phase signal — the "workflow stage drives the canvas" demo

**The moment:** lead-counsel marks matter phase complete → workspace + dashboards re-derive for the next phase.

**What's missing (concrete):**
- `MatterStore.phase` signal — `'collection' | 'review' | 'production' | 'closed'` + `setPhase(p)`.
- Persist via `PersistenceRegistry` per matter id.
- Bind `MATTER_CONTEXT_SIGNAL` factory to `{ id: matterId, phase: phase() }` (already half-wired).
- New `MatterPhaseLayoutInput` reading from `MatterStore.phase()` + an adopter-supplied rule set.
- A "Mark phase complete" affordance somewhere (matter header? lead-counsel admin page?).

**Why it matters:** Matter phase is THE eDiscovery state variable. The layout subsystem can't claim to model the domain without it. Once wired, the `<matter phase="review">` context fragment becomes actionable for the agent ("agent, this matter is in production — what dashboards are relevant?").

**Effort:** 2 days. Touches lib (new input class) + demo (store + UI + rule wiring).

### 3.4 Admin UI for the approval workflow

**The moment:** lead-counsel navigates to a "Template review" surface, sees the production-export-prep template waiting in `review` state, approves it, watches it appear in the picker for everyone on the matter.

**What's missing (concrete):**
- New route `/admin/templates` (or sub-section of `/audit`) showing `pendingReview()` entries.
- Per-template card with **Approve** / **Reject** buttons that call `templateRegistry.transition(name, action, { actor, comment })`.
- Visibility-aware persona gate — only `lead-counsel` and `matter-admin` see the route.
- Surfacing in sidebar (badge for pending count).

**Why it matters:** Without an admin UI, the approval state machine is half a feature. Today the `production-export-prep` template seeded in `review` state is permanently invisible — no path from `review → approved`. The catalog story (D6) is incomplete.

**Effort:** 2-3 days. Mostly UI; the state machine + registry methods are ready.

### 3.5 "Save as template" promotion flow

**The moment:** reviewer tweaks a workspace they like → clicks "Save as my preference" (works) → clicks "Promote to team template" → fills name/tags/visibility → submits → matter-lead approves → it appears in everyone's catalog.

**What's missing (concrete):**
- New affordance on the workspace banner: "Save as team template" button (or a dropdown next to the Save button).
- Modal with `LayoutTemplate` form fields (name, title, description, tags, visibility radio: private/matter/tenant).
- On submit: build the LayoutTemplate, set `approvalState: 'draft'` (or `'review'` if visibility !== 'private'), `register()` into `LayoutTemplateRegistry`, route into approval workflow.
- Connects to §3.4 — admin sees the new draft, reviews it.

**Why it matters:** Closes the loop from user-pinned preference → shared org template. Today the only path to publish a template is hardcoding in `agentic/layout-templates.ts`. Real adopters need this surface to scale beyond seed data.

**Effort:** 2 days, depends on §3.4 landing first.

---

## 4. Lower-priority but legitimate use-case gaps

These don't change the headline demo story but each closes a real eDiscovery workflow gap:

### 4.1 Privilege-review specific flows

- **Privilege-log auto-build** — when a doc gets tagged `privileged`, append to a privilege-log dashboard tile. Today: separate logs, no auto-flow.
- **Bulk privilege-overrule** — lead-counsel selects 50 docs flagged `privilege-candidate`, applies "override → responsive". Bulk-toolbar primitive exists; the workflow doesn't.

### 4.2 Cross-matter use cases

- **Switch matters** — `MatterStore` has `matterId` but no `switchMatter(id)` UI. Demo is single-matter.
- **Cross-matter template sharing** — `LayoutTemplate.visibility` supports `tenant` scope but no flow demonstrates "this template is available across all matters".

### 4.3 Multi-persona collaboration

- **Co-presence on a matter** — "who else is reviewing this matter right now?" Explicitly out of scope per ADR-046, but flagged here as an obvious enterprise ask.
- **Per-persona approval routing** — different actions route to different approvers (paralegal → matter-lead; matter-lead → managing-partner). Current `ApprovalRegistry` is single-approver.

### 4.4 Production-export reality check

- **Bates stamping preview** — workflow exists; no UI tile shows "Bates 0001-0500 vs. 501-1000".
- **Redaction layer** — `redactionEditor` widget mentioned in design comments; doesn't exist.
- **Production set comparison** — no UI to compare PROD-001 vs. PROD-002.

### 4.5 Search & TAR

- **Search-driven layout pivot** — typing in the global search bar SHOULD pivot to a search-results layout. Today it just filters whatever's on screen.
- **TAR seed-set review loop** — CAL workbench exists; no "agent suggests next docs to review" workflow.
- **Concept clusters as a layout** — semantic clustering output rendered as drillable tiles.

### 4.6 Mobile / responsive

- **Tablet review mode** — `ResponsiveCollapseRule` exists; only `/workspace` uses it. Reviewer on iPad gets the desktop layout.
- **Mobile audit lookup** — incident response asks: "what was applied at this moment?" from a phone. The /audit/layouts page doesn't degrade to mobile-readable.

---

## 5. Recommendations — sequenced

### Sprint 1 (closes the demo's biggest narrative gap)

1. **Wire selection-driven layouts on `/documents`** (§3.1). 1 day. Single biggest visible win.
2. **Add real stub widgets** for `documentPreview` / `tagPanel` / `chainOfCustody` / `bulkActions` (§3.2). 2-3 days. Without this, selection rules look like the previous prompt — three more `kpiTile` boxes.
3. **Update route rules + selection rules in `app.config.ts`** to reference the new widget names instead of `kpiTile`.
4. **Update workspace try-asking prompts** to call out the click-to-pivot behavior.

**Outcome after sprint 1:** A reviewer can click into a doc and see the workspace genuinely pivot to a distinct review layout — the canonical agentic-UI moment.

### Sprint 2 (matter-phase + admin UI)

5. **Add `MatterStore.phase` + `MatterPhaseLayoutInput`** (§3.3). 2 days.
6. **Build `/admin/templates` review surface** (§3.4). 2-3 days.
7. **Wire `<recent-tool-calls>` provider** via a `computed()` over `MatterStore.auditLog`. Half a day.
8. **Update the surface specialist's prompt** to reference the `<override-stack>` and `<available-templates>` context fragments. Half a day. Tests it actually reads them.

**Outcome after sprint 2:** Lead-counsel can review and approve templates, change matter phase to re-derive layouts, and the agent reasons about live state.

### Sprint 3 (template promotion + cookbook)

9. **"Save as template" flow** (§3.5). 2 days.
10. **Write the four ADR-046 cookbook pages** (`enterprise-layout-engine.md`, `precedence-and-storage-tiers.md`, `layout-audit-and-time-travel.md`, `template-catalog-and-approvals.md`). Each 3-4 hours = 2 days total.

**Outcome after sprint 3:** Adopters reading the cookbook see a coherent end-to-end story, every primitive has at least one demo flow.

### Backlog (next major version)

11. Real document widgets (PDF viewer with annotations, redaction layer, etc.) — likely a separate sub-package or adopter responsibility.
12. Cross-matter switcher + tenant-level template marketplace.
13. Mobile/tablet responsive variants for `/documents` + `/audit/layouts`.
14. Co-presence + multi-user collaboration (ADR-049+).
15. D8 approval gate for sensitive layout changes (ADR-047 deferred).

---

## 6. Why the demo as it stands undersells the lib

A pattern across §1–§4: the **library is more capable than the demo demonstrates**.

- `SelectionStore` exists; demo never sets it.
- `MatterContextSignal` token exists; demo binds `id` only, no phase.
- `RecentToolCallsSignal` exists; demo doesn't bind a source.
- Approval state machine works; demo has no admin UI.
- Template visibility supports `tenant` scope; demo has no cross-matter context.
- `httpPersistenceStore` ships with 4 customization knobs; demo uses memory adapters.
- 7+ widget names referenced in tools + docs; only `kpiTile` is implemented.

This pattern matters because **adopters evaluate the library through the demo**. An adopter reading this codebase today sees a workspace that pivots only on chat prompts, three identical-looking slots, dashboards with placeholder tiles, no admin workflow — and concludes the library is less capable than it actually is. Closing the §3 + §4 gaps doesn't add functionality; it reveals functionality that's already there.

---

## 7. Five-line decision matrix

If forced to pick **one** thing to ship this week:

1. **§3.1 selection-driven layout on `/documents`** — yes
2. ~~§3.2 stub widgets~~ — only if §3.1 lands, else they're not differentiated
3. ~~§3.3 matter phase~~ — bigger, ship next sprint
4. ~~§3.4 admin UI~~ — needs §3.3's phase signal to feel real
5. ~~§3.5 save as template~~ — needs §3.4 to receive the submission

The ordering isn't accidental: each item depends on the previous one being visible. Start with §3.1 — single biggest narrative shift for ~1 day of work.

---

**Generated:** 2026-05-16. **Status:** Recommendation; not yet adopted. **Owner:** review in next planning cycle.
