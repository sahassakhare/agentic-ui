# Teams Tab embed

Goal: ship any `@infra-tools/agentic-ui` host (the eDiscovery shell, a
bookings shell, a custom Angular app) as a Microsoft Teams Tab —
operators stay inside Teams; the agentic UI runs inside an iframe;
context (active tenant, user, theme) bridges in from Teams's SDK.

This is **Path 1a** in
[docs/plans/teams-copilot-integration-plan.md](../plans/teams-copilot-integration-plan.md).
The Angular app does not change. Only two pieces:

1. A Teams app manifest declaring your URLs.
2. `provideTeamsContext()` in your `ApplicationConfig.providers`.

## 1. Add the manifest

Drop a `teams/manifest.json` + icons in your host app. See
`examples/demo-ediscovery-shell/teams/` for a working scaffold.
Replace these placeholders before zipping:

| Placeholder | Value |
|---|---|
| `REPLACE-WITH-YOUR-GUID-AT-PUBLISH-TIME` | `uuidgen` output, stable across releases |
| `REPLACE-WITH-YOUR-RENDER-URL.onrender.com` | Hostname of your deployed shell |
| `REPLACE-WITH-AAD-APP-ID` | Azure AD app registration id (only needed for SSO) |

Build the package:

```bash
cd teams && zip ../mfe-teams.zip manifest.json color.png outline.png
```

Upload via **Teams → Apps → Manage your apps → Upload a custom app**.

## 2. Wire the runtime

Add `provideTeamsContext` to your app config. The lib does NOT
take a hard dependency on `@microsoft/teams-js` — you import it
yourself (lazily, so it doesn't bloat the bundle when running
outside Teams):

```ts
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import {
  provideAgenticUi,
  provideAgUiBackend,
  provideTeamsContext,
} from '@infra-tools/agentic-ui';

const FALLBACK_TENANT = 'demo';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgenticUi({ widgets: [] }),
    provideAgUiBackend({ url: '/agent/run' }),
    provideTeamsContext({
      loadContext: async () => {
        // Only initialise the SDK when actually framed by Teams.
        if (!isInsideTeams()) throw new Error('not framed by Teams');
        const teams = await import('@microsoft/teams-js');
        await teams.app.initialize();
        const c = await teams.app.getContext();
        return {
          tenantId: c.user?.tenant?.id ?? FALLBACK_TENANT,
          userPrincipalName: c.user?.userPrincipalName ?? null,
          theme: c.app?.theme ?? 'default',
          locale: c.app?.locale ?? 'en-US',
          claims: { groups: c.user?.licenseType ? [c.user.licenseType] : [] },
        };
      },
      fallback: {
        tenantId: FALLBACK_TENANT,
        userPrincipalName: null,
        theme: 'default',
        locale: 'en-US',
      },
    }),
  ],
};

function isInsideTeams(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.parent !== window.self) return true;            // any iframe
  return new URLSearchParams(location.search).has('teams');  // explicit ?teams=1
}
```

## 3. Consume the context

Any component / service can read the signal:

```ts
import { inject, computed } from '@angular/core';
import { TEAMS_CONTEXT } from '@infra-tools/agentic-ui';

@Component({...})
export class HeaderComponent {
  private readonly teams = inject(TEAMS_CONTEXT);

  // Whatever you need from the context — null when not in Teams.
  protected readonly tenant = computed(() => this.teams()?.tenantId ?? 'demo');
  protected readonly user = computed(() => this.teams()?.userPrincipalName);
  protected readonly theme = computed(() => this.teams()?.theme ?? 'default');
}
```

Apply the theme to the page chrome:

```ts
effect(() => {
  const theme = teams()?.theme;
  document.documentElement.dataset['teamsTheme'] = theme ?? 'default';
});
```

CSS:

```css
:root[data-teams-theme="dark"] { --c-bg: #1f1f1f; --c-fg: #ffffff; }
:root[data-teams-theme="contrast"] { --c-bg: #000; --c-fg: #fff; }
```

## 4. Map Teams identity to a runtime persona

The catalog's `role-mappings` table (see ADR-016) already maps JWT
claims to runtime personas. Pass the Teams claims through:

```ts
provideCatalogActivePersona({
  catalogUrl: 'https://your-catalog.onrender.com',
  claimsResolver: () => {
    const ctx = inject(TEAMS_CONTEXT)();
    if (!ctx) return null;
    return {
      tenant_id: ctx.tenantId,
      sub: ctx.userPrincipalName ?? 'anonymous',
      groups: (ctx.claims?.['groups'] as string[]) ?? [],
    };
  },
});
```

Operators land in the right persona without retyping. Tools they
can't invoke stay hidden via `setScopePolicy`.

## Caveats

- **Static tabs** show in the personal app sidebar; one entry per
  page you want pinned. Add more in `manifest.json → staticTabs`.
- **Configurable tab** is for channel / group-chat installs. The
  `configurationUrl` should point at a `/teams/config` route that
  asks the user which view to pin and calls
  `microsoftTeams.pages.config.setConfig({ contentUrl, ... })`.
- Teams **iframes are tightly sandboxed**. `Set-Cookie` SameSite
  must be `None` + Secure if you authenticate via cookies. JWT in
  localStorage / sessionStorage is simpler.
- **CSP** must allow `frame-ancestors teams.microsoft.com
  *.teams.microsoft.com`. Render's static-site headers pane is the
  place to set this in our demo.

## What's next

Path 1a covers embed-the-Angular-app-as-a-Tab. For Teams-**native**
chat (the agent answers from Teams's chat composer with Adaptive
Cards), see Path 1b in the plan — that ships as a separate
`@infra-tools/agentic-ui-teams-bot` package once the demand is real.

For invoking the same tools from Microsoft 365 Copilot or GitHub
Copilot Chat, see Paths 1c and 2a in the plan.
