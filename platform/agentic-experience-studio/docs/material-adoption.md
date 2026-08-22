# Angular Material adoption policy

Experience Studio has a mature **custom design system** (tokens in
`src/styles.scss`, first-class light/dark). We adopt Angular Material **for
behaviour and commodity chrome only** — never as a wholesale re-skin. Material's
M3 system tokens are remapped onto the Studio tokens in `src/_material-theme.scss`,
so every Material component follows the Studio's light/dark automatically.

This policy is the source of truth for what goes where. When in doubt, prefer
custom for anything that carries the Studio's identity, and Material/CDK for the
tedious, accessibility-heavy plumbing.

## → Angular Material (themed to Studio tokens)

Adopt Material components where rebuilding them accessibly by hand is pure cost:

| Category | Components | Why |
|---|---|---|
| Data / registry lists | `MatTable`, sort, paginator, filter | Sorting/paging/virtual-scroll for free, accessible |
| Stepped flows | `MatStepper` | Directly fits the Workflow designer |
| Overlays | `MatDialog`, `MatMenu`, `MatAutocomplete`, `MatTooltip`, `MatSnackBar` | Overlay + focus management + a11y are hard to get right |
| Inputs (net-new) | `MatFormField`, `MatSelect` | Only for new surfaces — not a re-skin of existing inputs |
| Structure | `MatTabs`, `MatExpansionPanel`, chips, badges | Standard, low-identity chrome |

## → CDK only (headless, our own styling)

Use `@angular/cdk` primitives under custom markup where identity matters:

| Need | CDK primitive |
|---|---|
| Drag-drop authoring canvas | `@angular/cdk/drag-drop` |
| Custom overlays / popovers | `@angular/cdk/overlay` |
| Focus trap, live-announcer, keyboard | `@angular/cdk/a11y` |
| Large virtualized lists | `@angular/cdk/scrolling` |
| Tree structures | `@angular/cdk/tree` |

## → Stay custom (do not migrate)

These carry the Studio's identity or have no Material equivalent — leave them on
the custom design system:

- The **authoring canvas** (page/form/workflow direct-manipulation surfaces).
- The **capability / experience graph** views.
- The **preview host** and any runtime-rendered surface.
- Existing, working **buttons, cards and simple inputs** — re-skinning them to
  Material is churn with no functional gain and dilutes the identity.

## Rules

1. **Tokens are the single source of visual truth.** Never hard-code a color;
   Material reads the Studio tokens via `--mat-sys-*` mappings.
2. **Adopt incrementally, one component at a time**, each change independently
   shippable and reversible.
3. **Do not accept the `ng add` schematic's default typography/theme** — the M3
   theme is pinned to the Studio's Inter stack and tokens.
4. **The manual authoring path stays functional** through every adoption.
