# @maverick/agentic-platform-schematics

Angular schematics that scaffold the **entire Agentic Experience Platform monorepo**
into a workspace — `projects/` (the `agentic-ui` library + this package),
`platform/` (catalog service, Studio, Hub, ops console, matter-management MFE,
embed SDK), `examples/`, and the workspace config.

## Security

Security-sensitive files are **never** shipped in the scaffold. The snapshot step
(`scripts/populate-templates.mjs`) excludes IdP/SSO servers (`sso.mjs`, `idp.mjs`),
token/key minting (`mint-token.mjs`, `mint-dev-key.mjs`), load tests
(`load-test.mjs`), DB/RLS scripts (`db-setup.sh`, `pg-sql.mjs`, `rls-*.mjs`),
`.env` files, private keys/certs (`*.pem`, `*.key`, …), and `.npmrc`. The full
excluded list is written to `EXCLUDED.md` on each run.

## Build

```bash
npm run build        # populate templates from the repo, compile, copy assets → dist/
```

## Use

```bash
# into the current directory
schematics ./dist/collection.json:scaffold

# or, once published:
ng add @maverick/agentic-platform-schematics
ng generate @maverick/agentic-platform-schematics:scaffold --directory=my-workspace --includeExamples=false
```

## Options

| option | default | description |
|---|---|---|
| `directory` | `.` | target directory |
| `includeExamples` | `true` | include `examples/` apps + MFE remotes |
| `overwrite` | `false` | overwrite existing files |
