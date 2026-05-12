# Teams Tab packaging (plan P0 / ADR-041)

This directory packages the running eDiscovery shell as a Microsoft
Teams Tab. The Angular app is unchanged — Teams just renders it
inside an iframe.

## Files

- `manifest.json` — Teams app manifest (v1.16). Replace the
  `REPLACE-WITH-…` placeholders before zipping.
- `color.png` / `outline.png` — icons referenced by the manifest.
  Add your own; Teams rejects manifests without them. Color icon
  192×192, outline icon 32×32.

## Build a Teams app package

```bash
# from this directory
cp manifest.json /tmp/teams/
cp color.png outline.png /tmp/teams/
cd /tmp/teams && zip ../ediscovery-teams.zip *
```

Upload `ediscovery-teams.zip` to Teams via **Apps → Manage your apps
→ Upload a custom app**.

## Replace before publishing

| Placeholder | What it means |
|---|---|
| `REPLACE-WITH-YOUR-GUID-AT-PUBLISH-TIME` | Stable app id; generate once with `uuidgen` |
| `REPLACE-WITH-YOUR-RENDER-URL.onrender.com` | The hostname of your deployed shell |
| `REPLACE-WITH-AAD-APP-ID` | Azure AD app registration id; only required if you want SSO |

## How the runtime uses Teams context

The shell's `app.config.ts` calls `provideTeamsContext({ loadContext })`
(from `@infra-tools/agentic-ui`). When the page detects it's running
inside Teams (`?teams=1` query param or `microsoftTeams.app.isHost`),
it imports `@microsoft/teams-js` lazily and resolves the context
through it. Outside Teams the call returns `null` and the shell
behaves identically to a plain Render deployment.

```ts
// adopter wiring, condensed
provideTeamsContext({
  loadContext: async () => {
    const teams = await import('@microsoft/teams-js');
    await teams.app.initialize();
    const c = await teams.app.getContext();
    return {
      tenantId: c.user?.tenant?.id ?? '',
      userPrincipalName: c.user?.userPrincipalName ?? null,
      theme: c.app?.theme ?? 'default',
      locale: c.app?.locale ?? 'en-US',
    };
  },
  fallback: { tenantId: 'demo', userPrincipalName: null, theme: 'default', locale: 'en-US' },
});
```

## Static tabs vs configurable tabs

The manifest declares both:

- **Static tabs** — fixed entry points (Dashboard / Intake / Holds)
  that show in the personal app sidebar. No config.
- **Configurable tab** — channel/group-chat install path; admins
  pick which view to pin.

Three static tabs let operators deep-link from a Teams personal
chat into the dashboard, the intake form page, or the legal holds
list. All three pass `?teams=1` so the shell knows to bridge Teams
context.

## What you DON'T get from a Tab embed

- **No Teams-native chat surface.** The shell still shows its own
  right-rail Matter Coordinator chat inside the tab. For
  Teams-native chat with Adaptive Cards, see Path 1b
  (`@infra-tools/agentic-ui-teams-bot`, deferred).
- **No bot-style notifications.** Use Path 1b or a Power
  Automate flow if you need them.

## Local dev

You can preview Teams behaviour by visiting any deployed shell URL
with `?teams=1`. The shell uses the fallback context (no real SSO)
but exercises the same code path. The full SDK init only runs when
the page is actually framed inside Teams.
