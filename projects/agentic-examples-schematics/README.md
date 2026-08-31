# @infra-tools/agentic-examples-schematics

Angular schematics that scaffold the **Agentic Experience Platform example apps**
(`examples/`) into a workspace.

This is the companion to
[`@infra-tools/agentic-platform-schematics`](https://www.npmjs.com/package/@infra-tools/agentic-platform-schematics),
which scaffolds the platform itself (the `agentic-ui` library, catalog service,
Studio, Hub, …). Split into two packages so you can pull in the platform without
the demo apps — or the demos on their own.

## Use

Scaffold the platform first, then add the examples into the same workspace:

```bash
# 1) the platform
npx @angular-devkit/schematics-cli @infra-tools/agentic-platform-schematics:scaffold --directory=my-workspace

# 2) the example apps, into that workspace
cd my-workspace
npx @angular-devkit/schematics-cli @infra-tools/agentic-examples-schematics:scaffold
```

Options: `--directory` (target directory, default `.`) and `--overwrite`
(overwrite existing files, default `false`).

## What's included

Every app under `examples/` — the reference applications, MFE remotes, and their
sources — copied verbatim. Security-sensitive scripts (IdP/SSO, token/key
minting, load tests, DB/RLS scripts, `.env`, keys) are **never** included; see
`EXCLUDED.md` in the published package for the exact list.

The example apps import `@infra-tools/agentic-ui` and rely on the workspace
config from the platform scaffold, so scaffold the platform package alongside
these.

## Releasing

Auto-published on every merge to `main` that changes `examples/` (or this
package's own source) by `.github/workflows/examples-schematics-release.yml`.
npm is the version-of-record — the published version is `npm-latest + patch`, so
the snapshot always tracks the latest `examples/` tree.

## License

Apache 2.0
